import { useState } from "react";
import {
  TrendingUp, TrendingDown, X, ExternalLink, Sparkles, ChevronRight, Lock,
  Calendar, AlertCircle,
} from "lucide-react";
import { fmtUSD, fmtPct } from "@/lib/format";
import { accounts, type Account, type Bucket, bucketMeta } from "@/lib/finance-data";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent } from "@/components/ui/dialog";

const accentDot: Record<Account["accent"], string> = {
  mint:   "bg-positive",
  sky:    "bg-info",
  amber:  "bg-warning",
  coral:  "bg-negative",
  violet: "bg-[hsl(280_70%_65%)]",
};

const accentText: Record<Account["accent"], string> = {
  mint:   "text-positive",
  sky:    "text-info",
  amber:  "text-warning",
  coral:  "text-negative",
  violet: "text-[hsl(280_70%_75%)]",
};

const toneRing: Record<"positive" | "negative" | "info" | "warning", string> = {
  positive: "ring-positive/15 from-positive/10",
  negative: "ring-negative/15 from-negative/10",
  info:     "ring-info/15 from-info/10",
  warning:  "ring-warning/15 from-warning/10",
};

const toneText: Record<"positive" | "negative" | "info" | "warning", string> = {
  positive: "text-positive",
  negative: "text-negative",
  info:     "text-info",
  warning:  "text-warning",
};

