import { useState, Fragment } from "react";
import {
  TrendingUp, TrendingDown, ChevronDown, ChevronRight, Lock,
  ExternalLink, Sparkles, Plus,
} from "lucide-react";
import { fmtUSD, fmtPct } from "@/lib/format";
import { accounts, type Account, type Bucket, bucketMeta } from "@/lib/finance-data";
import { cn } from "@/lib/utils";

const accentText: Record<Account["accent"], string> = {
  mint:   "text-positive",
  sky:    "text-info",
  amber:  "text-warning",
  coral:  "text-negative",
  violet: "text-[hsl(280_70%_75%)]",
};

const toneText: Record<"positive" | "negative" | "info" | "warning", string> = {
  positive: "text-positive",
  negative: "text-negative",
  info:     "text-info",
  warning:  "text-warning",
};

const toneDot: Record<"positive" | "negative" | "info" | "warning", string> = {
  positive: "bg-positive",
  negative: "bg-negative",
  info:     "bg-info",
  warning:  "bg-warning",
};

/* ---------------- expandable detail (inline) ---------------- */
const DetailRow = ({ a }: { a: Account }) => {
  const isDebt = a.balance < 0;
  const utilization = a.limit ? Math.abs(a.balance) / a.limit : null;
  const yearlyInterest = a.apr !== undefined ? (a.balance * a.apr / 100) : 0;
  const principalPaid = a.originalBalance ? a.originalBalance - Math.abs(a.balance) : null;
  const progress = a.originalBalance ? (principalPaid! / a.originalBalance) * 100 : null;

  return (
    <div className="px-4 md:px-5 py-3.5 bg-surface/40 border-t border-border/40 animate-fade-up">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {a.apr !== undefined && (
          <Mini
            label={isDebt ? "Annual interest cost" : "Annual interest earned"}
            value={`${isDebt ? "−" : "+"}${fmtUSD(Math.abs(yearlyInterest), { compact: true })}`}
            tone={isDebt ? "negative" : "positive"}
          />
        )}
        {a.statementDue !== undefined && (
          <Mini label="Statement due" value={fmtUSD(a.statementDue)} tone="warning" />
        )}
        {a.dueDay && (
          <Mini label="Due day" value={`Day ${a.dueDay}`} tone="info" />
        )}
        {a.emi !== undefined && (
          <Mini label="Monthly payment" value={fmtUSD(a.emi)} tone="warning" />
        )}
        {a.termMonthsLeft && (
          <Mini label="Months remaining" value={`${a.termMonthsLeft}`} tone="info" />
        )}
        {utilization !== null && (
          <Mini
            label="Credit used"
            value={`${(utilization * 100).toFixed(0)}% of ${fmtUSD(a.limit!, { compact: true })}`}
            tone={utilization > 0.5 ? "negative" : utilization > 0.3 ? "warning" : "positive"}
          />
        )}
      </div>

      {progress !== null && (
        <div className="mt-3">
          <div className="flex justify-between text-[10.5px] text-muted-foreground tabular mb-1">
            <span>Paid off {progress.toFixed(0)}%</span>
            <span>{fmtUSD(a.originalBalance!, { compact: true })} original</span>
          </div>
          <div className="h-1 rounded-full bg-secondary overflow-hidden">
            <div className="h-full rounded-full bg-positive transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {a.promo && (
        <div className="mt-3 inline-flex items-center gap-1.5 chip chip-positive">
          <Sparkles className="h-3 w-3" /> {a.promo}
        </div>
      )}

      <button className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
        <ExternalLink className="h-3 w-3" /> Open at {a.institution}
      </button>
    </div>
  );
};

const Mini = ({ label, value, tone }: { label: string; value: string; tone: "positive" | "negative" | "info" | "warning" }) => (
  <div>
    <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">{label}</div>
    <div className={cn("text-[12.5px] tabular font-medium mt-0.5", toneText[tone])}>{value}</div>
  </div>
);

