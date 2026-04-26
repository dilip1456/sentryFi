import { useState } from "react";
import { ChevronDown, ChevronRight, MoreHorizontal, TrendingUp, TrendingDown } from "lucide-react";
import { fmtUSD, fmtPct } from "@/lib/format";
import { accounts, groupMeta, type AccountGroup, type Account } from "@/lib/finance-data";
import { cn } from "@/lib/utils";

const groupOrder: AccountGroup[] = ["cash", "credit", "investments", "liabilities"];

const accentRing: Record<Account["accent"], string> = {
  mint: "from-positive/20 to-transparent text-positive",
  sky: "from-info/20 to-transparent text-info",
  amber: "from-warning/20 to-transparent text-warning",
  coral: "from-negative/20 to-transparent text-negative",
  violet: "from-[hsl(280_70%_65%)]/20 to-transparent text-[hsl(280_70%_75%)]",
};

const AccountRow = ({ account }: { account: Account }) => {
  const Icon = account.icon;
  const isDebt = account.balance < 0;
  const utilization = account.limit ? Math.abs(account.balance) / account.limit : null;
  const trendUp = account.trend30d > 0;
  const trendGood = isDebt ? !trendUp : trendUp;

  return (
    <div className="group relative grid grid-cols-[auto_1fr_auto] items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-hover/40">
      <div className={cn("relative h-11 w-11 rounded-xl border border-border-strong bg-gradient-to-br grid place-items-center", accentRing[account.accent])}>
        <Icon className="h-5 w-5" />
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground truncate">{account.name}</span>
          {account.promo && <span className="chip chip-positive !py-0.5 !px-2 !text-[10px]">{account.promo}</span>}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{account.institution}</span>
          {account.last4 && <span>· ••{account.last4}</span>}
          {account.apr !== undefined && (
            <span className={cn(
              "ml-1",
              account.group === "cash" && account.apr > 1 && "text-positive",
              (account.group === "credit" || account.group === "liabilities") && account.apr > 5 && "text-negative",
            )}>
              · {account.apr.toFixed(2)}% APR
            </span>
          )}
        </div>

        {utilization !== null && (
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1 flex-1 max-w-[180px] rounded-full bg-secondary overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  utilization > 0.5 ? "bg-negative" : utilization > 0.3 ? "bg-warning" : "bg-positive"
                )}
                style={{ width: `${Math.min(utilization * 100, 100)}%` }}
              />
            </div>
            <span className="text-[10px] tabular text-muted-foreground">
              {(utilization * 100).toFixed(0)}% of {fmtUSD(account.limit!, { compact: true })}
            </span>
          </div>
        )}
      </div>

      <div className="text-right">
        <div className={cn(
          "font-display text-xl tabular",
          isDebt ? "text-negative" : "text-foreground"
        )}>
          {isDebt ? "−" : ""}{fmtUSD(Math.abs(account.balance))}
        </div>
        <div className={cn(
          "mt-0.5 inline-flex items-center gap-1 text-[11px] tabular",
          trendGood ? "text-positive" : "text-negative"
        )}>
          {trendUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {fmtPct(account.trend30d, 1)} · 30d
        </div>
      </div>
    </div>
  );
};

const AccountGroupCard = ({ group }: { group: AccountGroup }) => {
  const [open, setOpen] = useState(true);
  const items = accounts.filter((a) => a.group === group);
  const total = items.reduce((sum, a) => sum + a.balance, 0);
  const meta = groupMeta[group];
  const isDebt = total < 0;

  return (
    <div className="surface-card overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-surface-hover/30"
      >
        <div className="flex items-center gap-3">
          <div className="h-7 w-7 grid place-items-center rounded-md bg-secondary text-muted-foreground">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </div>
          <div>
            <div className="font-display text-lg text-foreground">{meta.label}</div>
            <div className="text-xs text-muted-foreground">{meta.description} · {items.length} accounts</div>
          </div>
        </div>
        <div className="text-right">
          <div className={cn(
            "font-display text-2xl tabular",
            isDebt ? "text-negative" : "text-foreground"
          )}>
            {isDebt ? "−" : ""}{fmtUSD(Math.abs(total))}
          </div>
        </div>
      </button>

      {open && (
        <div className="hairline divide-y divide-border/60 animate-fade-up">
          {items.map((a) => <AccountRow key={a.id} account={a} />)}
        </div>
      )}
    </div>
  );
};

export const AccountsSection = () => {
  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">01 — Overview</div>
          <h2 className="font-display text-3xl md:text-4xl mt-1 text-primary">Where your money lives</h2>
        </div>
        <button className="hidden md:flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <MoreHorizontal className="h-4 w-4" /> Manage
        </button>
      </div>

      <div className="grid gap-4">
        {groupOrder.map((g) => <AccountGroupCard key={g} group={g} />)}
      </div>
    </section>
  );
};
