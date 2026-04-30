import { useState, useMemo } from "react";
import {
  cardBenefits, refinanceOptions, accounts,
  type CardBenefit, type RefinanceOption,
} from "@/lib/finance-data";
import { fmtUSD } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  AlertCircle, Check, X, Sparkles, ArrowRight, TrendingDown,
  Calendar, Zap, Info,
} from "lucide-react";
import { CollapsibleSection } from "./CollapsibleSection";

const statusMeta: Record<CardBenefit["status"], { label: string; chip: string; dot: string }> = {
  unused:   { label: "Unused",   chip: "bg-negative/10 text-negative border-negative/20", dot: "bg-negative" },
  partial:  { label: "Partial",  chip: "bg-warning/10 text-warning border-warning/20",    dot: "bg-warning" },
  used:     { label: "Used",     chip: "bg-positive/10 text-positive border-positive/20", dot: "bg-positive" },
  expiring: { label: "Expiring", chip: "bg-warning/15 text-warning border-warning/30 animate-pulse", dot: "bg-warning" },
};

/* ----------------------- Benefit tile ----------------------- */
const BenefitTile = ({ b, onClick }: { b: CardBenefit; onClick: () => void }) => {
  const Icon = b.icon;
  const remaining = Math.max(0, b.value - b.used);
  const pct = b.value > 0 ? (b.used / b.value) * 100 : 100;
  const sm = statusMeta[b.status];

  return (
    <button
      onClick={onClick}
      className="group surface-card p-3.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-border-strong"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="h-8 w-8 rounded-md bg-secondary/60 border border-border/60 grid place-items-center text-foreground/80">
          <Icon className="h-3.5 w-3.5" />
        </div>
        <span className={cn("text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border", sm.chip)}>
          {sm.label}
        </span>
      </div>
      <div className="mt-2.5 text-[12px] text-foreground font-medium leading-tight line-clamp-2">{b.name}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{b.cardName}</div>

      <div className="mt-2.5 flex items-baseline justify-between">
        <div>
          <div className="font-display text-base tabular text-foreground leading-none">
            {fmtUSD(remaining, { compact: true })}
          </div>
          <div className="text-[10px] text-muted-foreground tabular mt-0.5">left of {fmtUSD(b.value, { compact: true })}</div>
        </div>
        <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{b.cycle}</div>
      </div>

      <div className="mt-2 h-1 rounded-full bg-secondary overflow-hidden">
        <div
          className={cn(
            "h-full transition-all",
            b.status === "used" ? "bg-positive" : b.status === "partial" ? "bg-warning" : "bg-negative/40",
          )}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </button>
  );
};

