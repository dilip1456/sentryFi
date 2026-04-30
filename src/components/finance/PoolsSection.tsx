import { useMemo, useState } from "react";
import {
  Plane, Utensils, Home, Shield, GraduationCap, Gift, Heart, Sparkles,
  Plus, Minus, X, Wallet, PiggyBank, type LucideIcon, Settings2, Info,
} from "lucide-react";
import { fmtUSD } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent } from "@/components/ui/dialog";

type PoolAccent = "mint" | "sky" | "amber" | "coral" | "violet" | "rose";

interface Pool {
  id: string;
  name: string;
  icon: LucideIcon;
  accent: PoolAccent;
  monthly: number;        // rule: $X / month from salary
  balance: number;        // current virtual balance
  target?: number;        // optional savings goal
  note?: string;
}

const accentMap: Record<PoolAccent, { ring: string; text: string; bg: string; bar: string }> = {
  mint:   { ring: "ring-positive/30",       text: "text-positive",              bg: "bg-positive/10",              bar: "bg-positive" },
  sky:    { ring: "ring-info/30",           text: "text-info",                  bg: "bg-info/10",                  bar: "bg-info" },
  amber:  { ring: "ring-warning/30",        text: "text-warning",               bg: "bg-warning/10",               bar: "bg-warning" },
  coral:  { ring: "ring-negative/30",       text: "text-negative",              bg: "bg-negative/10",              bar: "bg-negative" },
  violet: { ring: "ring-[hsl(280_70%_65%)]/30", text: "text-[hsl(280_70%_75%)]", bg: "bg-[hsl(280_70%_65%)]/10",   bar: "bg-[hsl(280_70%_65%)]" },
  rose:   { ring: "ring-[hsl(330_70%_65%)]/30", text: "text-[hsl(330_70%_75%)]", bg: "bg-[hsl(330_70%_65%)]/10",   bar: "bg-[hsl(330_70%_65%)]" },
};

const initialPools: Pool[] = [
  { id: "p1", name: "Travel",         icon: Plane,         accent: "sky",    monthly: 600, balance: 4200, target: 8000, note: "Japan trip — Oct 2026" },
  { id: "p2", name: "Dining out",     icon: Utensils,      accent: "amber",  monthly: 400, balance: 320 },
  { id: "p3", name: "Rent buffer",    icon: Home,          accent: "mint",   monthly: 200, balance: 1800, target: 2400, note: "1 month cushion" },
  { id: "p4", name: "Emergency top-up", icon: Shield,      accent: "coral",  monthly: 300, balance: 12500, target: 18000 },
  { id: "p5", name: "Learning",       icon: GraduationCap, accent: "violet", monthly: 150, balance: 600 },
  { id: "p6", name: "Gifts",          icon: Gift,          accent: "rose",   monthly: 75,  balance: 220 },
];

const SALARY_DEFAULT = 6420; // matches recent transactions
const HYSA_BALANCE = 42800;  // Marcus HYSA — the real account being virtualized

