import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowUpRight } from "lucide-react";
import { fmtUSD, fmtPct } from "@/lib/format";
import { netWorthSeries } from "@/lib/finance-data";
import { useCountUp } from "@/hooks/useCountUp";

interface Props {
  netWorth: number;
  assets: number;
  liabilities: number;
}

export const NetWorthHeader = ({ netWorth, assets, liabilities }: Props) => {
  const first = netWorthSeries[0].v;
  const last  = netWorthSeries[netWorthSeries.length - 1].v;
  const change    = last - first;
  const changePct = (change / first) * 100;

  const animatedNW   = useCountUp(netWorth, 1200);
  const animatedAss  = useCountUp(assets, 1000);
  const animatedLiab = useCountUp(Math.abs(liabilities), 1000);

  return (
    <section className="surface-elevated relative overflow-hidden p-4 md:p-5 animate-fade-up">
      <div className="pointer-events-none absolute -top-20 -right-20 h-44 w-44 rounded-full bg-positive/10 blur-3xl" />

      <div className="relative grid gap-4 md:grid-cols-[1.05fr_1fr] md:gap-8 items-center">
        <div>
          <div className="text-[12px] uppercase tracking-[0.22em] text-muted-foreground">Net worth</div>

          <div className="mt-1 flex items-baseline gap-3 flex-wrap">
            <h2 className="font-display text-3xl md:text-4xl font-medium leading-none tabular text-primary animate-count-in">
              {fmtUSD(animatedNW)}
            </h2>
            <span className="chip chip-positive !py-0.5 !px-2 !text-[12.5px] animate-pop-in">
              <ArrowUpRight className="h-3 w-3" />
              {fmtUSD(change, { signed: true, compact: true })} ({fmtPct(changePct)}) · 12 mo
            </span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-5 max-w-md">
            <div>
              <div className="text-[12px] uppercase tracking-wider text-muted-foreground">Assets</div>
              <div className="font-display text-base mt-0.5 tabular text-positive animate-count-in">
                {fmtUSD(animatedAss, { compact: true })}
              </div>
            </div>
            <div>
              <div className="text-[12px] uppercase tracking-wider text-muted-foreground">Liabilities</div>
              <div className="font-display text-base mt-0.5 tabular text-negative animate-count-in">
                −{fmtUSD(animatedLiab, { compact: true })}
              </div>
            </div>
          </div>
        </div>

        <div className="h-24 md:h-28 -mx-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={netWorthSeries} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
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
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }}
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
                animationDuration={1200}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
};
