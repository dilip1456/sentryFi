import { useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { actionItems, type ActionPriority } from "@/lib/finance-data";
import { cn } from "@/lib/utils";

const priorityMeta: Record<ActionPriority, { label: string; dot: string; text: string; chip: string }> = {
  urgent: { label: "Urgent", dot: "bg-negative", text: "text-negative", chip: "border-negative/30 bg-negative/10 text-negative" },
  soon:   { label: "Soon",   dot: "bg-warning",  text: "text-warning",  chip: "border-warning/30 bg-warning/10 text-warning" },
  info:   { label: "FYI",    dot: "bg-info",     text: "text-info",     chip: "border-info/30 bg-info/10 text-info" },
};

export const ActionableItems = () => {
  const [done, setDone] = useState<Set<string>>(new Set());
  const visible = actionItems.filter((a) => !done.has(a.id));

  return (
    <section className="surface-card overflow-hidden h-full flex flex-col">
      <div className="px-5 py-3.5 border-b border-border/40 flex items-center justify-between">
        <h2 className="font-display text-base md:text-lg text-primary">Action items</h2>
        <span className="text-[12.5px] text-muted-foreground tabular">{visible.length} open</span>
      </div>

      {visible.length === 0 ? (
        <div className="p-10 text-center text-sm text-muted-foreground">
          <Check className="h-6 w-6 mx-auto text-positive mb-2" />
          You're all caught up.
        </div>
      ) : (
        <div className="divide-y divide-border/30 flex-1 overflow-auto">
          {visible.map((item) => {
            const Icon = item.icon;
            const m = priorityMeta[item.priority];
            return (
              <div key={item.id} className="px-5 py-3.5 group">
                <div className="flex items-start gap-3">
                  <div className={cn("h-8 w-8 rounded-md grid place-items-center bg-secondary/50 border border-border/50 shrink-0", m.text)}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13.5px] text-foreground font-medium">{item.title}</span>
                      <span className={cn("text-[11px] uppercase tracking-wider px-1.5 py-0.5 rounded border", m.chip)}>
                        {m.label}
                      </span>
                    </div>
                    <p className="text-[13px] text-muted-foreground mt-1 leading-snug">{item.detail}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <button className="inline-flex items-center gap-1 text-[12.5px] text-foreground hover:text-info transition-colors">
                        {item.cta} <ArrowRight className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => setDone(new Set([...done, item.id]))}
                        className="text-[12.5px] text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