const BenefitDetail = ({ b, onClose }: { b: CardBenefit | null; onClose: () => void }) => {
  if (!b) return null;
  const Icon = b.icon;
  const sm = statusMeta[b.status];
  const remaining = Math.max(0, b.value - b.used);

  return (
    <Dialog open={!!b} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md surface-elevated p-0 gap-0 overflow-hidden">
        <div className="p-6 relative">
          <button onClick={onClose} className="absolute top-4 right-4 h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-hover">
            <X className="h-4 w-4" />
          </button>
          <div className="h-11 w-11 rounded-xl bg-secondary/60 border border-border-strong grid place-items-center">
            <Icon className="h-5 w-5 text-foreground" />
          </div>
          <div className="mt-3 text-[10px] uppercase tracking-wider text-muted-foreground">{b.cardName} · {b.category}</div>
          <div className="font-display text-xl text-foreground mt-0.5">{b.name}</div>
          <div className={cn("mt-3 inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] uppercase tracking-wider border", sm.chip)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", sm.dot)} /> {sm.label} · {b.resetDate}
          </div>
        </div>
        <div className="hairline grid grid-cols-3 divide-x divide-border/60">
          <Stat label="Total value" value={fmtUSD(b.value)} />
          <Stat label="Used" value={fmtUSD(b.used)} accent="warning" />
          <Stat label="Remaining" value={fmtUSD(remaining)} accent="positive" />
        </div>
        <div className="hairline p-5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">How to redeem</div>
          <p className="text-sm text-foreground leading-relaxed">{b.how}</p>
        </div>
        <div className="hairline p-4">
          <button className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-foreground text-background px-3 py-2 text-xs font-medium">
            <Zap className="h-3.5 w-3.5" /> Mark as used / set reminder
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const Stat = ({ label, value, accent }: { label: string; value: string; accent?: "positive" | "warning" }) => (
  <div className="p-4">
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    <div className={cn("mt-1 font-display text-base tabular",
      accent === "positive" && "text-positive",
      accent === "warning" && "text-warning",
      !accent && "text-foreground",
    )}>{value}</div>
  </div>
);

/* ----------------------- Refinance row ----------------------- */
const recoMeta: Record<RefinanceOption["recommendation"], { label: string; chip: string }> = {
  strong:   { label: "Strong refi",   chip: "bg-positive/10 text-positive border-positive/20" },
  consider: { label: "Worth a look",  chip: "bg-warning/10 text-warning border-warning/20" },
  skip:     { label: "Skip",          chip: "bg-secondary text-muted-foreground border-border" },
};

const RefinanceRow = ({ r }: { r: RefinanceOption }) => {
  const acc = accounts.find((a) => a.id === r.loanId);
  const m = recoMeta[r.recommendation];
  const rateDelta = r.currentRate - r.offeredRate;

  return (
    <div className="surface-card p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-sm font-medium text-foreground">{r.loanName}</div>
            <span className={cn("text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border", m.chip)}>
              {m.label}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {acc?.institution} → {r.lender} · balance {fmtUSD(Math.abs(acc?.balance ?? 0), { compact: true })}
          </div>
        </div>

        <div className="flex items-center gap-4 tabular">
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Current</div>
            <div className="font-display text-sm text-foreground">{r.currentRate.toFixed(2)}%</div>
          </div>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Offered</div>
            <div className="font-display text-sm text-positive">{r.offeredRate.toFixed(2)}%</div>
          </div>
          <div className="text-right pl-3 border-l border-border/60">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">−{rateDelta.toFixed(2)}pp</div>
            <div className="font-display text-sm text-positive">{fmtUSD(r.monthlySavings)}/mo</div>
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
        <Pill label="Closing cost" value={r.closingCost === 0 ? "Free" : fmtUSD(r.closingCost)} />
        <Pill label="Breakeven"    value={r.monthsToBreakeven === 0 ? "Immediate" : `${r.monthsToBreakeven} mo`} />
        <Pill label="Lifetime save" value={fmtUSD(r.lifetimeSavings, { compact: true })} accent="positive" />
        <Pill label="Recommendation" value={m.label} />
      </div>

      <div className="mt-3 flex items-start gap-2 text-[11px] text-muted-foreground bg-surface/40 rounded-md px-3 py-2 border border-border/40">
        <Info className="h-3 w-3 mt-0.5 shrink-0" />
        <span>{r.notes}</span>
      </div>
    </div>
  );
};

const Pill = ({ label, value, accent }: { label: string; value: string; accent?: "positive" }) => (
  <div className="rounded-md border border-border/60 bg-surface/40 px-2.5 py-1.5">
    <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
    <div className={cn("text-[12px] tabular font-medium mt-0.5", accent === "positive" ? "text-positive" : "text-foreground")}>
      {value}
    </div>
  </div>
);

/* ----------------------- Main section ----------------------- */
export const BenefitsSection = () => {
  const [selected, setSelected] = useState<CardBenefit | null>(null);
  const [filter, setFilter] = useState<"all" | "unused" | "expiring">("all");

  const filtered = useMemo(() => {
    if (filter === "all") return cardBenefits;
    if (filter === "expiring") return cardBenefits.filter((b) => b.status === "expiring");
    return cardBenefits.filter((b) => b.status === "unused" || b.status === "expiring");
  }, [filter]);

  const totalAnnual = useMemo(() =>
    cardBenefits.reduce((s, b) => s + (b.cycle === "monthly" ? b.value * 12 : b.cycle === "quarterly" ? b.value * 4 : b.value), 0),
  []);
  const leftOnTable = useMemo(() =>
    cardBenefits.reduce((s, b) => s + Math.max(0, b.value - b.used), 0),
  []);
  const refiSavings = useMemo(() =>
    refinanceOptions.filter((r) => r.recommendation !== "skip").reduce((s, r) => s + r.lifetimeSavings, 0),
  []);

  return (
    <div className="space-y-5 animate-fade-up">
      {/* Headline */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Headline label="Benefits annual value" value={fmtUSD(totalAnnual, { compact: true })} sub="Across all your cards" tone="info" icon={<Sparkles className="h-4 w-4" />} />
        <Headline label="Unused this cycle"     value={fmtUSD(leftOnTable, { compact: true })} sub="Money on the table — claim it" tone="warning" icon={<AlertCircle className="h-4 w-4" />} />
        <Headline label="Refinance opportunity" value={fmtUSD(refiSavings, { compact: true })} sub="Lifetime savings if you switch"  tone="positive" icon={<TrendingDown className="h-4 w-4" />} />
      </div>

      {/* Card benefits */}
      <CollapsibleSection
        title="Card benefits & credits"
        subtitle="Recurring credits, lounge access, and reimbursements."
        trailing={
          <div className="hidden md:inline-flex items-center gap-1 text-[11px] text-warning tabular">
            <AlertCircle className="h-3 w-3" />
            {fmtUSD(leftOnTable, { compact: true })} unused
          </div>
        }
      >
        <div className="flex items-center gap-1 mb-3">
          {(["all", "unused", "expiring"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-3 py-1 rounded-full text-[11px] capitalize transition-colors",
                filter === f ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground border border-border/60",
              )}
            >
              {f}
              {f === "expiring" && <span className="ml-1 text-warning">•</span>}
            </button>
          ))}
          <span className="ml-2 text-[11px] text-muted-foreground tabular">{filtered.length} item{filtered.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map((b) => <BenefitTile key={b.id} b={b} onClick={() => setSelected(b)} />)}
        </div>
      </CollapsibleSection>

      {/* Refinance opportunities */}
      <CollapsibleSection
        title="Refinance opportunities"
        subtitle="Current market rates compared against your loans, net of closing costs."
        trailing={
          <div className="hidden md:inline-flex items-center gap-1 text-[11px] text-positive tabular">
            <Check className="h-3 w-3" />
            {refinanceOptions.filter((r) => r.recommendation !== "skip").length} actionable
          </div>
        }
      >
        <div className="space-y-3">
          {refinanceOptions.map((r) => <RefinanceRow key={r.id} r={r} />)}
        </div>
      </CollapsibleSection>

      <BenefitDetail b={selected} onClose={() => setSelected(null)} />
    </div>
  );
};

const Headline = ({ label, value, sub, tone, icon }: { label: string; value: string; sub: string; tone: "info" | "warning" | "positive"; icon: React.ReactNode }) => {
  const toneClass = {
    info: "text-info bg-info/10 border-info/20",
    warning: "text-warning bg-warning/10 border-warning/20",
    positive: "text-positive bg-positive/10 border-positive/20",
  }[tone];
  return (
    <div className="surface-card p-4 flex items-center gap-3">
      <div className={cn("h-10 w-10 rounded-lg grid place-items-center border", toneClass)}>{icon}</div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="font-display text-xl tabular text-foreground leading-tight">{value}</div>
        <div className="text-[10.5px] text-muted-foreground truncate">{sub}</div>
      </div>
    </div>
  );
};
