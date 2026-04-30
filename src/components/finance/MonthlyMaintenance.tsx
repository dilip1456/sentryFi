import { useMemo, useState } from "react";
import {
  ArrowDown, ArrowUp, Calendar, CreditCard, Home, Receipt,
  Sparkles, Plus, Pencil, X,
} from "lucide-react";
import { fmtUSD } from "@/lib/format";
import { accounts, subscriptions, spendCategories } from "@/lib/finance-data";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent } from "@/components/ui/dialog";

type RowKind = "income" | "emi" | "statement" | "subscription" | "pool" | "spending";

interface FlowRow {
  id: string;
  kind: RowKind;
  label: string;
  sub?: string;
  amount: number;        // signed: + income, − outflow
  dueDay?: number;
  badge?: string;
  tone: "positive" | "negative" | "warning" | "info" | "muted";
  icon?: React.ReactNode;
}

const toneText: Record<FlowRow["tone"], string> = {
  positive: "text-positive",
  negative: "text-negative",
  warning:  "text-warning",
  info:     "text-info",
  muted:    "text-muted-foreground",
};

const toneBg: Record<FlowRow["tone"], string> = {
  positive: "bg-positive/10 border-positive/20",
  negative: "bg-negative/10 border-negative/20",
  warning:  "bg-warning/10 border-warning/20",
  info:     "bg-info/10 border-info/20",
  muted:    "bg-secondary/40 border-border/40",
};

const sectionMeta: Record<Exclude<RowKind, "income">, { label: string; sub: string; icon: React.ReactNode }> = {
  emi:          { label: "Loan EMIs",           sub: "Term loans — only the monthly hit", icon: <Home className="h-3.5 w-3.5" /> },
  statement:    { label: "Credit card bills",   sub: "Paid in full this cycle",           icon: <CreditCard className="h-3.5 w-3.5" /> },
  subscription: { label: "Recurring bills",     sub: "Utilities, subs, fixed costs",      icon: <Receipt className="h-3.5 w-3.5" /> },
  pool:         { label: "Saving rules",        sub: "Auto-allocations to virtual pools", icon: <Sparkles className="h-3.5 w-3.5" /> },
  spending:     { label: "Variable spending",   sub: "Budgets for everyday categories",   icon: <Calendar className="h-3.5 w-3.5" /> },
};

const SALARY_DEFAULT = 6420;

/* Simple inline-editable amount */
const Amount = ({ value, onChange, className }: { value: number; onChange: (n: number) => void; className?: string }) => {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value)))}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => e.key === "Enter" && setEditing(false)}
        className={cn("bg-transparent outline-none border-b border-border-strong tabular w-24 text-right", className)}
      />
    );
  }
  return (
    <button onClick={() => setEditing(true)} className={cn("tabular hover:text-info transition-colors inline-flex items-center gap-1", className)}>
      {fmtUSD(value, { compact: true })}
      <Pencil className="h-2.5 w-2.5 opacity-0 group-hover/row:opacity-50" />
    </button>
  );
};

