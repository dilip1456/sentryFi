import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ClassifierAccount, TxnTypeOverride } from "@/lib/recurring/classifier";
import { addDays, todayLocal } from "@/lib/recurring/dates";
import { detectRecurringSeries } from "@/lib/recurring/detect";
import { toStreamRow } from "@/lib/recurring/rows";
import {
  accountsFromPlaid, buildUpcoming, demoRundown, eligibleStreams, LOOKBACK_DAYS, mergeStreams, normalizeRundownSettings, plannedFromEvents,
  txnsFromPlaid, DEFAULT_RUNDOWN_SETTINGS,
  type OccurrenceRow, type PlannedItem, type RundownAccount, type RundownSettings, type RundownTxn, type UpcomingAccount,
  type UpcomingMilestone, type UpcomingObligation, type UpcomingStatement, type UpcomingStream,
} from "@/lib/timeline";
import type { TimelineSourceOpts } from "./useTimeline";

type Res<T> = Promise<{ data: T | null; error: { message: string } | null }>;
// Untyped access: rundown_settings / some timeline tables aren't in the generated types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (t: string) => any };

export interface RundownData { items: PlannedItem[]; txns: RundownTxn[]; accounts: RundownAccount[] }

/**
 * Inputs for the cash-flow rundown. Demo mode returns example data and never
 * touches Supabase. Live: the same sources as Upcoming, but only confirmed
 * or high-confidence, non-dismissed streams (see eligibleStreams), plus the
 * last ~3 weeks of transactions for paid/late matching and user-set
 * stream_occurrences ("Mark paid", "Skip this time", "this time only" edits).
 */
export function useTimelineRundown({ userId, demo }: TimelineSourceOpts, enabled = true) {
  const today = todayLocal();
  return useQuery<RundownData>({
    queryKey: ["timeline-rundown", demo ? "demo" : userId, today],
    enabled: enabled && (demo || !!userId),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (demo) return demoRundown(today);
      const uid = userId!;
      const from = addDays(today, -LOOKBACK_DAYS), through = addDays(today, 14);
      const safe = async <T,>(p: Res<T>): Promise<T | []> => { const { data, error } = await p; if (error) { console.warn("[timeline rundown]", error.message); return []; } return data ?? []; };
      const [stored, obligations, statements, milestones, accountsRaw, overrides, occurrences, history, recent] = await Promise.all([
        safe<UpcomingStream[]>(db.from("recurring_streams").select("*").eq("user_id", uid).neq("status", "dismissed")),
        safe<UpcomingObligation[]>(db.from("obligations").select("id,stream_id,funding_account_id,active").eq("user_id", uid)),
        safe<UpcomingStatement[]>(db.from("credit_statements").select("account_id,statement_issue_date,due_date,statement_balance,minimum_payment_amount").eq("user_id", uid).gte("statement_issue_date", addDays(today, -70))),
        safe<UpcomingMilestone[]>(db.from("tax_milestones").select("id,title,due_date,amount,status,kind,note").eq("user_id", uid).gte("due_date", from).lte("due_date", through)),
        safe<Record<string, unknown>[]>(db.from("plaid_accounts").select("account_id,item_id,name,mask,type,subtype,current_balance,available_balance").eq("user_id", uid)),
        safe<{ transaction_id: string; txn_type: string }[]>(db.from("txn_overrides").select("transaction_id,txn_type").eq("user_id", uid)),
        safe<OccurrenceRow[]>(db.from("stream_occurrences").select("stream_id,period,expected_date,expected_amount,status,user_set").eq("user_id", uid).eq("user_set", true).gte("expected_date", addDays(from, -7)).lte("expected_date", addDays(through, 7))),
        fetchTxns(uid, addDays(today, -760)),
        safe<{ transaction_id: string; account_id: string | null; amount: number; date: string; name: string | null; merchant_name: string | null; pending: boolean | null }[]>(
          db.from("plaid_transactions").select("transaction_id,account_id,amount,date,name,merchant_name,pending").eq("user_id", uid).gte("date", addDays(today, -21)).limit(2000)),
      ]);
      const accounts = accountsFromPlaid(accountsRaw as Record<string, unknown>[]);
      const upAccounts: UpcomingAccount[] = accounts.map(a => ({ account_id: a.id, name: a.name, mask: a.mask, type: a.type, subtype: a.subtype, current_balance: a.balance }));
      const clsAccounts: ClassifierAccount[] = accounts.map(a => ({ account_id: a.id, name: a.name, mask: a.mask ?? null, type: a.type ?? null, subtype: a.subtype ?? null }));
      const series = detectRecurringSeries(history, clsAccounts, { today, overrides: overrides as TxnTypeOverride[] });
      const detected = series.map(s => ({ ...toStreamRow(s, uid), id: null, last_seen: s.lastSeen })) as UpcomingStream[];
      const streams = eligibleStreams(mergeStreams(stored as UpcomingStream[], detected));
      const events = buildUpcoming({ today: from, through, streams, obligations: obligations as UpcomingObligation[], statements: statements as UpcomingStatement[], milestones: milestones as UpcomingMilestone[], accounts: upAccounts });
      return { items: plannedFromEvents(events, { streams, occurrences: occurrences as OccurrenceRow[] }), txns: txnsFromPlaid(recent as never), accounts };
    },
  });
}

