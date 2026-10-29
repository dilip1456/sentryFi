import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ClassifierAccount, ClassifierTxn, TxnTypeOverride } from "@/lib/recurring/classifier";
import { addDays, todayLocal } from "@/lib/recurring/dates";
import { detectRecurringSeries } from "@/lib/recurring/detect";
import { toStreamRow } from "@/lib/recurring/rows";
import { findPaycheckAnomalies, type PaycheckAnomaly, type PaycheckTxn } from "@/lib/paycheck-anomaly";
import type { TxnType } from "@/lib/classify";
import {
  buildUpcoming, cursorForJump, demoPage, demoTimeline, eventFromRow, filtersKey, historyCategories, mergeStreams,
  toPage, TIMELINE_PAGE_SIZE, UPCOMING_DAYS_EXTENDED,
  type TimelineCursor, type TimelineEvent, type TimelineFilters, type TimelinePage, type UpcomingAccount,
  type UpcomingMilestone, type UpcomingObligation, type UpcomingStatement, type UpcomingStream,
} from "@/lib/timeline";

// Tables/RPC added by 20261029100000_timeline_events.sql (and a few older
// ones) aren't in the generated types yet: narrow untyped access.
type Res<T> = Promise<{ data: T | null; error: { message: string } | null }>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (t: string) => any; rpc: (fn: string, args: Record<string, unknown>) => Res<Record<string, unknown>[]> };

export interface TimelineSourceOpts { userId: string | null; demo: boolean }

/** History pages (infinite). Demo mode never touches Supabase. */
export function useTimelineFeed({ userId, demo }: TimelineSourceOpts, filters: TimelineFilters, enabled = true) {
  const fk = filtersKey(filters);
  return useInfiniteQuery<TimelinePage, Error>({
    queryKey: ["timeline", demo ? "demo" : userId, fk.types, fk.includeInternal, fk.at],
    enabled: enabled && (demo || !!userId),
    initialPageParam: null as TimelineCursor | null,
    getNextPageParam: last => last.next_cursor,
    staleTime: 60_000,
    queryFn: async ({ pageParam }) => {
      const cursor = (pageParam as TimelineCursor | null) ?? (filters.at ? cursorForJump(filters.at) : null);
      if (demo) {
        await new Promise(r => setTimeout(r, 250)); // let the skeletons show like a real fetch
        return demoPage(cursor, filters);
      }
      const { data, error } = await db.rpc("timeline_page", {
        p_before_on: cursor?.on ?? null,
        p_before_at: cursor?.at ?? null,
        p_before_id: cursor?.id ?? null,
        p_types: historyCategories(filters),
        p_include_internal: filters.includeInternal,
        p_limit: TIMELINE_PAGE_SIZE + 1,
      });
      if (error) throw new Error(error.message);
      return toPage((data ?? []).map(eventFromRow), TIMELINE_PAGE_SIZE);
    },
  });
}

/** Accounts for names ("Covered by", detail rows). */
export function useTimelineAccounts({ userId, demo }: TimelineSourceOpts) {
  return useQuery<UpcomingAccount[]>({
    queryKey: ["timeline-accounts", demo ? "demo" : userId],
    enabled: demo || !!userId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (demo) return demoTimeline().accounts;
      const [{ data: pa }, { data: ma }] = await Promise.all([
        db.from("plaid_accounts").select("account_id,name,official_name,mask,type,subtype,current_balance").eq("user_id", userId),
        db.from("manual_accounts").select("id,name,type,subtype,current_balance").eq("user_id", userId),
      ]);
      const out: UpcomingAccount[] = [];
      for (const a of (pa ?? []) as Record<string, unknown>[]) out.push({ account_id: String(a.account_id), name: (a.name as string) ?? (a.official_name as string) ?? null, mask: (a.mask as string) ?? null, type: (a.type as string) ?? null, subtype: (a.subtype as string) ?? null, current_balance: a.current_balance == null ? null : Number(a.current_balance) });
      for (const a of (ma ?? []) as Record<string, unknown>[]) out.push({ account_id: String(a.id), name: (a.name as string) ?? null, type: (a.type as string) ?? null, subtype: (a.subtype as string) ?? null, current_balance: a.current_balance == null ? null : Number(a.current_balance) });
      return out;
    },
  });
}

