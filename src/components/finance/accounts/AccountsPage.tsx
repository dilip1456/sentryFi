/**
 * Accounts page (review/accounts-redesign/RATIONALE.md §5): net worth hero,
 * every account as a 60px row grouped By type / By bank, Coming due,
 * Connections, sync health with Reconnect, Things to confirm, and a
 * details sheet with Rename or hide. Replaces AccountsPanel and the
 * view === "accounts" block in LivePlaidDashboard.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, EyeOff, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { computeImpliedApy } from "@/lib/accounts/interest";
import { getInstitutionUrl } from "@/lib/accounts/institutions";
import { netWorthTotals } from "@/lib/accounts/totals";
import { buildAccountViews, groupByBank, groupByType, MANUAL_BANK, STALE_DAYS, type AccountView, signInLabel } from "@/lib/accounts/grouping";
import {
  apyFindings, autopayFindings, autopayState, comingDue, detectCardAutopays, dormantFindings, duplicateFindings, KEEP_DAYS,
  type AccountFinding, type ComingDueItem,
} from "@/lib/accounts/findings";
import {
  ACCOUNTS_PREFS_KEY, type AccountMetaEntry, type AccountMetaMap, type AccountsGroupBy, type AccountsPrefs, type CreditDetailLike,
  type InstitutionItem, type ItemHealth, type LinkedAccount, type LoanDetailLike, type ManualAccountLike,
} from "@/lib/accounts/types";
import type { ClassifierTxn } from "@/lib/recurring/classifier";
import { AccountGroupCard } from "./AccountGroup";
import { AccountSheet, type SheetTxn } from "./AccountSheet";
import { AccountsSheet } from "./AccountsSheet";
import { ComingDue } from "./ComingDue";
import { ConnectionsCard, ConnectionsList, type ConnectionRow } from "./Connections";
import { HiddenAccountsSheet } from "./HiddenAccountsSheet";
import { NetWorthHero, type SyncSummary } from "./NetWorthHero";
import { ReconnectSheet } from "./ReconnectSheet";
import { SyncAlert, type BrokenBank } from "./SyncAlert";
import { ThingsToConfirmCard } from "./ThingsToConfirm";
import { usePlaidUpdate } from "./usePlaidUpdate";
import "./accounts.css";

export interface PageTxn extends SheetTxn {
  account_id: string;
  transaction_id: string | null;
  category: string[] | null;
  pfc_primary?: string | null;
  pfc_detailed?: string | null;
  pfc_confidence?: string | null;
  payment_channel?: string | null;
  authorized_date?: string | null;
}

export interface AccountsPageProps<M extends ManualAccountLike = ManualAccountLike> {
  userId?: string;
  demo?: boolean;
  accounts: LinkedAccount[];
  manualAccounts: M[];
  items: InstitutionItem[];
  credit: CreditDetailLike[];
  txns: PageTxn[];
  meta: AccountMetaMap;
  cardAutopayFrom: Record<string, string>;
  /** When the app last loaded balances (fallback sync time). */
  loadedAt: Date | null;
  onSaveMeta: (key: string, patch: Partial<AccountMetaEntry & AccountsPrefs>) => void;
  onSetCardAutopayFrom: (cardAccountId: string, fromAccountId: string) => void;
  onAddAccount: () => void;
  onRemoveLinked: (a: LinkedAccount) => void;
  onEditManual?: (m: M) => void;
  onDeleteManual?: (id: string) => void;
  onReload: () => void;
  onSync: () => void;
  syncing?: boolean;
  onSeeSpending?: () => void;
}

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** Remember a missing-column error so we don't retry it on every open (before the migration). */
const HEALTH_COLS = "id,status,updated_at,error_code,error_at,last_synced_at";
let healthColsMissing = false;

function useItemHealth(userId: string | undefined, demo: boolean | undefined, items: InstitutionItem[], loadedAt: Date | null) {
  const [health, setHealth] = useState<Record<string, ItemHealth>>({});
  const [loans, setLoans] = useState<LoanDetailLike[]>([]);
  const itemKey = items.map(i => i.id).join(",");
  useEffect(() => {
    if (!userId || demo) return;
    let live = true;
    (async () => {
      const db = supabase as unknown as { from: (t: string) => { select: (c: string) => { eq: (c: string, v: string) => PromiseLike<{ data: unknown[] | null; error: { code?: string } | null }> } } };
      let res = healthColsMissing ? null : await db.from("plaid_items").select(HEALTH_COLS).eq("user_id", userId);
      if (!res || res.error) {
        if (res?.error) healthColsMissing = true;
        res = await db.from("plaid_items").select("id,status,updated_at").eq("user_id", userId);
      }
      const ln = await db.from("plaid_loan_details").select("account_id,kind,next_payment_due_date,next_monthly_payment,interest_rate").eq("user_id", userId);
      if (!live) return;
      setHealth(Object.fromEntries(((res?.data ?? []) as ItemHealth[]).map(h => [h.id, h])));
      setLoans(ln.error ? [] : ((ln.data ?? []) as LoanDetailLike[]));
    })().catch(() => { /* health is optional: rows just show no sync state */ });
    return () => { live = false; };
  }, [userId, demo, itemKey, loadedAt]);
  return { health, loans };
}