const FlowGroup = ({
  kind,
  rows,
  total,
  onEdit,
}: {
  kind: Exclude<RowKind, "income">;
  rows: FlowRow[];
  total: number;
  onEdit?: (id: string, amount: number) => void;
}) => {
  const meta = sectionMeta[kind];
  if (rows.length === 0) return null;

  return (
    <div className="surface-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-md bg-secondary/60 border border-border/60 grid place-items-center text-muted-foreground">
            {meta.icon}
          </div>
          <div>
            <div className="text-[12px] font-medium text-foreground">{meta.label}</div>
            <div className="text-[10px] text-muted-foreground">{meta.sub}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">total / mo</div>
          <div className="text-sm font-display tabular text-negative">−{fmtUSD(total, { compact: true })}</div>
        </div>
      </div>
      <div className="divide-y divide-border/30">
        {rows.map((r) => (
          <div key={r.id} className="group/row flex items-center gap-3 px-4 py-2.5 hover:bg-surface-hover/50 transition-colors">
            <div className={cn("h-1.5 w-1.5 rounded-full", toneText[r.tone].replace("text-", "bg-"))} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[12.5px] text-foreground truncate">{r.label}</span>
                {r.badge && (
                  <span className={cn("text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border", toneBg[r.tone], toneText[r.tone])}>
                    {r.badge}
                  </span>
                )}
              </div>
              {r.sub && <div className="text-[10.5px] text-muted-foreground truncate">{r.sub}</div>}
            </div>
            {r.dueDay && (
              <span className="text-[10px] text-muted-foreground tabular hidden sm:inline-flex items-center gap-1">
                <Calendar className="h-2.5 w-2.5" /> {r.dueDay}
              </span>
            )}
            <div className="text-right text-[13px] font-medium tabular text-negative w-20">
              {onEdit ? (
                <Amount value={Math.abs(r.amount)} onChange={(n) => onEdit(r.id, n)} className="text-negative" />
              ) : (
                <>−{fmtUSD(Math.abs(r.amount), { compact: true })}</>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export const MonthlyMaintenance = () => {
  const [salary, setSalary] = useState(SALARY_DEFAULT);
  const [otherIncome, setOtherIncome] = useState(0);
  const [poolAllocations, setPoolAllocations] = useState(1725); // mirrors PoolsSection default sum
  const [spendingBudget, setSpendingBudget] = useState(
    spendCategories.filter((c) => !["Housing"].includes(c.name)).reduce((s, c) => s + c.budget, 0)
  );
  const [subOverrides, setSubOverrides] = useState<Record<string, number>>({});
  const [showHelp, setShowHelp] = useState(false);

  // Build rows
  const emiRows: FlowRow[] = useMemo(() =>
    accounts.filter((a) => a.bucket === "term" && a.emi).map((a) => ({
      id: a.id,
      kind: "emi" as const,
      label: a.name,
      sub: `${a.institution} · ${a.apr?.toFixed(2)}% APR · ${a.termMonthsLeft} mo left`,
      amount: -(a.emi ?? 0),
      tone: "negative",
    })), []);

  const statementRows: FlowRow[] = useMemo(() =>
    accounts.filter((a) => a.bucket === "revolving" && a.statementDue).map((a) => ({
      id: a.id,
      kind: "statement" as const,
      label: a.name,
      sub: `${a.institution} · ${a.last4 ? `··${a.last4}` : ""}`,
      amount: -(a.statementDue ?? 0),
      dueDay: a.dueDay,
      tone: "warning",
      badge: a.promo ? "0% APR" : undefined,
    })), []);

  const subRows: FlowRow[] = subscriptions.map((s) => ({
    id: s.id,
    kind: "subscription" as const,
    label: s.name,
    sub: `${s.category} · on ${s.card}`,
    amount: -(subOverrides[s.id] ?? s.amount),
    tone: "muted",
  }));

  const poolRows: FlowRow[] = [
    { id: "pool-total", kind: "pool" as const, label: "Virtual pools allocation", sub: "From Pools section · 6 active rules", amount: -poolAllocations, tone: "info", badge: "AUTO" },
  ];

  const spendingRows: FlowRow[] = [
    { id: "spend-total", kind: "spending" as const, label: "Variable spending budget", sub: "Groceries, dining, transport, etc.", amount: -spendingBudget, tone: "muted" },
  ];

  const totalEmi   = emiRows.reduce((s, r) => s + Math.abs(r.amount), 0);
  const totalStmt  = statementRows.reduce((s, r) => s + Math.abs(r.amount), 0);
  const totalSubs  = subRows.reduce((s, r) => s + Math.abs(r.amount), 0);
  const totalPools = poolRows.reduce((s, r) => s + Math.abs(r.amount), 0);
  const totalSpend = spendingRows.reduce((s, r) => s + Math.abs(r.amount), 0);

  const totalIncome  = salary + otherIncome;
  const totalOutflow = totalEmi + totalStmt + totalSubs + totalPools + totalSpend;
  const netCash      = totalIncome - totalOutflow;
  const ratio        = Math.min((totalOutflow / Math.max(totalIncome, 1)) * 100, 100);

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <h2 className="font-display text-xl md:text-2xl text-primary">Monthly cash flow</h2>
        <button
          onClick={() => setShowHelp(true)}
          className="hidden md:inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <Sparkles className="h-3 w-3" /> How is this calculated?
        </button>
      </div>

      {/* Headline cash-flow card */}
      <div className="surface-card p-5 md:p-6 relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background: netCash >= 0
              ? "radial-gradient(70% 60% at 50% 0%, hsl(var(--positive) / 0.10), transparent 75%)"
              : "radial-gradient(70% 60% at 50% 0%, hsl(var(--negative) / 0.10), transparent 75%)",
          }}
        />
        <div className="relative grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Income */}
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-positive font-medium inline-flex items-center gap-1.5">
              <ArrowDown className="h-3 w-3 rotate-180" /> Income
            </div>
            <div className="mt-2 font-display text-3xl tabular text-foreground">
              +{fmtUSD(totalIncome, { compact: true })}
            </div>
            <div className="mt-2 space-y-1 text-[11px]">
              <Row label="Salary" editable value={salary} onChange={setSalary} />
              <Row label="Other / side"  editable value={otherIncome} onChange={setOtherIncome} />
            </div>
          </div>

          {/* Outflow */}
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-negative font-medium inline-flex items-center gap-1.5">
              <ArrowUp className="h-3 w-3" /> Outflow
            </div>
            <div className="mt-2 font-display text-3xl tabular text-foreground">
              −{fmtUSD(totalOutflow, { compact: true })}
            </div>
            <div className="mt-2 space-y-1 text-[11px]">
              <Row label="Loan EMIs" value={totalEmi} />
              <Row label="Card statements" value={totalStmt} />
              <Row label="Recurring bills" value={totalSubs} />
              <Row label="Pool savings" value={totalPools} />
              <Row label="Variable spend" value={totalSpend} />
            </div>
          </div>

          {/* Net */}
          <div className={cn(
            "rounded-lg border p-4",
            netCash >= 0 ? "border-positive/30 bg-positive/5" : "border-negative/30 bg-negative/10"
          )}>
            <div className={cn(
              "text-[10px] uppercase tracking-[0.22em] font-medium",
              netCash >= 0 ? "text-positive" : "text-negative"
            )}>
              {netCash >= 0 ? "Free cash" : "Short by"}
            </div>
            <div className={cn(
              "mt-2 font-display text-4xl tabular",
              netCash >= 0 ? "text-foreground" : "text-negative"
            )}>
              {netCash < 0 ? "−" : ""}{fmtUSD(Math.abs(netCash), { compact: true })}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">After every monthly obligation</div>

            {/* Ratio bar */}
            <div className="mt-4">
              <div className="flex justify-between text-[10px] text-muted-foreground tabular mb-1">
                <span>Outflow ratio</span>
                <span>{ratio.toFixed(0)}% of income</span>
              </div>
              <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                <div
                  className={cn(
                    "h-full transition-all",
                    ratio < 70 ? "bg-positive" : ratio < 90 ? "bg-warning" : "bg-negative"
                  )}
                  style={{ width: `${ratio}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Detail groups */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FlowGroup kind="emi"          rows={emiRows}       total={totalEmi} />
        <FlowGroup kind="statement"    rows={statementRows} total={totalStmt} />
        <FlowGroup
          kind="subscription"
          rows={subRows}
          total={totalSubs}
          onEdit={(id, amount) => setSubOverrides((p) => ({ ...p, [id]: amount }))}
        />
        <div className="space-y-4">
          <FlowGroup kind="pool"     rows={poolRows}     total={totalPools} />
          <FlowGroup kind="spending" rows={spendingRows} total={totalSpend} />
          <button className="w-full surface-card border-dashed py-3 inline-flex items-center justify-center gap-2 text-xs text-muted-foreground hover:text-foreground hover:border-border-strong transition-colors">
            <Plus className="h-3.5 w-3.5" /> Add recurring item
          </button>
        </div>
      </div>

      <Dialog open={showHelp} onOpenChange={setShowHelp}>
        <DialogContent className="max-w-md surface-elevated p-0">
          <div className="p-6 relative">
            <button onClick={() => setShowHelp(false)} className="absolute top-4 right-4 h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-hover">
              <X className="h-4 w-4" />
            </button>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">How this works</div>
            <div className="font-display text-2xl text-foreground mt-1">Monthly view ≠ Overall view</div>
            <ul className="mt-4 space-y-2.5 text-[12px] text-muted-foreground leading-relaxed">
              <li className="flex gap-2"><span className="text-positive">•</span><span><b className="text-foreground">EMIs</b> show the monthly payment, not the $312k mortgage total.</span></li>
              <li className="flex gap-2"><span className="text-warning">•</span><span><b className="text-foreground">Credit cards</b> count this cycle's statement balance — assumed paid in full.</span></li>
              <li className="flex gap-2"><span className="text-info">•</span><span><b className="text-foreground">Pools</b> auto-divert salary into named buckets in your HYSA.</span></li>
              <li className="flex gap-2"><span className="text-muted-foreground">•</span><span><b className="text-foreground">Variable</b> is your discretionary spend budget — adjust it to see free cash.</span></li>
            </ul>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
};

const Row = ({
  label, value, editable, onChange,
}: { label: string; value: number; editable?: boolean; onChange?: (n: number) => void }) => (
  <div className="group/row flex items-center justify-between text-muted-foreground">
    <span>{label}</span>
    {editable && onChange ? (
      <Amount value={value} onChange={onChange} className="text-foreground" />
    ) : (
      <span className="tabular text-foreground">{fmtUSD(value, { compact: true })}</span>
    )}
  </div>
);
