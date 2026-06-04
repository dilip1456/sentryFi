import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fmtUSD } from "@/lib/format";
import { Loader2, RefreshCw, Plus, Building2, CreditCard, Landmark, TrendingUp, Home } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type PAccount = {
  id: string;
  account_id: string;
  name: string | null;
  official_name: string | null;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  current_balance: number | null;
  available_balance: number | null;
  iso_currency_code: string | null;
};

type PTxn = {
  id: string;
  account_id: string;
  amount: number;
  date: string;
  name: string | null;
  merchant_name: string | null;
  category: string[] | null;
  pending: boolean | null;
};

const typeIcon = (type: string | null) => {
  if (type === "credit") return CreditCard;
  if (type === "loan") return Home;
  if (type === "investment") return TrendingUp;
  return Landmark;
};

const isDebt = (type: string | null) => type === "credit" || type === "loan";

interface Props {
  onAddAccount: () => void;
  hasItems: boolean;
}

export const LivePlaidDashboard = ({ onAddAccount, hasItems }: Props) => {
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [accounts, setAccounts] = useState<PAccount[]>([]);
  const [txns, setTxns] = useState<PTxn[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: accs }, { data: t }] = await Promise.all([
      supabase.from("plaid_accounts").select("*").order("type"),
      supabase.from("plaid_transactions").select("*").order("date", { ascending: false }).limit(50),
    ]);
    setAccounts((accs ?? []) as PAccount[]);
    setTxns((t ?? []) as PTxn[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const sync = async () => {
    setSyncing(true);
    const { data, error } = await supabase.functions.invoke("plaid-sync-transactions");
    setSyncing(false);
    if (error || data?.error) {
      toast.error("Sync failed", { description: error?.message ?? data?.error });
      return;
    }
    toast.success(`Synced ${data?.synced ?? 0} transactions`);
    load();
  };

  if (loading) {
    return (
      <div className="min-h-[40vh] grid place-items-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const assets = accounts
    .filter((a) => !isDebt(a.type))
    .reduce((s, a) => s + (Number(a.current_balance) || 0), 0);
  const liabilities = accounts
    .filter((a) => isDebt(a.type))
    .reduce((s, a) => s + (Number(a.current_balance) || 0), 0);
  const netWorth = assets - liabilities;

  return (
    <div className="space-y-4 animate-fade-up">
      {/* Net worth header */}
      <div className="surface-elevated p-5 md:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Net worth</div>
            <div className="font-display text-3xl md:text-4xl text-foreground tabular mt-1">
              {fmtUSD(netWorth)}
            </div>
            <div className="mt-2 flex items-center gap-3 text-[11.5px] tabular">
              <span className="text-positive">Assets {fmtUSD(assets, { compact: true })}</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-negative">Liabilities {fmtUSD(liabilities, { compact: true })}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={sync}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border-strong text-[12px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
              {syncing ? "Syncing…" : "Sync"}
            </button>
            <button
              onClick={onAddAccount}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-gold text-[12px] font-medium hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" /> Link
            </button>
          </div>
        </div>
      </div>

      {/* Accounts */}
      <section className="space-y-2.5">
        <div className="flex items-baseline justify-between px-1">
          <h2 className="font-display text-base md:text-lg text-primary">Accounts</h2>
          <span className="text-[11px] text-muted-foreground">{accounts.length} linked</span>
        </div>

        {accounts.length === 0 ? (
          <div className="surface-card p-6 text-center text-[12px] text-muted-foreground">
            No accounts yet. Link a bank to get started.
          </div>
        ) : (
          <div className="surface-card divide-y divide-border/30 overflow-hidden">
            {accounts.map((a) => {
              const Icon = typeIcon(a.type);
              const debt = isDebt(a.type);
              const bal = Number(a.current_balance) || 0;
              return (
                <div key={a.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 md:px-5 py-3">
                  <div className="h-8 w-8 rounded-md grid place-items-center bg-secondary/50 border border-border/50 text-gold">
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] text-foreground truncate">{a.name ?? a.official_name ?? "Account"}</div>
                    <div className="text-[10.5px] text-muted-foreground tabular">
                      {(a.subtype ?? a.type ?? "").toString()}{a.mask && ` ··${a.mask}`}
                    </div>
                  </div>
                  <div className={cn("text-right text-[13.5px] font-medium tabular", debt ? "text-negative" : "text-foreground")}>
                    {debt ? "−" : ""}{fmtUSD(Math.abs(bal), { compact: true })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Transactions */}
      <section className="space-y-2.5">
        <div className="flex items-baseline justify-between px-1">
          <h2 className="font-display text-base md:text-lg text-primary">Recent transactions</h2>
          <span className="text-[11px] text-muted-foreground">{txns.length}</span>
        </div>

        {txns.length === 0 ? (
          <div className="surface-card p-6 text-center text-[12px] text-muted-foreground">
            {hasItems ? "No transactions yet — try Sync." : "Link an account to see transactions."}
          </div>
        ) : (
          <div className="surface-card divide-y divide-border/30 overflow-hidden">
            {txns.map((t) => (
              <div key={t.id} className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 md:px-5 py-2.5">
                <div className="min-w-0">
                  <div className="text-[13px] text-foreground truncate">
                    {t.merchant_name ?? t.name ?? "Transaction"}
                    {t.pending && (
                      <span className="ml-2 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-warning/30 bg-warning/10 text-warning">
                        Pending
                      </span>
                    )}
                  </div>
                  <div className="text-[10.5px] text-muted-foreground tabular">
                    {new Date(t.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    {t.category?.[0] && ` · ${t.category[0]}`}
                  </div>
                </div>
                <div className={cn(
                  "text-right text-[13px] tabular font-medium",
                  Number(t.amount) < 0 ? "text-positive" : "text-foreground",
                )}>
                  {Number(t.amount) < 0 ? "+" : "−"}{fmtUSD(Math.abs(Number(t.amount)), { compact: true })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