const PoolTile = ({ pool, onClick }: { pool: Pool; onClick: () => void }) => {
  const Icon = pool.icon;
  const a = accentMap[pool.accent];
  const pct = pool.target ? Math.min((pool.balance / pool.target) * 100, 100) : null;

  return (
    <button
      onClick={onClick}
      className="group surface-card p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-elevated)] hover:border-border-strong relative overflow-hidden"
    >
      <div className="flex items-start justify-between">
        <div className={cn("h-9 w-9 rounded-lg grid place-items-center ring-1 border border-border-strong", a.bg, a.ring, a.text)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className={cn("text-[10px] uppercase tracking-wider tabular", a.text)}>
          +{fmtUSD(pool.monthly, { compact: true })}/mo
        </div>
      </div>

      <div className="mt-3 text-sm font-medium text-foreground truncate">{pool.name}</div>
      <div className="font-display text-lg tabular text-foreground mt-1">{fmtUSD(pool.balance, { compact: true })}</div>

      {pct !== null ? (
        <div className="mt-3">
          <div className="h-1 rounded-full bg-secondary overflow-hidden">
            <div className={cn("h-full rounded-full transition-all", a.bar)} style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground tabular">
            <span>{pct.toFixed(0)}% of goal</span>
            <span>{fmtUSD(pool.target!, { compact: true })}</span>
          </div>
        </div>
      ) : (
        <div className="mt-3 text-[10px] text-muted-foreground">No goal set · flowing</div>
      )}
    </button>
  );
};

const PoolDetail = ({
  pool, onClose, onChange, onDelete,
}: {
  pool: Pool | null;
  onClose: () => void;
  onChange: (p: Pool) => void;
  onDelete: (id: string) => void;
}) => {
  if (!pool) return null;
  const Icon = pool.icon;
  const a = accentMap[pool.accent];
  const pct = pool.target ? Math.min((pool.balance / pool.target) * 100, 100) : null;
  const monthsToGoal = pool.target && pool.monthly > 0
    ? Math.max(0, Math.ceil((pool.target - pool.balance) / pool.monthly))
    : null;

  return (
    <Dialog open={!!pool} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md surface-elevated border-border p-0 gap-0 overflow-hidden">
        <div className="relative p-6">
          <button onClick={onClose} className="absolute top-4 right-4 h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors">
            <X className="h-4 w-4" />
          </button>

          <div className={cn("h-12 w-12 rounded-xl grid place-items-center ring-1 border border-border-strong", a.bg, a.ring, a.text)}>
            <Icon className="h-5 w-5" />
          </div>

          <div className="mt-4 text-xs uppercase tracking-wider text-muted-foreground">Virtual pool</div>
          <div className="font-display text-2xl text-foreground mt-0.5">{pool.name}</div>
          {pool.note && <div className="text-xs text-muted-foreground mt-1">{pool.note}</div>}

          <div className="mt-4 font-display text-4xl tabular text-foreground">{fmtUSD(pool.balance)}</div>
          {pct !== null && (
            <>
              <div className="mt-3 h-1.5 rounded-full bg-secondary overflow-hidden">
                <div className={cn("h-full rounded-full transition-all", a.bar)} style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground tabular">
                <span>{pct.toFixed(0)}% of {fmtUSD(pool.target!, { compact: true })} goal</span>
                {monthsToGoal !== null && <span>{monthsToGoal} mo to fund</span>}
              </div>
            </>
          )}
        </div>

        <div className="hairline p-6 space-y-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Allocation rule</div>

          <div className="flex items-center justify-between">
            <div className="text-sm text-foreground">Move from salary each month</div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => onChange({ ...pool, monthly: Math.max(0, pool.monthly - 25) })}
                className="h-8 w-8 grid place-items-center rounded-md border border-border-strong text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <div className="min-w-[88px] text-center font-display text-lg tabular text-foreground">
                {fmtUSD(pool.monthly, { compact: true })}
              </div>
              <button
                onClick={() => onChange({ ...pool, monthly: pool.monthly + 25 })}
                className="h-8 w-8 grid place-items-center rounded-md border border-border-strong text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <input
            type="range"
            min={0}
            max={1500}
            step={25}
            value={pool.monthly}
            onChange={(e) => onChange({ ...pool, monthly: Number(e.target.value) })}
            className="w-full accent-foreground"
          />
        </div>

        <div className="hairline p-4 flex gap-2">
          <button className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-foreground text-background px-3 py-2 text-xs font-medium hover:opacity-90 transition-opacity">
            <Sparkles className="h-3.5 w-3.5" /> Save rule
          </button>
          <button
            onClick={() => { onDelete(pool.id); onClose(); }}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-border-strong px-3 py-2 text-xs text-muted-foreground hover:text-negative transition-colors"
          >
            Delete
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export const PoolsSection = ({ embedded = false }: { embedded?: boolean } = {}) => {
  const [pools, setPools] = useState<Pool[]>(initialPools);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [salary, setSalary] = useState(SALARY_DEFAULT);
  const [editingSalary, setEditingSalary] = useState(false);

  const totalAllocated = useMemo(() => pools.reduce((s, p) => s + p.monthly, 0), [pools]);
  const unallocated = salary - totalAllocated;
  const allocPct = Math.min((totalAllocated / Math.max(salary, 1)) * 100, 100);

  const totalPooled = useMemo(() => pools.reduce((s, p) => s + p.balance, 0), [pools]);
  const trulyAvailable = HYSA_BALANCE - totalPooled;

  const selected = pools.find((p) => p.id === selectedId) ?? null;

  const updatePool = (next: Pool) => setPools((prev) => prev.map((p) => (p.id === next.id ? next : p)));
  const deletePool = (id: string) => setPools((prev) => prev.filter((p) => p.id !== id));

  return (
    <section className="space-y-5">
      {!embedded && (
        <div className="flex items-end justify-between">
          <div>
            <h2 className="font-display text-xl md:text-2xl text-primary">Virtual savings pools</h2>
            <p className="text-[11.5px] text-muted-foreground mt-1 max-w-xl">
              Slice one HYSA into named pools. Rules move money on payday — what's left is yours to spend.
            </p>
          </div>
          <button className="hidden md:inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <Settings2 className="h-3.5 w-3.5" /> Edit rules
          </button>
        </div>
      )}

      {/* Top row: salary allocation + truly available */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Salary allocator */}
        <div className="surface-card p-5 lg:col-span-2 relative overflow-hidden">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-24 opacity-50"
            style={{ background: "radial-gradient(60% 80% at 50% 0%, hsl(var(--info) / 0.10), transparent 70%)" }}
          />
          <div className="relative flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-info font-medium">Monthly salary</div>
              {editingSalary ? (
                <input
                  autoFocus
                  type="number"
                  value={salary}
                  onChange={(e) => setSalary(Math.max(0, Number(e.target.value)))}
                  onBlur={() => setEditingSalary(false)}
                  onKeyDown={(e) => e.key === "Enter" && setEditingSalary(false)}
                  className="mt-1 font-display text-3xl md:text-4xl tabular bg-transparent text-foreground outline-none border-b border-border-strong w-48"
                />
              ) : (
                <button
                  onClick={() => setEditingSalary(true)}
                  className="mt-1 font-display text-3xl md:text-4xl tabular text-foreground hover:text-info transition-colors"
                >
                  {fmtUSD(salary)}
                </button>
              )}
              <div className="text-[11px] text-muted-foreground mt-1">Tap to edit · drives all rules below</div>
            </div>
            <div className="h-9 w-9 rounded-lg border border-info/30 bg-info/10 text-info grid place-items-center">
              <Wallet className="h-4 w-4" />
            </div>
          </div>

          {/* Allocation bar */}
          <div className="relative mt-5">
            <div className="flex items-center justify-between text-[11px] mb-2">
              <span className="text-muted-foreground uppercase tracking-wider">Allocated to pools</span>
              <span className="tabular text-foreground">
                {fmtUSD(totalAllocated, { compact: true })} / {fmtUSD(salary, { compact: true })}
              </span>
            </div>
            <div className="h-2 rounded-full bg-secondary overflow-hidden flex">
              {pools.map((p) => {
                const w = (p.monthly / Math.max(salary, 1)) * 100;
                if (w <= 0) return null;
                const a = accentMap[p.accent];
                return (
                  <div
                    key={p.id}
                    className={cn("h-full transition-all", a.bar)}
                    style={{ width: `${w}%` }}
                    title={`${p.name} · ${fmtUSD(p.monthly)}`}
                  />
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
              {pools.map((p) => {
                const a = accentMap[p.accent];
                return (
                  <span key={p.id} className="inline-flex items-center gap-1.5">
                    <span className={cn("h-2 w-2 rounded-sm", a.bar)} />
                    {p.name} · <span className="tabular text-foreground">{fmtUSD(p.monthly, { compact: true })}</span>
                  </span>
                );
              })}
            </div>
          </div>

          <div className="relative mt-5 hairline pt-4 flex items-center justify-between">
            <div className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5" />
              {unallocated >= 0 ? "Unassigned salary (lifestyle / spending)" : "Over-allocated — reduce a rule"}
            </div>
            <div className={cn(
              "font-display text-2xl tabular",
              unallocated >= 0 ? "text-foreground" : "text-negative"
            )}>
              {unallocated < 0 ? "−" : ""}{fmtUSD(Math.abs(unallocated))}
              <span className="text-[11px] text-muted-foreground ml-1.5">/mo</span>
            </div>
          </div>
        </div>

        {/* Truly available — the headline number */}
        <div className="surface-card p-5 relative overflow-hidden">
          <div
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{ background: "radial-gradient(70% 60% at 50% 0%, hsl(var(--positive) / 0.12), transparent 75%)" }}
          />
          <div className="relative flex items-start justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-positive font-medium">Actually free</div>
              <div className="text-[11px] text-muted-foreground mt-1">After every pool is funded</div>
            </div>
            <div className="h-9 w-9 rounded-lg border border-positive/30 bg-positive/10 text-positive grid place-items-center">
              <PiggyBank className="h-4 w-4" />
            </div>
          </div>

          <div className={cn(
            "relative mt-5 font-display text-4xl md:text-5xl tabular",
            trulyAvailable >= 0 ? "text-foreground" : "text-negative"
          )}>
            {trulyAvailable < 0 ? "−" : ""}{fmtUSD(Math.abs(trulyAvailable), { compact: true })}
          </div>

          <div className="relative mt-4 space-y-1.5 text-[11px]">
            <Row label="Marcus HYSA balance" value={fmtUSD(HYSA_BALANCE, { compact: true })} />
            <Row label="Locked in pools" value={`− ${fmtUSD(totalPooled, { compact: true })}`} muted />
            <div className="hairline pt-1.5">
              <Row label="Free to deploy" value={fmtUSD(trulyAvailable, { compact: true })} strong />
            </div>
          </div>
        </div>
      </div>

      {/* Pool tiles */}
      <div>
        <div className="flex items-end justify-between mb-3 px-1">
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Your pools · {pools.length}</div>
          <div className="text-[11px] text-muted-foreground">Tap any pool to adjust the rule</div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {pools.map((p) => (
            <PoolTile key={p.id} pool={p} onClick={() => setSelectedId(p.id)} />
          ))}
        </div>
      </div>

      <PoolDetail
        pool={selected}
        onClose={() => setSelectedId(null)}
        onChange={updatePool}
        onDelete={deletePool}
      />
    </section>
  );
};

const Row = ({ label, value, muted, strong }: { label: string; value: string; muted?: boolean; strong?: boolean }) => (
  <div className="flex items-center justify-between">
    <span className={cn("text-muted-foreground", muted && "opacity-70")}>{label}</span>
    <span className={cn("tabular", strong ? "text-positive font-medium" : "text-foreground")}>{value}</span>
  </div>
);
