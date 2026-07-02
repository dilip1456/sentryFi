import { AlertTriangle, Calendar } from "lucide-react";
import { upcomingTransactions, accounts } from "@/lib/finance-data";
import { fmtUSD } from "@/lib/format";
import { cn } from "@/lib/utils";

const categoryTone: Record<string, string> = {
  "Card payment":  "text-warning",
  "Loan payment":  "text-negative",
  "Subscription":  "text-muted-foreground",
  "Bill":          "text-info",
  "Pool transfer": "text-info",
};

export const UpcomingTransactions = () => {
  const payingAccount = accounts.find((a) => a.isPayingAccount);
  const next14 = upcomingTransactions.filter((t) => t.daysAway <= 14);
  const totalDue = next14.reduce((s, t) => s + t.amount, 0);
  const balance = payingAccount?.balance ?? 0;
  const shortBy = totalDue - balance;
  const isShort = shortBy > 0;

  return (
    <section className="surface-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border/40 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Next 14 days</div>
          <h3 className="font-display text-lg md:text-xl text-primary mt-0.5">Upcoming transactions</h3>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total scheduled</div>
          <div className="font-display text-lg tabular text-negative">−{fmtUSD(totalDue, { compact: true })}</div>
        </div>
      </div>

      {/* Funding alert */}
      {payingAccount && (
        <div className={cn(
          "px-5 py-3 border-b border-border/40 flex items-start gap-3",
          isShort ? "bg-negative/10" : "bg-positive/5",
        )}>
          {isShort ? (
            <AlertTriangle className="h-4 w-4 text-negative shrink-0 mt-0.5" />
          ) : (
            <Calendar className="h-4 w-4 text-positive shrink-0 mt-0.5" />
          )}
          <div className="flex-1 min-w-0 text-[12px]">
            <div className={cn("font-medium", isShort ? "text-negative" : "text-foreground")}>
              {isShort
                ? `${payingAccount.name} is short by ${fmtUSD(shortBy, { compact: true })}`
                : `${payingAccount.name} can cover the next 14 days`}
            </div>
            <div className="text-muted-foreground mt-0.5">
              Balance {fmtUSD(balance, { compact: true })} · scheduled outflow {fmtUSD(totalDue, { compact: true })}
              {isShort && ". Move funds from your high-yield savings before May 1."}
            </div>
          </div>
          {isShort && (
            <button className="text-[11px] font-medium px-3 py-1.5 rounded-md bg-foreground text-background hover:opacity-90 transition-opacity shrink-0">
              Move {fmtUSD(shortBy, { compact: true })}
            </button>
          )}
        </div>
      )}

      <div className="divide-y divide-border/30">
        {next14.map((t) => {
          const Icon = t.icon;
          return (
            <div key={t.id} className="px-5 py-2.5 flex items-center gap-3 hover:bg-surface-hover/30 transition-colors">
              <div className="h-7 w-7 rounded-md bg-secondary/50 border border-border/50 grid place-items-center text-foreground/70 shrink-0">
                <Icon className="h-3.5 w-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[12.5px] text-foreground truncate">{t.label}</span>
                </div>
                <div className="text-[10.5px] text-muted-foreground tabular flex items-center gap-1.5">
                  <span className={categoryTone[t.category]}>{t.category}</span>
                  <span className="opacity-40">·</span>
                  <span>{t.date}</span>
                  {t.daysAway <= 1 && <span className="text-warning">· {t.daysAway === 0 ? "Today" : "Tomorrow"}</span>}
                </div>
              </div>
              <div className="text-[12.5px] tabular text-negative w-20 text-right">
                −{fmtUSD(t.amount, { compact: true })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
