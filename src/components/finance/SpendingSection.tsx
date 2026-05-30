import { useState, useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { spendCategories, monthlySpendSeries, recentTransactions, type SpendCategory } from "@/lib/finance-data";
import { fmtUSD } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { X, Pencil, ArrowRight } from "lucide-react";

type View = "categories" | "trend" | "transactions";

const CategoryTile = ({ c, onClick }: { c: SpendCategory; onClick: () => void }) => {
  const Icon = c.icon;
  const cPct = (c.spent / c.budget) * 100;
  const over = c.spent > c.budget;
  return (
    <button
      onClick={onClick}
      className="group surface-card p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[var(--shadow-elevated)]"
    >
      <div className="flex items-center justify-between">
        <div
          className="h-9 w-9 rounded-lg grid place-items-center"
          style={{ backgroundColor: `${c.color}1f`, color: c.color }}
        >
          <Icon className="h-4 w-4" />
        </div>
        <span className={cn(
          "text-[10px] tabular px-2 py-0.5 rounded-full",
          over ? "bg-negative/15 text-negative" : "bg-secondary text-muted-foreground"
        )}>
          {cPct.toFixed(0)}%
        </span>
      </div>
      <div className="mt-3 text-xs text-muted-foreground">{c.name}</div>
      <div className="mt-0.5 font-display text-lg tabular text-foreground">{fmtUSD(c.spent)}</div>
      <div className="text-[11px] text-muted-foreground tabular">of {fmtUSD(c.budget)}</div>
      <div className="mt-2 h-1 rounded-full bg-secondary overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(cPct, 100)}%`, backgroundColor: over ? "hsl(var(--negative))" : c.color }}
        />
      </div>
    </button>
  );
};

const CategoryDetail = ({ c, onClose }: { c: SpendCategory | null; onClose: () => void }) => {
  if (!c) return null;
  const Icon = c.icon;
  const cPct = (c.spent / c.budget) * 100;
  const over = c.spent > c.budget;
  const remaining = c.budget - c.spent;
  const txns = recentTransactions.filter((t) => t.category === c.name);

  return (
    <Dialog open={!!c} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md surface-elevated border-border p-0 gap-0 overflow-hidden">
        <DialogTitle className="sr-only">{c.name}</DialogTitle>
        <DialogDescription className="sr-only">Spending category details.</DialogDescription>
        <div className="relative p-6">
          <button onClick={onClose} className="absolute top-4 right-4 h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors">
            <X className="h-4 w-4" />
          </button>

          <div
            className="h-12 w-12 rounded-xl grid place-items-center"
            style={{ backgroundColor: `${c.color}24`, color: c.color }}
          >
            <Icon className="h-5 w-5" />
          </div>

          <div className="mt-4 text-xs uppercase tracking-wider text-muted-foreground">Category</div>
          <div className="font-display text-2xl text-foreground">{c.name}</div>

          <div className="mt-4 flex items-baseline gap-2">
            <span className="font-display text-3xl tabular text-foreground">{fmtUSD(c.spent)}</span>
            <span className="text-xs text-muted-foreground tabular">of {fmtUSD(c.budget)} budget</span>
          </div>

          <div className="mt-3 h-1.5 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.min(cPct, 100)}%`, backgroundColor: over ? "hsl(var(--negative))" : c.color }}
            />
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] tabular">
            <span className="text-muted-foreground">{cPct.toFixed(0)}% used</span>
            <span className={over ? "text-negative" : "text-positive"}>
              {over ? `Over by ${fmtUSD(-remaining)}` : `${fmtUSD(remaining)} left`}
            </span>
          </div>
        </div>

        <div className="hairline px-6 py-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Recent transactions</div>
          {txns.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3">No recent transactions in this category.</p>
          ) : (
            <div className="space-y-2">
              {txns.map((t) => (
                <div key={t.id} className="flex items-center justify-between text-sm">
                  <div className="min-w-0">
                    <div className="text-foreground truncate">{t.merchant}</div>
                    <div className="text-[11px] text-muted-foreground">{t.card} · {t.date}</div>
                  </div>
                  <div className="font-display tabular text-foreground">−{fmtUSD(Math.abs(t.amount))}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="hairline p-4 flex gap-2">
          <button className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-foreground text-background px-3 py-2 text-xs font-medium hover:opacity-90 transition-opacity">
            <Pencil className="h-3.5 w-3.5" /> Edit budget
          </button>
          <button className="inline-flex items-center justify-center gap-2 rounded-lg border border-border-strong px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
            All transactions <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export const SpendingSection = () => {
  const [view, setView] = useState<View>("categories");
  const [selected, setSelected] = useState<SpendCategory | null>(null);

  const totalSpent = useMemo(() => spendCategories.reduce((s, c) => s + c.spent, 0), []);
  const totalBudget = useMemo(() => spendCategories.reduce((s, c) => s + c.budget, 0), []);
  const pct = (totalSpent / totalBudget) * 100;
  const overBudget = totalSpent > totalBudget;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl md:text-2xl text-primary">Spending</h2>

        <div className="inline-flex p-1 rounded-full border border-border bg-surface">
          {(["categories", "trend", "transactions"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "px-3.5 py-1.5 text-xs font-medium rounded-full transition-all capitalize",
                view === v
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Compact summary strip */}
      <div className="surface-card p-5">
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Spent in April</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-display text-3xl tabular text-foreground">{fmtUSD(totalSpent)}</span>
              <span className="text-xs text-muted-foreground tabular">of {fmtUSD(totalBudget, { compact: true })}</span>
            </div>
          </div>
          <div className="text-right">
            <div className={cn("text-sm tabular", overBudget ? "text-negative" : "text-positive")}>
              {overBudget ? `Over by ${fmtUSD(totalSpent - totalBudget)}` : `${fmtUSD(totalBudget - totalSpent)} remaining`}
            </div>
            <div className="text-[11px] text-muted-foreground tabular">{pct.toFixed(0)}% used</div>
          </div>
        </div>

        <div className="mt-3 h-1.5 rounded-full bg-secondary overflow-hidden flex">
          {spendCategories.map((c) => {
            const w = (c.spent / totalBudget) * 100;
            return (
              <div
                key={c.name}
                className="h-full transition-all hover:opacity-80"
                style={{ width: `${w}%`, backgroundColor: c.color }}
                title={`${c.name} · ${fmtUSD(c.spent)}`}
              />
            );
          })}
        </div>
      </div>

      {view === "categories" && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 animate-fade-up">
          {spendCategories.map((c) => (
            <CategoryTile key={c.name} c={c} onClick={() => setSelected(c)} />
          ))}
        </div>
      )}

      {view === "trend" && (
        <div className="surface-card p-6 animate-fade-up">
          <div className="text-sm font-medium text-foreground mb-4">Last 6 months — actual vs. budget</div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlySpendSeries} barCategoryGap={20}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="m" axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  cursor={{ fill: "hsl(var(--surface-hover))" }}
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border-strong))",
                    borderRadius: "10px",
                    fontSize: "12px",
                  }}
                  formatter={(v: number, n) => [fmtUSD(v), n === "spent" ? "Spent" : "Budget"]}
                />
                <Bar dataKey="budget" fill="hsl(var(--secondary))" radius={[6, 6, 0, 0]} />
                <Bar dataKey="spent" fill="hsl(var(--positive))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {view === "transactions" && (
        <div className="surface-card overflow-hidden animate-fade-up">
          <div className="px-5 py-4 flex items-center justify-between">
            <div className="text-sm font-medium text-foreground">Recent transactions</div>
            <div className="text-xs text-muted-foreground">Last 7 days</div>
          </div>
          <div className="hairline divide-y divide-border/60">
            {recentTransactions.map((t) => {
              const isIncome = t.amount > 0;
              return (
                <div key={t.id} className="grid grid-cols-[1fr_auto] gap-4 px-5 py-3.5 hover:bg-surface-hover/30 transition-colors">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">{t.merchant}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {t.category} · {t.card} · {t.date}
                    </div>
                  </div>
                  <div className={cn(
                    "font-display text-base tabular self-center",
                    isIncome ? "text-positive" : "text-foreground"
                  )}>
                    {isIncome ? "+" : "−"}{fmtUSD(Math.abs(t.amount))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <CategoryDetail c={selected} onClose={() => setSelected(null)} />
    </section>
  );
};
