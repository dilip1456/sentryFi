import { useState } from "react";
import { MoreHorizontal, TrendingUp, TrendingDown, X, ExternalLink, Copy, Sparkles } from "lucide-react";
import { fmtUSD, fmtPct } from "@/lib/format";
import { accounts, groupMeta, type AccountGroup, type Account } from "@/lib/finance-data";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent } from "@/components/ui/dialog";

const groupOrder: AccountGroup[] = ["cash", "credit", "investments", "liabilities"];

const accentRing: Record<Account["accent"], string> = {
  mint: "from-positive/25 to-transparent text-positive ring-positive/20",
  sky: "from-info/25 to-transparent text-info ring-info/20",
  amber: "from-warning/25 to-transparent text-warning ring-warning/20",
  coral: "from-negative/25 to-transparent text-negative ring-negative/20",
  violet: "from-[hsl(280_70%_65%)]/25 to-transparent text-[hsl(280_70%_75%)] ring-[hsl(280_70%_65%)]/20",
};

const groupAccent: Record<AccountGroup, string> = {
  cash: "text-positive",
  credit: "text-warning",
  investments: "text-info",
  liabilities: "text-negative",
};

const AccountTile = ({ account, onClick }: { account: Account; onClick: () => void }) => {
  const Icon = account.icon;
  const isDebt = account.balance < 0;
  const trendUp = account.trend30d > 0;
  const trendGood = isDebt ? !trendUp : trendUp;

  return (
    <button
      onClick={onClick}
      className="group surface-card relative overflow-hidden p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-elevated)] hover:border-border-strong"
    >
      <div className="flex items-start justify-between">
        <div className={cn(
          "h-9 w-9 rounded-lg border border-border-strong bg-gradient-to-br grid place-items-center ring-1",
          accentRing[account.accent]
        )}>
          <Icon className="h-4 w-4" />
        </div>
        {account.promo && (
          <span className="chip chip-positive !py-0 !px-1.5 !text-[9px] uppercase tracking-wider">0% APR</span>
        )}
      </div>

      <div className="mt-3 text-[11px] text-muted-foreground truncate">
        {account.institution}{account.last4 && ` · ••${account.last4}`}
      </div>
      <div className="text-sm font-medium text-foreground truncate">{account.name}</div>

      <div className={cn(
        "mt-2 font-display text-lg tabular leading-tight",
        isDebt ? "text-negative" : "text-foreground"
      )}>
        {isDebt ? "−" : ""}{fmtUSD(Math.abs(account.balance), { compact: true })}
      </div>

      <div className="mt-1 flex items-center justify-between text-[10px] tabular">
        <span className={cn("inline-flex items-center gap-1", trendGood ? "text-positive" : "text-negative")}>
          {trendUp ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
          {fmtPct(account.trend30d, 1)}
        </span>
        {account.apr !== undefined && (
          <span className="text-muted-foreground">{account.apr.toFixed(2)}%</span>
        )}
      </div>

      {/* hover affordance */}
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-foreground/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
};

const AccountDetail = ({ account, onClose }: { account: Account | null; onClose: () => void }) => {
  if (!account) return null;
  const Icon = account.icon;
  const isDebt = account.balance < 0;
  const utilization = account.limit ? Math.abs(account.balance) / account.limit : null;
  const trendUp = account.trend30d > 0;
  const trendGood = isDebt ? !trendUp : trendUp;
  const yearlyInterest = account.apr !== undefined ? (account.balance * account.apr / 100) : 0;

  return (
    <Dialog open={!!account} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md surface-elevated border-border p-0 gap-0 overflow-hidden">
        <div className="relative p-6">
          <button onClick={onClose} className="absolute top-4 right-4 h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors">
            <X className="h-4 w-4" />
          </button>

          <div className={cn(
            "h-12 w-12 rounded-xl border border-border-strong bg-gradient-to-br grid place-items-center ring-1",
            accentRing[account.accent]
          )}>
            <Icon className="h-5 w-5" />
          </div>

          <div className="mt-4 text-xs uppercase tracking-wider text-muted-foreground">
            {account.institution}{account.last4 && ` · ••${account.last4}`}
          </div>
          <div className="font-display text-2xl text-foreground mt-0.5">{account.name}</div>

          <div className={cn(
            "mt-4 font-display text-4xl tabular",
            isDebt ? "text-negative" : "text-foreground"
          )}>
            {isDebt ? "−" : ""}{fmtUSD(Math.abs(account.balance))}
          </div>

          {account.promo && (
            <div className="mt-2 chip chip-positive">
              <Sparkles className="h-3 w-3" /> {account.promo}
            </div>
          )}
        </div>

        <div className="hairline grid grid-cols-2 divide-x divide-border/60">
          <Stat label="30-day trend" value={fmtPct(account.trend30d, 1)} accent={trendGood ? "positive" : "negative"} />
          {account.apr !== undefined && (
            <Stat
              label={isDebt ? "Interest cost / yr" : "Interest earned / yr"}
              value={`${isDebt ? "−" : "+"}${fmtUSD(Math.abs(yearlyInterest), { compact: true })}`}
              accent={isDebt ? "negative" : "positive"}
            />
          )}
        </div>

        {utilization !== null && (
          <div className="hairline p-6">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground uppercase tracking-wider">Credit utilization</span>
              <span className="tabular text-foreground">{(utilization * 100).toFixed(0)}%</span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-secondary overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  utilization > 0.5 ? "bg-negative" : utilization > 0.3 ? "bg-warning" : "bg-positive"
                )}
                style={{ width: `${Math.min(utilization * 100, 100)}%` }}
              />
            </div>
            <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground tabular">
              <span>{fmtUSD(Math.abs(account.balance))} used</span>
              <span>{fmtUSD(account.limit!)} limit</span>
            </div>
          </div>
        )}

        <div className="hairline p-4 flex gap-2">
          <button className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-foreground text-background px-3 py-2 text-xs font-medium hover:opacity-90 transition-opacity">
            <ExternalLink className="h-3.5 w-3.5" /> Open at {account.institution}
          </button>
          <button className="inline-flex items-center justify-center gap-2 rounded-lg border border-border-strong px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const Stat = ({ label, value, accent }: { label: string; value: string; accent?: "positive" | "negative" }) => (
  <div className="p-4">
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    <div className={cn(
      "mt-1 font-display text-lg tabular",
      accent === "positive" && "text-positive",
      accent === "negative" && "text-negative",
    )}>{value}</div>
  </div>
);

const GroupBlock = ({ group, onPick }: { group: AccountGroup; onPick: (a: Account) => void }) => {
  const items = accounts.filter((a) => a.group === group);
  const total = items.reduce((sum, a) => sum + a.balance, 0);
  const meta = groupMeta[group];
  const isDebt = total < 0;

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3 px-1">
        <div className="flex items-baseline gap-3">
          <div className={cn("text-xs uppercase tracking-[0.18em] font-medium", groupAccent[group])}>{meta.label}</div>
          <div className="text-[11px] text-muted-foreground">{items.length} accounts</div>
        </div>
        <div className={cn(
          "font-display text-base tabular",
          isDebt ? "text-negative" : "text-foreground"
        )}>
          {isDebt ? "−" : ""}{fmtUSD(Math.abs(total), { compact: true })}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {items.map((a) => <AccountTile key={a.id} account={a} onClick={() => onPick(a)} />)}
      </div>
    </div>
  );
};

export const AccountsSection = () => {
  const [selected, setSelected] = useState<Account | null>(null);

  return (
    <section className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">01 — Overview</div>
          <h2 className="font-display text-3xl md:text-4xl mt-1 text-primary">Where your money lives</h2>
          <p className="text-xs text-muted-foreground mt-1.5">Tap any account for details, rates, and actions.</p>
        </div>
        <button className="hidden md:flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <MoreHorizontal className="h-4 w-4" /> Manage
        </button>
      </div>

      <div className="space-y-6">
        {groupOrder.map((g) => <GroupBlock key={g} group={g} onPick={setSelected} />)}
      </div>

      <AccountDetail account={selected} onClose={() => setSelected(null)} />
    </section>
  );
};