/* ---------------- compact row ---------------- */
const AccountRow = ({
  a, expanded, onToggle,
}: { a: Account; expanded: boolean; onToggle: () => void }) => {
  const Icon = a.icon;
  const isDebt = a.balance < 0;
  const trendUp = a.trend30d > 0;
  const trendGood = isDebt ? !trendUp : trendUp;
  const utilization = a.limit ? Math.abs(a.balance) / a.limit : null;

  return (
    <Fragment>
      <button
        onClick={onToggle}
        className={cn(
          "w-full grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 px-4 md:px-5 py-2.5 text-left transition-colors",
          expanded ? "bg-surface-hover/40" : "hover:bg-surface-hover/30",
        )}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <ChevronRight className={cn("h-3 w-3 text-muted-foreground transition-transform shrink-0", expanded && "rotate-90")} />
          <div className={cn("h-7 w-7 rounded-md grid place-items-center bg-secondary/50 border border-border/50 shrink-0", accentText[a.accent])}>
            <Icon className="h-3.5 w-3.5" />
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] text-foreground truncate">{a.name}</span>
            {a.isPayingAccount && (
              <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-info/30 bg-info/10 text-info">
                Pays bills
              </span>
            )}
            {a.promo && (
              <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-positive/30 bg-positive/10 text-positive">
                0% APR
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-[10.5px] text-muted-foreground tabular">
            <span>{a.institution}{a.last4 && ` ··${a.last4}`}</span>
            {a.apr !== undefined && (
              <>
                <span className="opacity-40">·</span>
                <span>{a.apr.toFixed(2)}% {isDebt ? "APR" : "APY"}</span>
              </>
            )}
            {a.emi && (
              <>
                <span className="opacity-40">·</span>
                <span className="text-warning">{fmtUSD(a.emi, { compact: true })}/mo</span>
              </>
            )}
            {utilization !== null && (
              <>
                <span className="opacity-40">·</span>
                <span className={cn(
                  utilization > 0.5 ? "text-negative" : utilization > 0.3 ? "text-warning" : "",
                )}>
                  {(utilization * 100).toFixed(0)}% used
                </span>
              </>
            )}
          </div>
        </div>

        <div className={cn(
          "inline-flex items-center gap-0.5 text-[10.5px] tabular",
          trendGood ? "text-positive" : "text-negative",
        )}>
          {trendUp ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
          {fmtPct(a.trend30d, 1)}
        </div>

        <div className={cn(
          "text-right text-[13.5px] font-medium tabular w-24",
          isDebt ? "text-negative" : "text-foreground",
        )}>
          {isDebt ? "−" : ""}{fmtUSD(Math.abs(a.balance), { compact: true })}
        </div>
      </button>

      {expanded && <DetailRow a={a} />}
    </Fragment>
  );
};

/* ---------------- bucket table ---------------- */
const BucketTable = ({
  bucket, items, expandedId, onToggle, defaultOpen = true,
}: {
  bucket: Bucket;
  items: Account[];
  expandedId: string | null;
  onToggle: (id: string) => void;
  defaultOpen?: boolean;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const meta = bucketMeta[bucket];
  if (items.length === 0) return null;

  const total = items.reduce((s, a) => s + a.balance, 0);
  const monthlyEmi = items.reduce((s, a) => s + (a.emi ?? 0), 0);
  const monthlyStatement = items.reduce((s, a) => s + (a.statementDue ?? 0), 0);
  const yearlyInterest = items.reduce((s, a) => s + (a.apr ? (a.balance * a.apr) / 100 : 0), 0);
  const isDebt = total < 0;

  let trailing: string | null = null;
  if (bucket === "liquid" && yearlyInterest > 0) trailing = `Earning +${fmtUSD(yearlyInterest, { compact: true })}/yr`;
  if (bucket === "revolving") trailing = `${fmtUSD(monthlyStatement, { compact: true })} due this cycle`;
  if (bucket === "term") trailing = `${fmtUSD(monthlyEmi, { compact: true })}/mo · ${fmtUSD(Math.abs(yearlyInterest), { compact: true })} interest/yr`;
  if (bucket === "longterm") trailing = "Held for the future";

  return (
    <div className="surface-card overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-4 px-4 md:px-5 py-3.5 hover:bg-surface-hover/40 transition-colors text-left border-b border-border/40"
      >
        <div className="flex items-center gap-3 min-w-0">
          <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform shrink-0", !open && "-rotate-90")} />
          <div className={cn("h-1.5 w-1.5 rounded-full", toneDot[meta.tone])} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-display text-base md:text-lg text-foreground">{meta.label}</h3>
              {bucket === "longterm" && <Lock className="h-3 w-3 text-muted-foreground" />}
              <span className="text-[10.5px] text-muted-foreground tabular">· {items.length}</span>
            </div>
            <div className="text-[11px] text-muted-foreground truncate">{meta.sub}</div>
          </div>
        </div>

        <div className="text-right shrink-0">
          <div className={cn(
            "font-display text-xl md:text-2xl tabular leading-none",
            isDebt ? "text-negative" : "text-foreground",
          )}>
            {isDebt ? "−" : ""}{fmtUSD(Math.abs(total), { compact: true })}
          </div>
          {trailing && (
            <div className={cn("text-[10.5px] tabular mt-1", toneText[meta.tone])}>{trailing}</div>
          )}
        </div>
      </button>

      {open && (
        <div className="divide-y divide-border/30">
          {items.map((a) => (
            <AccountRow
              key={a.id}
              a={a}
              expanded={expandedId === a.id}
              onToggle={() => onToggle(a.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/* ---------------- main ---------------- */
export const AccountsSection = ({ onAddAccount }: { onAddAccount?: () => void } = {}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const byBucket = (b: Bucket) => accounts.filter((a) => a.bucket === b);
  const toggle = (id: string) => setExpandedId((curr) => (curr === id ? null : id));

  return (
    <section className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-4 px-1">
        <h2 className="font-display text-base md:text-lg text-primary">Accounts</h2>
        <span className="text-[11px] text-muted-foreground">Tap a row for details</span>
      </div>

      <div className="space-y-2.5">
        <BucketTable bucket="liquid"    items={byBucket("liquid")}    expandedId={expandedId} onToggle={toggle} />
        <BucketTable bucket="revolving" items={byBucket("revolving")} expandedId={expandedId} onToggle={toggle} />
        <BucketTable bucket="term"      items={byBucket("term")}      expandedId={expandedId} onToggle={toggle} />
        <BucketTable bucket="longterm"  items={byBucket("longterm")}  expandedId={expandedId} onToggle={toggle} defaultOpen={false} />

        {onAddAccount && (
          <button
            onClick={onAddAccount}
            className="w-full surface-card border-dashed py-3 inline-flex items-center justify-center gap-2 text-[12px] text-muted-foreground hover:text-foreground hover:border-border-strong transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> Link a bank, card, loan or brokerage via Plaid
          </button>
        )}
      </div>
    </section>
  );
};