async function fetchTxns(userId: string, since: string) {
  const out: (Record<string, unknown> & { transaction_id: string; account_id: string; amount: number; date: string })[] = [];
  for (let from = 0; from < 10000; from += 1000) {
    const { data, error } = await db.from("plaid_transactions")
      .select("transaction_id,account_id,amount,date,name,merchant_name,category,pending,pfc_primary,pfc_detailed,pfc_confidence,payment_channel,authorized_date,merchant_entity_id")
      .eq("user_id", userId).gte("date", since).order("date", { ascending: false }).range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as typeof out).map(t => ({ ...t, amount: Number(t.amount) })));
    if (!data || data.length < 1000) break;
  }
  return out as never;
}

/** Occurrence actions for stored streams: Mark paid / Skip this time / this-time-only edit. */
export async function saveOccurrence(userId: string, row: { stream_id: string; period: string; status: "paid" | "skipped" | "expected"; expected_date: string; expected_amount?: number | null }) {
  const { error } = await db.from("stream_occurrences").upsert({
    user_id: userId, stream_id: row.stream_id, period: row.period, status: row.status, expected_date: row.expected_date,
    expected_amount: row.expected_amount ?? null, user_set: true,
  }, { onConflict: "stream_id,period" });
  return !error;
}

// ── settings ──
const lsKey = (uid: string) => `sentryfi:rundown-settings:${uid}`;
const readLocal = (uid: string): RundownSettings | null => {
  try { const v = localStorage.getItem(lsKey(uid)); return v ? normalizeRundownSettings(JSON.parse(v)) : null; } catch { return null; }
};
let demoSettings: RundownSettings = DEFAULT_RUNDOWN_SETTINGS;

/**
 * Rundown settings (buffer, everyday reserve, spendable account toggles),
 * per user in user_settings.rundown_settings (20261104100000). Until that
 * column exists the read/write fails and localStorage is used instead.
 * Demo keeps them in memory.
 */
export function useRundownSettings({ userId, demo }: TimelineSourceOpts) {
  const qc = useQueryClient();
  const key = ["rundown-settings", demo ? "demo" : userId];
  const q = useQuery<RundownSettings>({
    queryKey: key,
    enabled: demo || !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      if (demo) return demoSettings;
      const { data, error } = await db.from("user_settings").select("rundown_settings").eq("user_id", userId).maybeSingle();
      if (error || !data) return readLocal(userId!) ?? DEFAULT_RUNDOWN_SETTINGS;
      const raw = (data as { rundown_settings?: unknown }).rundown_settings;
      return raw && typeof raw === "object" && Object.keys(raw).length ? normalizeRundownSettings(raw) : readLocal(userId!) ?? DEFAULT_RUNDOWN_SETTINGS;
    },
  });
  const [saving, setSaving] = useState(false);
  const save = useCallback(async (next: RundownSettings) => {
    const s = normalizeRundownSettings(next);
    qc.setQueryData(key, s);
    if (demo) { demoSettings = s; return true; }
    if (!userId) return false;
    try { localStorage.setItem(lsKey(userId), JSON.stringify(s)); } catch { /* private mode */ }
    setSaving(true);
    // only this column: never touches anything useUserSettings writes
    const { error } = await db.from("user_settings").upsert({ user_id: userId, rundown_settings: s }, { onConflict: "user_id" });
    setSaving(false);
    if (error) console.warn("[rundown settings] saved on this device only:", error.message);
    return true;
  }, [demo, userId, qc]); // eslint-disable-line react-hooks/exhaustive-deps
  return { settings: q.data ?? DEFAULT_RUNDOWN_SETTINGS, loaded: !q.isPending, save, saving };
}
