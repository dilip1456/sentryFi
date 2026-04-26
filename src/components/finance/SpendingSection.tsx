import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { spendCategories, monthlySpendSeries, recentTransactions } from "@/lib/finance-data";
import { fmtUSD } from "@/lib/format";
import { cn } from "@/lib/utils";

type View = "categories" | "trend" | "transactions";

export const SpendingSection = () => {
  const [view, setView] = useState<View>("categories");

  const totalSpent = spendCategories.reduce((s, c) => s + c.spent, 0);
  const totalBudget = spendCategories.reduce((s, c) => s + c.budget, 0);
  const pct = (totalSpent / totalBudget) * 100;
  const overBudget = totalSpent > totalBudget;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">03 — Behavior</div>
          <h2 className="font-display text-3xl md:text-4xl mt-1 text-primary">Spending & budgets</h2>
        </div>

        <div className="inline-flex p-1 rounded-full border border-border bg-surface">
          {(["categories", "trend", "transactions"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "px-4 py-1.5 text-xs font-medium rounded-full transition-all capitalize",
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

      {/* Top summary card */}
      <div className="surface-card p-6 grid md:grid-cols-[1.2fr_2fr] gap-6 items-center">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Spent in April</div>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="font-display text-4xl tabular text-foreground">{fmtUSD(totalSpent)}</span>
            <span className="text-sm text-muted-foreground tabular">of {fmtUSD(totalBudget, { compact: true })} budget</span>
          </div>

          <div className="mt-4 h-2 rounded-full bg-secondary overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                overBudget ? "bg-negative" : pct > 85 ? "bg-warning" : "bg-positive"
              )}
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
            <span>{pct.toFixed(0)}% used</span>
            <span>{overBudget ? `Over by ${fmtUSD(totalSpent - totalBudget)}` : `${fmtUSD(totalBudget - totalSpent)} remaining`}</span>
          </div>
        </div>

        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={spendCategories}
                dataKey="spent"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={48}
                outerRadius={78}
                paddingAngle={2}
                strokeWidth={0}
              >
                {spendCategories.map((c) => <Cell key={c.name} fill={c.color} />)}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border-strong))",
                  borderRadius: "10px",
                  fontSize: "12px",
                }}
                formatter={(v: number, n) => [fmtUSD(v), n]}
              />
              <Legend
                verticalAlign="middle"
                align="right"
                layout="vertical"
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: "11px", color: "hsl(var(--muted-foreground))" }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {view === "categories" && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 animate-fade-up">
          {spendCategories.map((c) => {
            const Icon = c.icon;
            const cPct = (c.spent / c.budget) * 100;
            const over = c.spent > c.budget;
            return (
              <div key={c.name} className="surface-card p-4 hover:bg-surface-hover/30 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="h-9 w-9 rounded-lg grid place-items-center" style={{ backgroundColor: `${c.color}1a`, color: c.color }}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <span className={cn(
                    "text-[10px] tabular px-2 py-0.5 rounded-full",
                    over ? "bg-negative/15 text-negative" : "bg-secondary text-muted-foreground"
                  )}>
                    {cPct.toFixed(0)}%
                  </span>
                </div>
                <div className="mt-3 text-sm text-muted-foreground">{c.name}</div>
                <div className="mt-1 font-display text-xl tabular text-foreground">{fmtUSD(c.spent)}</div>
                <div className="text-[11px] text-muted-foreground tabular">of {fmtUSD(c.budget)}</div>
                <div className="mt-3 h-1 rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${Math.min(cPct, 100)}%`, backgroundColor: over ? "hsl(var(--negative))" : c.color }}
                  />
                </div>
              </div>
            );
          })}
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
    </section>
  );
};