/* ---------------------- compact account row ---------------------- */
const AccountRow = ({ account, onClick }: { account: Account; onClick: () => void }) => {
  const Icon = account.icon;
  const isDebt = account.balance < 0;
  const trendUp = account.trend30d > 0;
  const trendGood = isDebt ? !trendUp : trendUp;
  const utilization = account.limit ? Math.abs(account.balance) / account.limit : null;

  return (
    <button
      onClick={onClick}
      className="group w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-hover/60 transition-colors text-left"
    >
      <div className={cn("h-7 w-7 rounded-md grid place-items-center bg-secondary/60 border border-border/60", accentText[account.accent])}>
        <Icon className="h-3.5 w-3.5" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] text-foreground truncate">{account.name}</span>
          {account.last4 && <span className="text-[10px] text-muted-foreground tabular">··{account.last4}</span>}
          {account.promo && <span className="chip chip-positive !py-0 !px-1.5 !text-[9px]">0%</span>}
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-[10.5px] text-muted-foreground tabular">
          {account.apr !== undefined && (
            <span>{account.apr.toFixed(2)}% APR</span>
          )}
          {utilization !== null && (
            <>
              <span className="opacity-40">·</span>
              <span className={cn(
                utilization > 0.5 ? "text-negative" : utilization > 0.3 ? "text-warning" : "text-muted-foreground"
              )}>
                {(utilization * 100).toFixed(0)}% used
              </span>
            </>
          )}
          {account.emi && (
            <>
              <span className="opacity-40">·</span>
              <span className="text-warning">{fmtUSD(account.emi, { compact: true })}/mo EMI</span>
            </>
          )}
        </div>
      </div>

      <div className="text-right">
        <div className={cn(
          "text-[13px] font-medium tabular leading-none",
          isDebt ? "text-negative" : "text-foreground"
        )}>
          {isDebt ? "−" : ""}{fmtUSD(Math.abs(account.balance), { compact: true })}
        </div>
        <div className={cn(
          "mt-1 inline-flex items-center gap-0.5 text-[10px] tabular leading-none",
          trendGood ? "text-positive" : "text-negative"
        )}>
          {trendUp ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
          {fmtPct(account.trend30d, 1)}
        </div>
      </div>

      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
};

/* ---------------------- institution group ---------------------- */
const InstitutionBlock = ({
  institution,
  items,
  onPick,
}: {
  institution: string;
  items: Account[];
  onPick: (a: Account) => void;
}) => {
  const total = items.reduce((s, a) => s + a.balance, 0);
  const isDebt = total < 0;

  return (
    <div className="rounded-lg border border-border/60 bg-surface/40 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/40 bg-surface/60">
        <div className="flex items-center gap-2">
          <div className={cn("h-1.5 w-1.5 rounded-full", accentDot[items[0].accent])} />
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{institution}</span>
          <span className="text-[10px] text-muted-foreground/70">· {items.length}</span>
        </div>
        <span className={cn(
          "text-[11px] tabular font-medium",
          isDebt ? "text-negative" : "text-foreground"
        )}>
          {isDebt ? "−" : ""}{fmtUSD(Math.abs(total), { compact: true })}
        </span>
      </div>
      <div className="divide-y divide-border/30">
        {items.map((a) => <AccountRow key={a.id} account={a} onClick={() => onPick(a)} />)}
      </div>
    </div>
  );
};

/* ---------------------- bucket card ---------------------- */
const BucketCard = ({
  bucket,
  items,
  onPick,
}: {
  bucket: Bucket;
  items: Account[];
  onPick: (a: Account) => void;
}) => {
  const meta = bucketMeta[bucket];
  if (items.length === 0) return null;

  // Group by institution
  const byInst = items.reduce<Record<string, Account[]>>((acc, a) => {
    (acc[a.institution] ??= []).push(a);
    return acc;
  }, {});

  // Headline metrics per bucket
  const total = items.reduce((s, a) => s + a.balance, 0);
  const yearlyInterest = items.reduce((s, a) => s + (a.apr ? (a.balance * a.apr) / 100 : 0), 0);
  const monthlyEmi = items.reduce((s, a) => s + (a.emi ?? 0), 0);
  const monthlyStatement = items.reduce((s, a) => s + (a.statementDue ?? 0), 0);

  const isDebt = total < 0;

  return (
    <div className={cn(
      "surface-card relative overflow-hidden flex flex-col ring-1",
      toneRing[meta.tone]
    )}>
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-20 opacity-50 bg-gradient-to-b to-transparent"
        style={{
          backgroundImage: `radial-gradient(60% 80% at 50% 0%, hsl(var(--${meta.tone === "info" ? "info" : meta.tone}) / 0.10), transparent 70%)`,
        }}
      />

      <div className="relative px-5 pt-5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className={cn("text-[10px] uppercase tracking-[0.22em] font-medium", toneText[meta.tone])}>
              {meta.label}
            </div>
            <div className="font-display text-2xl md:text-3xl tabular text-foreground mt-1">
              {isDebt ? "−" : ""}{fmtUSD(Math.abs(total), { compact: true })}
            </div>
            <div className="text-[11px] text-muted-foreground mt-1">{meta.sub}</div>
          </div>

          <div className="text-right space-y-0.5 shrink-0">
            {bucket === "liquid" && yearlyInterest > 0 && (
              <Metric label="earning" value={`+${fmtUSD(yearlyInterest, { compact: true })}/yr`} tone="positive" />
            )}
            {bucket === "longterm" && (
              <Metric label="locked" value={fmtUSD(Math.abs(total), { compact: true })} tone="info" icon={<Lock className="h-2.5 w-2.5" />} />
            )}
            {bucket === "revolving" && (
              <Metric label="due this cycle" value={fmtUSD(monthlyStatement, { compact: true })} tone="warning" />
            )}
            {bucket === "term" && (
              <>
                <Metric label="EMI / mo" value={fmtUSD(monthlyEmi, { compact: true })} tone="negative" />
                <Metric label="interest / yr" value={fmtUSD(Math.abs(yearlyInterest), { compact: true })} tone="negative" />
              </>
            )}
          </div>
        </div>
      </div>

      <div className="relative px-3 pb-3 space-y-2 flex-1">
        {Object.entries(byInst).map(([inst, list]) => (
          <InstitutionBlock key={inst} institution={inst} items={list} onPick={onPick} />
        ))}
      </div>
    </div>
  );
};

const Metric = ({ label, value, tone, icon }: { label: string; value: string; tone: "positive" | "negative" | "info" | "warning"; icon?: React.ReactNode }) => (
  <div className="text-right">
    <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
    <div className={cn("text-[12px] tabular font-medium inline-flex items-center gap-1", toneText[tone])}>
      {icon}{value}
    </div>
  </div>
);

/* ---------------------- detail dialog (kept tight) ---------------------- */
const AccountDetail = ({ account, onClose }: { account: Account | null; onClose: () => void }) => {
  if (!account) return null;
  const Icon = account.icon;
  const isDebt = account.balance < 0;
  const utilization = account.limit ? Math.abs(account.balance) / account.limit : null;
  const trendUp = account.trend30d > 0;
  const trendGood = isDebt ? !trendUp : trendUp;
  const yearlyInterest = account.apr !== undefined ? (account.balance * account.apr / 100) : 0;
  const principalPaid = account.originalBalance ? account.originalBalance - Math.abs(account.balance) : null;
  const progress = account.originalBalance ? (principalPaid! / account.originalBalance) * 100 : null;

  return (
    <Dialog open={!!account} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md surface-elevated border-border p-0 gap-0 overflow-hidden">
        <div className="relative p-6">
          <button onClick={onClose} className="absolute top-4 right-4 h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors">
            <X className="h-4 w-4" />
          </button>

          <div className={cn("h-11 w-11 rounded-xl grid place-items-center bg-secondary/60 border border-border-strong", accentText[account.accent])}>
            <Icon className="h-5 w-5" />
          </div>

          <div className="mt-3 text-[11px] uppercase tracking-wider text-muted-foreground">
            {account.institution}{account.last4 && ` · ··${account.last4}`}
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

        {/* Revolving extras */}
        {account.statementDue !== undefined && (
          <div className="hairline px-6 py-4 grid grid-cols-2 gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Statement due</div>
              <div className="font-display text-lg tabular text-warning mt-0.5">{fmtUSD(account.statementDue)}</div>
            </div>
            {account.dueDay && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Due day</div>
                <div className="font-display text-lg tabular text-foreground mt-0.5 inline-flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  {account.dueDay}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Term loan extras */}
        {account.emi !== undefined && (
          <div className="hairline px-6 py-4 space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Monthly EMI</div>
                <div className="font-display text-lg tabular text-warning mt-0.5">{fmtUSD(account.emi)}</div>
              </div>
              {account.termMonthsLeft && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Months left</div>
                  <div className="font-display text-lg tabular text-foreground mt-0.5">{account.termMonthsLeft}</div>
                </div>
              )}
            </div>
            {progress !== null && (
              <div>
                <div className="flex justify-between text-[11px] text-muted-foreground tabular mb-1.5">
                  <span>Paid off {progress.toFixed(0)}%</span>
                  <span>{fmtUSD(account.originalBalance!, { compact: true })} original</span>
                </div>
                <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                  <div className="h-full rounded-full bg-positive transition-all" style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}
          </div>
        )}

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

        <div className="hairline p-4">
          <button className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-foreground text-background px-3 py-2 text-xs font-medium hover:opacity-90 transition-opacity">
            <ExternalLink className="h-3.5 w-3.5" /> Open at {account.institution}
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

/* ---------------------- main section ---------------------- */
export const AccountsSection = () => {
  const [selected, setSelected] = useState<Account | null>(null);

  const byBucket = (b: Bucket) => accounts.filter((a) => a.bucket === b);

  // Net worth excluding long-term locked
  const liquid = byBucket("liquid").reduce((s, a) => s + a.balance, 0);
  const revolving = byBucket("revolving").reduce((s, a) => s + a.balance, 0);
  const spendableNetWorth = liquid + revolving;

  return (
    <section className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">01 — Overall picture</div>
          <h2 className="font-display text-3xl md:text-4xl mt-1 text-primary">Where your money lives</h2>
          <p className="text-xs text-muted-foreground mt-1.5 max-w-xl">
            Compact rows, grouped by bank. Long-term assets are shown separately so they don't inflate what you actually have available.
          </p>
        </div>
        <div className="hidden md:block text-right">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Spendable net</div>
          <div className={cn(
            "font-display text-2xl tabular",
            spendableNetWorth >= 0 ? "text-foreground" : "text-negative"
          )}>
            {spendableNetWorth < 0 ? "−" : ""}{fmtUSD(Math.abs(spendableNetWorth), { compact: true })}
          </div>
        </div>
      </div>

      {/* Top row — Have & Owe (revolving + term) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <BucketCard bucket="liquid"    items={byBucket("liquid")}    onPick={setSelected} />
        <BucketCard bucket="revolving" items={byBucket("revolving")} onPick={setSelected} />
        <BucketCard bucket="term"      items={byBucket("term")}      onPick={setSelected} />
      </div>

      {/* Long-term assets — visually demoted */}
      <div>
        <div className="flex items-center gap-2 px-1 mb-2">
          <Lock className="h-3 w-3 text-muted-foreground" />
          <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-medium">
            Long-term & locked
          </span>
          <span className="text-[10px] text-muted-foreground/70">
            · not part of "what you have" — counted toward future-you
          </span>
        </div>
        <BucketCard bucket="longterm" items={byBucket("longterm")} onPick={setSelected} />
      </div>

      <AccountDetail account={selected} onClose={() => setSelected(null)} />
    </section>
  );
};
