import { useState } from "react";
import { Lightbulb, ArrowRight, Check, X, AlertCircle } from "lucide-react";
import { insights, type Insight } from "@/lib/finance-data";
import { cn } from "@/lib/utils";

const severityStyles: Record<Insight["severity"], { dot: string; label: string; ring: string }> = {
  high:   { dot: "bg-negative", label: "High impact", ring: "ring-negative/30" },
  medium: { dot: "bg-warning",  label: "Medium",      ring: "ring-warning/30" },
  low:    { dot: "bg-info",     label: "Low",         ring: "ring-info/30" },
};

const InsightCard = ({ insight, expanded, onToggle, onDismiss }: {
  insight: Insight; expanded: boolean; onToggle: () => void; onDismiss: () => void;
}) => {
  const sev = severityStyles[insight.severity];
  return (
    <div className={cn(
      "surface-card overflow-hidden transition-all duration-300",
      expanded && "ring-1 ring-positive/40 shadow-[var(--shadow-glow)]"
    )}>
      <button onClick={onToggle} className="w-full text-left p-5 hover:bg-surface-hover/30 transition-colors">
        <div className="flex items-start gap-4">
          <div className={cn("relative mt-1.5 h-2 w-2 rounded-full", sev.dot)}>
            <div className={cn("absolute inset-0 rounded-full animate-pulse-glow", sev.dot, "opacity-50 blur-sm")} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
              <span>{insight.category}</span>
              <span className="opacity-40">·</span>
              <span>{sev.label}</span>
            </div>
            <h3 className="font-display text-lg md:text-xl mt-1 text-foreground leading-snug">
              {insight.title}
            </h3>
          </div>

          <div className="text-right shrink-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Estimated</div>
            <div className="font-display text-xl tabular text-positive">{insight.impact}</div>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="hairline px-5 py-5 space-y-4 animate-fade-up bg-surface/60">
          <Detail label="What's happening" body={insight.what} />
          <Detail label="Why it matters" body={insight.why} />
          <Detail label="Suggested action" body={insight.action} accent />

          <div className="flex flex-wrap gap-2 pt-2">
            <button className="inline-flex items-center gap-2 rounded-full bg-positive px-4 py-2 text-xs font-medium text-positive-foreground hover:opacity-90 transition-opacity">
              <Check className="h-3.5 w-3.5" /> Apply suggestion
            </button>
            <button className="inline-flex items-center gap-2 rounded-full border border-border-strong px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
              Learn more <ArrowRight className="h-3.5 w-3.5" />
            </button>
            <button onClick={(e) => { e.stopPropagation(); onDismiss(); }} className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-3.5 w-3.5" /> Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
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

export const InsightsSection = () => {
  const [expandedId, setExpandedId] = useState<string | null>(insights[0].id);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const visible = insights.filter((i) => !dismissed.has(i.id));
  const totalImpact = visible.reduce((s, i) => s + i.impactValue, 0);

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">02 — Intelligence</div>
          <h2 className="font-display text-3xl md:text-4xl mt-1 text-primary">
            Insights & opportunities
          </h2>
        </div>

        <div className="surface-card px-4 py-2.5 flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-positive/15 grid place-items-center">
            <Lightbulb className="h-4 w-4 text-positive" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Annualized opportunity</div>
            <div className="font-display text-lg tabular text-positive">+${totalImpact.toLocaleString()} / yr</div>
          </div>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="surface-card p-12 text-center">
          <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">All caught up — no active suggestions.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {visible.map((insight) => (
            <InsightCard
              key={insight.id}
              insight={insight}
              expanded={expandedId === insight.id}
              onToggle={() => setExpandedId(expandedId === insight.id ? null : insight.id)}
              onDismiss={() => setDismissed(new Set([...dismissed, insight.id]))}
            />
          ))}
        </div>
      )}
    </section>
  );
};