async function fetchRecentTxns(userId: string, since: string): Promise<ClassifierTxn[]> {
  const out: ClassifierTxn[] = [];
  for (let from = 0; from < 10000; from += 1000) {
    const { data, error } = await db.from("plaid_transactions")
      .select("transaction_id,account_id,amount,date,name,merchant_name,category,pending,pfc_primary,pfc_detailed,pfc_confidence,payment_channel,authorized_date,merchant_entity_id")
      .eq("user_id", userId).gte("date", since).order("date", { ascending: false }).range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as ClassifierTxn[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/**
 * Upcoming items through `today + UPCOMING_DAYS_EXTENDED` (the panel shows
 * 14 days unless "Show further ahead"). Live: stored recurring_streams merged
 * with src/lib/recurring detection over the last ~25 months, obligations for
 * Covered-by, credit_statements due dates, tax_milestones.
 */
export function useTimelineUpcoming({ userId, demo }: TimelineSourceOpts, enabled = true) {
  const today = todayLocal();
  const through = addDays(today, UPCOMING_DAYS_EXTENDED);
  return useQuery<TimelineEvent[]>({
    queryKey: ["timeline-upcoming", demo ? "demo" : userId, today],
    enabled: enabled && (demo || !!userId),
    staleTime: 10 * 60_000,
    queryFn: async () => {
      if (demo) return demoTimeline(today).upcoming(through);
      const uid = userId!;
      const safe = async <T,>(p: Res<T>): Promise<T | []> => { const { data, error } = await p; if (error) { console.warn("[timeline upcoming]", error.message); return []; } return data ?? []; };
      const [stored, obligations, statements, milestones, accountsRaw, overrides, txns] = await Promise.all([
        safe<UpcomingStream[]>(db.from("recurring_streams").select("*").eq("user_id", uid).neq("status", "dismissed")),
        safe<UpcomingObligation[]>(db.from("obligations").select("id,stream_id,funding_account_id,active").eq("user_id", uid)),
        safe<UpcomingStatement[]>(db.from("credit_statements").select("account_id,statement_issue_date,due_date,statement_balance,minimum_payment_amount").eq("user_id", uid).gte("statement_issue_date", addDays(today, -70))),
        safe<UpcomingMilestone[]>(db.from("tax_milestones").select("id,title,due_date,amount,status,kind,note").eq("user_id", uid).gte("due_date", today).lte("due_date", through)),
        safe<Record<string, unknown>[]>(db.from("plaid_accounts").select("account_id,item_id,name,mask,type,subtype,current_balance").eq("user_id", uid)),
        safe<{ transaction_id: string; txn_type: string }[]>(db.from("txn_overrides").select("transaction_id,txn_type").eq("user_id", uid)),
        fetchRecentTxns(uid, addDays(today, -760)),
      ]);
      const accounts: UpcomingAccount[] = (accountsRaw as Record<string, unknown>[]).map(a => ({ account_id: String(a.account_id), name: (a.name as string) ?? null, mask: (a.mask as string) ?? null, type: (a.type as string) ?? null, subtype: (a.subtype as string) ?? null, current_balance: a.current_balance == null ? null : Number(a.current_balance) }));
      const clsAccounts: ClassifierAccount[] = (accountsRaw as Record<string, unknown>[]).map(a => ({ account_id: String(a.account_id), name: (a.name as string) ?? null, mask: (a.mask as string) ?? null, type: (a.type as string) ?? null, subtype: (a.subtype as string) ?? null }));
      const series = detectRecurringSeries(
        txns.map(t => ({ ...t, amount: Number(t.amount) })),
        clsAccounts,
        { today, overrides: overrides as TxnTypeOverride[] },
      );
      const detected: UpcomingStream[] = series.map(s => ({ ...toStreamRow(s, uid), id: null, last_seen: s.lastSeen }));
      const streams = mergeStreams(stored as UpcomingStream[], detected);
      return buildUpcoming({ today, through, streams, obligations: obligations as UpcomingObligation[], statements: statements as UpcomingStatement[], milestones: milestones as UpcomingMilestone[], accounts });
    },
  });
}

/**
 * Realtime: count new rows (transactions, alerts, paid occurrences) since
 * the panel opened; the UI shows "N new events · Jump to top".
 */
export function useTimelineRealtime({ userId, demo }: TimelineSourceOpts, active: boolean) {
  const [count, setCount] = useState(0);
  const qc = useQueryClient();
  useEffect(() => {
    if (!active || demo || !userId) return;
    const ch = supabase.channel(`timeline-${userId}`);
    for (const table of ["plaid_transactions", "alert_log", "stream_occurrences"]) {
      ch.on("postgres_changes" as never, { event: "INSERT", schema: "public", table, filter: `user_id=eq.${userId}` } as never, () => setCount(c => c + 1));
    }
    ch.subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [active, demo, userId]);
  return useMemo(() => ({
    count,
    reset: () => { setCount(0); qc.invalidateQueries({ queryKey: ["timeline"] }); qc.invalidateQueries({ queryKey: ["timeline-upcoming"] }); },
  }), [count, qc]);
}

/** Oldest day with history ("Start of history" jump, date-picker min). */
export function useTimelineOldest({ userId, demo }: TimelineSourceOpts, enabled = true) {
  return useQuery<string | null>({
    queryKey: ["timeline-oldest", demo ? "demo" : userId],
    enabled: enabled && (demo || !!userId),
    staleTime: 30 * 60_000,
    queryFn: async () => {
      if (demo) return demoTimeline().oldest;
      const { data } = await db.from("plaid_transactions").select("date").eq("user_id", userId).order("date", { ascending: true }).limit(1);
      return ((data ?? [])[0]?.date as string | undefined) ?? null;
    },
  });
}

/**
 * Paycheck anomalies (shortfall / likely-miscategorized paycheck) computed
 * on the client with the same rules the Picture used on main, from income
 * rows of the timeline_events view (txn_type already resolves override >
 * stored classification > PFC). No push alerts; shown as Timeline Alerts.
 */
export function useTimelinePaycheckAlerts({ userId, demo }: TimelineSourceOpts, enabled = true) {
  const today = todayLocal();
  return useQuery<PaycheckAnomaly[]>({
    queryKey: ["timeline-paycheck", demo ? "demo" : userId, today],
    enabled: enabled && (demo || !!userId),
    staleTime: 10 * 60_000,
    queryFn: async () => {
      if (demo) return demoTimeline(today).paycheck;
      const { data, error } = await db.from("timeline_events")
        .select("source_id,occurred_on,amount,pending,title,subtitle,txn_type")
        .eq("user_id", userId).eq("source", "transaction")
        .gte("occurred_on", addDays(today, -190)).lte("occurred_on", today)
        .in("txn_type", ["income_salary", "income_interest", "income_other"])
        .limit(2000);
      if (error) { console.warn("[timeline paycheck]", error.message); return []; }
      const rows = (data ?? []) as Record<string, unknown>[];
      const types = new Map<string, TxnType>();
      const txns: PaycheckTxn[] = rows.map(r => {
        const id = String(r.source_id);
        types.set(id, r.txn_type as TxnType);
        return { id, date: String(r.occurred_on), amount: -Number(r.amount), pending: !!r.pending, merchant_name: (r.title as string) ?? null, name: (r.subtitle as string) ?? null };
      });
      return findPaycheckAnomalies(txns, t => { const type = types.get(t.id); return type ? { type } : undefined; }, new Date(`${today}T12:00:00`));
    },
  });
}

/** Mark an alert read from the detail view (alert_log read-state RLS policy). */
export async function markAlertSeen(alertId: string): Promise<boolean> {
  const { error } = await db.from("alert_log").update({ read_at: new Date().toISOString() }).eq("id", alertId);
  return !error;
}
