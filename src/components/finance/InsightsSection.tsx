import { useState } from "react";
import { ArrowRight, Check, X, AlertCircle, Sparkles, TrendingUp, Coins, CreditCard, Receipt } from "lucide-react";
import { insights, type Insight } from "@/lib/finance-data";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

const severityStyles: Record<Insight["severity"], { dot: string; label: string; chip: string }> = {
  high:   { dot: "bg-negative", label: "High",   chip: "chip-negative" },
  medium: { dot: "bg-warning",  label: "Medium", chip: "chip-warning" },
  low:    { dot: "bg-info",     label: "Low",    chip: "chip" },
};

const categoryIcon: Record<Insight["category"], typeof Sparkles> = {
  "Rewards": Sparkles,
  "0% APR": CreditCard,
  "Idle Cash": Coins,
  "Debt": TrendingUp,
  "Tax": Receipt,
};

const InsightCard = ({ insight, onOpen, onDismiss }: {
  insight: Insight; onOpen: () => void; onDismiss: () => void;
}) => {
  const sev = severityStyles[insight.severity];
  const Icon = categoryIcon[insight.category];
  return (
    <button
      onClick={onOpen}
      className="group surface-card relative overflow-hidden p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[var(--shadow-elevated)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="h-8 w-8 rounded-lg bg-secondary/60 grid place-items-center text-foreground/80">
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex items-center gap-1.5">
          <div className={cn("h-1.5 w-1.5 rounded-full", sev.dot)}>
            <div className={cn("absolute h-1.5 w-1.5 rounded-full animate-pulse-glow", sev.dot, "opacity-50 blur-sm")} />
          </div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{insight.category}</span>
        </div>
      </div>

      <h3 className="font-display text-base mt-3 text-foreground leading-snug line-clamp-2">
        {insight.title}
      </h3>

      <div className="mt-3 pt-3 border-t border-border/60 flex items-end justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Opportunity</div>
          <div className="font-display text-lg tabular text-positive leading-tight">{insight.impact}</div>
        </div>
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground group-hover:text-foreground transition-colors">
          Details <ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
        </span>
      </div>
    </button>
  );
};

const InsightDialog = ({ insight, onClose, onDismiss }: {
  insight: Insight | null; onClose: () => void; onDismiss: (id: string) => void;
}) => {
  if (!insight) return null;
  const sev = severityStyles[insight.severity];
  const Icon = categoryIcon[insight.category];
  return (
    <Dialog open={!!insight} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg surface-elevated border-border p-0 gap-0 overflow-hidden">
        <DialogTitle className="sr-only">{insight.title}</DialogTitle>
        <DialogDescription className="sr-only">Insight details and recommended action.</DialogDescription>
        <div className="relative p-6 pb-4">
          <button onClick={onClose} className="absolute top-4 right-4 h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors">
            <X className="h-4 w-4" />
          </button>

          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-secondary/60 grid place-items-center">
              <Icon className="h-4 w-4 text-foreground" />
            </div>
            <div className="flex items-center gap-2">
              <span className={cn("chip !py-0.5 !px-2 !text-[10px]", sev.chip)}>
                <span className={cn("h-1.5 w-1.5 rounded-full", sev.dot)} /> {sev.label} impact
              </span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{insight.category}</span>
            </div>
          </div>

          <h3 className="font-display text-xl md:text-2xl mt-4 text-foreground leading-snug">
            {insight.title}
          </h3>

          <div className="mt-4 inline-flex items-baseline gap-2 rounded-lg bg-positive/10 border border-positive/20 px-3 py-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Estimated</span>
            <span className="font-display text-lg tabular text-positive">{insight.impact}</span>
          </div>
        </div>

        <div className="hairline p-6 space-y-4">
          <Detail label="What's happening" body={insight.what} />
          <Detail label="Why it matters" body={insight.why} />
          <Detail label="Suggested action" body={insight.action} accent />
        </div>

        <div className="hairline p-4 flex flex-wrap gap-2">
          <button className="flex-1 min-w-[140px] inline-flex items-center justify-center gap-2 rounded-lg bg-positive px-4 py-2 text-xs font-medium text-positive-foreground hover:opacity-90 transition-opacity">
            <Check className="h-3.5 w-3.5" /> Apply suggestion
          </button>
          <button className="inline-flex items-center justify-center gap-2 rounded-lg border border-border-strong px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
            Learn more <ArrowRight className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => { onDismiss(insight.id); onClose(); }}
            className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" /> Dismiss
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const Detail = ({ label, body, accent }: { label: string; body: string; accent?: boolean }) => (
  <div>
    <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-1">{label}</div>
    <p className={cn(
      "text-sm leading-relaxed",
      accent ? "text-foreground" : "text-muted-foreground"
    )}>{body}</p>
  </div>
);

export const InsightsSection = ({ compact = false }: { compact?: boolean } = {}) => {
  const [openId, setOpenId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const visible = insights.filter((i) => !dismissed.has(i.id));
  const totalImpact = visible.reduce((s, i) => s + i.impactValue, 0);
  const open = visible.find((i) => i.id === openId) ?? null;

  return (
    <section className={cn("space-y-3", compact && "surface-card p-4")}>
      {compact ? (
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base md:text-lg text-primary">Opportunities</h2>
          <span className="font-display text-sm tabular text-positive">+${totalImpact.toLocaleString()}/yr</span>
        </div>
      ) : (
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <h2 className="font-display text-xl md:text-2xl text-primary">Opportunities</h2>
          <span className="font-display text-base tabular text-positive">+${totalImpact.toLocaleString()}/yr potential</span>
        </div>
      )}

      {visible.length === 0 ? (
        <div className="surface-card p-8 text-center">
          <AlertCircle className="h-6 w-6 mx-auto text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">All caught up — no active suggestions.</p>
          <button
            onClick={() => setDismissed(new Set())}
            className="mt-3 text-xs text-foreground underline-offset-4 hover:underline"
          >
            Reset dismissed
          </button>
        </div>
      ) : (
        <div className={cn(
          "grid gap-3",
          compact ? "grid-cols-1 sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3",
        )}>
          {visible.map((insight) => (
            <InsightCard
              key={insight.id}
              insight={insight}
              onOpen={() => setOpenId(insight.id)}
              onDismiss={() => setDismissed(new Set([...dismissed, insight.id]))}
            />
          ))}
        </div>
      )}

      <InsightDialog
        insight={open}
        onClose={() => setOpenId(null)}
        onDismiss={(id) => setDismissed(new Set([...dismissed, id]))}
      />
    </section>
  );
};
