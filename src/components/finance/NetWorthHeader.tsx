import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { fmtUSD, fmtPct } from "@/lib/format";
import { netWorthSeries } from "@/lib/finance-data";

interface Props {
  netWorth: number;
  assets: number;
  liabilities: number;
}

export const NetWorthHeader = ({ netWorth, assets, liabilities }: Props) => {
  const first = netWorthSeries[0].v;
  const last = netWorthSeries[netWorthSeries.length - 1].v;
  const change = last - first;
  const changePct = (change / first) * 100;

  return (
    <section className="surface-elevated relative overflow-hidden p-5 md:p-6 animate-fade-up">
      <div className="pointer-events-none absolute -top-24 -right-24 h-56 w-56 rounded-full bg-positive/10 blur-3xl" />

      <div className="relative grid gap-6 md:grid-cols-[1.1fr_1fr] md:gap-10 items-center">
        <div>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            <Sparkles className="h-3 w-3 text-positive" />
            Net worth · April 2026
          </div>

          <h2 className="font-display text-3xl md:text-5xl font-medium leading-[0.95] mt-2 tabular text-primary">
            {fmtUSD(netWorth)}
          </h2>

          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <span className="chip chip-positive !py-1 !px-2 !text-[11px]">
              <ArrowUpRight className="h-3 w-3" />
              {fmtUSD(change, { signed: true, compact: true })} ({fmtPct(changePct, 1)})
            </span>
            <span className="text-[11px] text-muted-foreground">vs. 12 months ago</span>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-5 max-w-md">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total assets</div>
              <div className="font-display text-lg mt-0.5 tabular text-positive">{fmtUSD(assets, { compact: true })}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total liabilities</div>
              <div className="font-display text-lg mt-0.5 tabular text-negative">−{fmtUSD(Math.abs(liabilities), { compact: true })}</div>
            </div>
          </div>
        </div>

        <div className="h-32 md:h-36 -mx-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={netWorthSeries} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="nw" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--positive))" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="hsl(var(--positive))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="m"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                interval={1}
              />
              <YAxis hide domain={["dataMin - 5000", "dataMax + 5000"]} />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border-strong))",
                  borderRadius: "10px",
                  fontSize: "12px",
                }}
                labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                formatter={(v: number) => [fmtUSD(v), "Net worth"]}
              />
              <Area
                type="monotone"
                dataKey="v"
                stroke="hsl(var(--positive))"
                strokeWidth={2}
                fill="url(#nw)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
};