export function AccountsPage<M extends ManualAccountLike>(p: AccountsPageProps<M>) {
  const { accounts, manualAccounts, items, credit, txns, meta, cardAutopayFrom } = p;
  const [now] = useState(() => new Date());
  const today = now;
  const { health, loans } = useItemHealth(p.userId, p.demo, items, p.loadedAt);
  const prefs = (meta[ACCOUNTS_PREFS_KEY] ?? {}) as AccountsPrefs;
  const groupBy: AccountsGroupBy = prefs.group === "bank" ? "bank" : "type";

  const impliedApy = useMemo(() => {
    const out: Record<string, number | null> = {};
    for (const a of accounts) if (a.type === "depository" && a.subtype === "savings") out[a.account_id] = computeImpliedApy(a, txns).impliedApy;
    return out;
  }, [accounts, txns]);

  const views = useMemo(() => buildAccountViews({ accounts, manual: manualAccounts, items, meta, credit, loans, health, impliedApy }),
    [accounts, manualAccounts, items, meta, credit, loans, health, impliedApy]);
  const totals = useMemo(() => netWorthTotals(accounts, manualAccounts, meta), [accounts, manualAccounts, meta]);
  const shown = views.filter(v => !v.hidden);
  const hiddenViews = views.filter(v => v.hidden);
  const groups = groupBy === "bank" ? groupByBank(views) : groupByType(views);

  const detected = useMemo(() => {
    try {
      const ct = txns.filter((t): t is PageTxn & { transaction_id: string } => !!t.transaction_id) as unknown as (ClassifierTxn & { transaction_id: string })[];
      return detectCardAutopays({ txns: ct, accounts, credit, cardAutopayFrom, today });
    } catch { return {}; }
  }, [txns, accounts, credit, cardAutopayFrom, today]);
  const autopayOf = useCallback((v: AccountView) => autopayState(v, meta, cardAutopayFrom, detected[v.linked?.account_id ?? ""]), [meta, cardAutopayFrom, detected]);

  const itemCreated = useMemo(() => Object.fromEntries(items.map(i => [i.id, i.created_at ?? null])), [items]);
  const findings: AccountFinding[] = useMemo(() => [
    ...autopayFindings(views, meta, cardAutopayFrom, detected, today),
    ...duplicateFindings(views, itemCreated, meta, today),
    ...dormantFindings(views, txns, meta, today),
    ...apyFindings(views, meta, today),
  ], [views, meta, cardAutopayFrom, detected, today, itemCreated, txns]);

  const due: ComingDueItem[] = useMemo(() => comingDue(views, credit, loans, autopayOf, today), [views, credit, loans, autopayOf, today]);

  // Sync health
  const brokenBanks: BrokenBank[] = useMemo(() => {
    const by = new Map<string, BrokenBank>();
    for (const v of views) {
      if (!v.needsSignIn || !v.itemId) continue;
      const b = by.get(v.itemId) ?? { itemId: v.itemId, bankName: v.bankName, accounts: 0, total: 0, since: health[v.itemId]?.last_synced_at ?? health[v.itemId]?.error_at ?? null };
      b.accounts += 1; b.total += v.balance;
      by.set(v.itemId, b);
    }
    return [...by.values()];
  }, [views, health]);
  const snoozedUntil = prefs.snooze ?? {};
  const alertBanks = brokenBanks.filter(b => !(snoozedUntil[b.itemId] && snoozedUntil[b.itemId] > now.toISOString()));
  const lastSyncOf = (itemId: string) => health[itemId]?.last_synced_at ?? health[itemId]?.updated_at ?? null;
  const lastSyncs = items.map(i => lastSyncOf(i.id)).filter((x): x is string => !!x).sort();
  const lastSync = lastSyncs.length ? lastSyncs[lastSyncs.length - 1] : p.loadedAt?.toISOString() ?? null;
  const isStale = (iso: string | null) => !!iso && now.getTime() - new Date(iso).getTime() > STALE_DAYS * 86_400_000;
  const sync: SyncSummary = { banks: items.length, broken: brokenBanks.length, brokenNames: brokenBanks.map(b => b.bankName), lastSync, stale: isStale(lastSync) };
  const connections: ConnectionRow[] = [
    ...items.map(i => {
      const n = views.filter(v => v.itemId === i.id).length;
      const broken = brokenBanks.some(b => b.itemId === i.id);
      const ls = lastSyncOf(i.id) ?? p.loadedAt?.toISOString() ?? null;
      return { key: i.id, itemId: i.id, bankName: i.institution_name ?? "Bank", accounts: n, status: broken ? "broken" as const : isStale(ls) ? "stale" as const : "ok" as const, lastSync: ls };
    }),
    ...(manualAccounts.length ? [{ key: "__manual", itemId: null, bankName: MANUAL_BANK, accounts: manualAccounts.length, status: "manual" as const, lastSync: null }] : []),
  ];

  // Sheets
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [connOpen, setConnOpen] = useState(false);
  const [relinkItem, setRelinkItem] = useState<string | null>(null);
  const openView = views.find(v => v.key === openKey) ?? null;
  const relinkBank = brokenBanks.find(b => b.itemId === relinkItem) ?? null;
  const { start: startReconnect, busy: reconnecting } = usePlaidUpdate(null, "reconnect", p.onReload);
  const reconnect = (itemId: string) => { setRelinkItem(null); setConnOpen(false); startReconnect(itemId); };

  const acceptFinding = (f: AccountFinding) => {
    const v = views.find(x => x.key === f.accountKey);
    if (f.kind === "autopay") {
      p.onSaveMeta(f.accountKey, { autopayConfirmed: true });
      if (v?.linked && f.fromAccountId && !cardAutopayFrom[v.linked.account_id]) p.onSetCardAutopayFrom(v.linked.account_id, f.fromAccountId);
      toast.success("Autopay confirmed");
    } else if (f.kind === "dormant") {
      p.onSaveMeta(f.accountKey, { hidden: true });
      toast.success(`Hidden ${v?.name ?? "account"}`, { description: "It still counts in net worth." });
    } else if (f.kind === "duplicate") {
      p.onSaveMeta(f.accountKey, { hidden: true, excludeFromNetWorth: true });
      toast.success("Hid the copy", { description: "Left out of net worth so it isn't counted twice." });
    } else if (f.kind === "apy" && f.apy != null) {
      p.onSaveMeta(f.accountKey, { apr: f.apy });
      toast.success(`Using ${f.apy}% APY`);
    }
  };
  const dismissFinding = (f: AccountFinding) => {
    const until = isoDay(addDays(today, KEEP_DAYS));
    if (f.kind === "dormant") p.onSaveMeta(f.accountKey, { keepUntil: until });
    else p.onSaveMeta(f.accountKey, { dismissed: { ...(meta[f.accountKey]?.dismissed ?? {}), [f.kind]: until } });
  };

  if (accounts.length === 0 && manualAccounts.length === 0) {
    return (
      <div className="ac">
        <div className="ac-card p-6 text-center text-[13.5px] text-muted-foreground">
          No accounts yet. <button type="button" onClick={p.onAddAccount} className="text-primary underline min-h-11">Link a bank</button>
        </div>
      </div>
    );
  }

  const openDue = (i: ComingDueItem) => setOpenKey(i.key);
  const rail = (
    <>
      <ComingDue items={due} onOpen={openDue} />
      <ConnectionsCard rows={connections} now={now} onRefresh={p.onSync} refreshing={p.syncing} onReconnect={id => setRelinkItem(id)} />
    </>
  );
  const linkedOpen = openView?.linked;
  const autopayFrom = openView?.linked ? (cardAutopayFrom[openView.linked.account_id] ?? detected[openView.linked.account_id]?.fromAccountId ?? null) : null;
  const autopayFromView = autopayFrom ? views.find(v => v.linked?.account_id === autopayFrom) : undefined;

  return (
    <div className="ac ac-wrap animate-fade-up" data-testid="accounts-page">
      <div className="ac-grid">
        <div className="min-w-0">
          <NetWorthHero t={totals} sync={sync} now={now} onConnections={() => setConnOpen(true)} />
          {alertBanks.map(b => <SyncAlert key={b.itemId} b={b} busy={reconnecting} onReconnect={() => reconnect(b.itemId)} onWhy={() => setRelinkItem(b.itemId)} />)}
          <ThingsToConfirmCard findings={findings} onAccept={acceptFinding} onDismiss={dismissFinding} />

          <div className="ac-bar">
            <div className="seg" role="group" aria-label="Group accounts">
              <button type="button" aria-pressed={groupBy === "type"} onClick={() => p.onSaveMeta(ACCOUNTS_PREFS_KEY, { group: "type" })}>By type</button>
              <button type="button" aria-pressed={groupBy === "bank"} onClick={() => p.onSaveMeta(ACCOUNTS_PREFS_KEY, { group: "bank" })}>By bank</button>
            </div>
            <button type="button" className="btn-gold hidden md:inline-flex" onClick={p.onAddAccount}><Plus className="h-4 w-4" aria-hidden />Add account</button>
          </div>

          {groups.map(g => <AccountGroupCard key={g.key} g={g} by={groupBy} today={today} onOpen={v => setOpenKey(v.key)} onReconnect={id => setRelinkItem(id)} />)}
          {shown.length === 0 && <div className="ac-card text-[13.5px] text-muted-foreground pb-3">Every account is hidden.</div>}

          {hiddenViews.length > 0 && (
            <button type="button" className="ac-foot" onClick={() => { toast.dismiss(); setHiddenOpen(true); }} data-testid="ac-hidden-row">
              <EyeOff className="h-4 w-4" aria-hidden />Hidden accounts<ChevronRight className="r h-4 w-4" aria-hidden />
            </button>
          )}
          <button type="button" className="ac-foot add md:hidden" onClick={p.onAddAccount}><Plus className="h-4 w-4" aria-hidden />Add or link an account</button>
          <div className="ac-rail-m"><ComingDue items={due} onOpen={openDue} /></div>
        </div>
        <aside className="ac-rail" aria-label="Coming due and connections">{rail}</aside>
      </div>

      <AccountSheet
        v={openView}
        meta={openView ? (meta[openView.key] ?? {}) : {}}
        credit={linkedOpen ? credit.find(c => c.account_id === linkedOpen.account_id) : undefined}
        loan={linkedOpen ? loans.find(l => l.account_id === linkedOpen.account_id) : undefined}
        txns={linkedOpen ? txns.filter(t => t.account_id === linkedOpen.account_id) : []}
        autopay={openView ? autopayOf(openView) : null}
        autopayFromName={autopayFromView ? `${autopayFromView.name}${autopayFromView.mask ? ` ··${autopayFromView.mask}` : ""}` : null}
        findings={openView ? findings.filter(f => f.accountKey === openView.key) : []}
        instUrl={openView ? (openView.kind === "linked" ? getInstitutionUrl(openView.bankName, meta[openView.key]?.customUrl) : meta[openView.key]?.customUrl ?? null) : null}
        lastSync={openView?.itemId ? lastSyncOf(openView.itemId) ?? p.loadedAt?.toISOString() ?? null : null}
        today={today}
        onClose={() => setOpenKey(null)}
        onSave={s => {
          if (!openView) return;
          p.onSaveMeta(openView.key, s);
          if (s.hidden && !openView.hidden) toast.success(`Hidden ${s.nickname || openView.name}`, { description: "Find it under Hidden accounts at the bottom of the list." });
        }}
        onAcceptFinding={acceptFinding}
        onDismissFinding={dismissFinding}
        onDisconnect={() => { if (linkedOpen) { setOpenKey(null); p.onRemoveLinked(linkedOpen); } }}
        onEditManual={openView?.manual && p.onEditManual ? () => { const m = openView.manual as M; setOpenKey(null); p.onEditManual!(m); } : undefined}
        onDeleteManual={openView?.manual && p.onDeleteManual ? () => { const id = openView.manual!.id; setOpenKey(null); p.onDeleteManual!(id); } : undefined}
        onReload={p.onReload}
        onSeeAll={p.onSeeSpending}
      />
      <HiddenAccountsSheet open={hiddenOpen && hiddenViews.length > 0} views={hiddenViews} onClose={() => setHiddenOpen(false)}
        onShow={v => { p.onSaveMeta(v.key, { hidden: false, excludeFromNetWorth: false }); toast.success(`${v.name} is back in the list`); }} />
      <AccountsSheet open={connOpen} onClose={() => setConnOpen(false)} title="Connections" subtitle={signInLabel(brokenBanks.map(b => b.bankName), "All banks synced · Plaid")} testId="ac-connections-sheet">
        <ConnectionsList rows={connections} now={now} onRefresh={p.onSync} refreshing={p.syncing} onReconnect={id => { setConnOpen(false); setRelinkItem(id); }} />
      </AccountsSheet>
      <ReconnectSheet bank={relinkBank} views={views} busy={reconnecting} onClose={() => setRelinkItem(null)}
        onReconnect={() => relinkBank && reconnect(relinkBank.itemId)}
        onSnooze={() => {
          if (!relinkBank) return;
          p.onSaveMeta(ACCOUNTS_PREFS_KEY, { snooze: { ...snoozedUntil, [relinkBank.itemId]: addDays(now, 1).toISOString() } });
          setRelinkItem(null);
          toast("We'll remind you tomorrow", { description: "Its accounts stay marked Needs sign-in." });
        }} />
    </div>
  );
}
