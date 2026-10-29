/**
 * "Where it goes": the cash-flow waterfall (prototype cashflowDetail) and the
 * small in/out split used by the "Where your money goes" card. Monthly figures.
 */
export interface CashflowInput {
  grossMonthly: number;
  fedMonthly: number;
  ficaMonthly: number;
  hsaMonthly: number;
  k401Monthly: number;
  /** After-tax payroll (ESPP + RSU tax withholding). */
  postTaxMonthly: number;
  takeHomeMonthly: number;
  bonusMonthly: number;
  otherIncomeMonthly: number;
  obligations: number;
  fixed: number;
  budgets: number;
  savings: number;
}

export interface WaterfallStep {
  key: string;
  label: string;
  amount: number;
  /** Running total after this step. */
  from: number;
  to: number;
  kind: "start" | "out" | "in" | "subtotal" | "end";
}

export function cashflowSteps(c: CashflowInput): WaterfallStep[] {
  const steps: WaterfallStep[] = [];
  let run = c.grossMonthly;
  steps.push({ key: "gross", label: "Gross pay", amount: run, from: 0, to: run, kind: "start" });
  const out = (key: string, label: string, amt: number) => {
    if (!(amt > 0.5)) return;
    steps.push({ key, label, amount: amt, from: run, to: run - amt, kind: "out" });
    run -= amt;
  };
  out("taxes", "Federal + FICA", c.fedMonthly + c.ficaMonthly);
  out("pretax", "HSA + 401(k)", c.hsaMonthly + c.k401Monthly);
  out("posttax", "ESPP / RSU", c.postTaxMonthly);
  // Whatever the gross estimate can't explain (state tax, benefits, rounding).
  const other = run - c.takeHomeMonthly;
  if (other > 0.5) out("other", "Other payroll", other);
  run = c.takeHomeMonthly;
  steps.push({ key: "takehome", label: "Take-home", amount: run, from: 0, to: run, kind: "subtotal" });
  const inc = (key: string, label: string, amt: number) => {
    if (!(amt > 0.5)) return;
    steps.push({ key, label, amount: amt, from: run, to: run + amt, kind: "in" });
    run += amt;
  };
  inc("bonus", "Bonus (averaged)", c.bonusMonthly);
  inc("otherIncome", "Other income", c.otherIncomeMonthly);
  out("obligations", "Obligations", c.obligations);
  out("fixed", "Fixed expenses", c.fixed);
  out("budgets", "Budgets", c.budgets);
  out("savings", "Savings goals", c.savings);
  steps.push({ key: "left", label: run >= 0 ? "Left over" : "Short", amount: run, from: 0, to: run, kind: "end" });
  return steps;
}

export interface FlowSplit {
  income: number;
  parts: { key: "obligations" | "fixed" | "budgets" | "savings"; label: string; amount: number }[];
  left: number;
}

export function flowSplit(c: Pick<CashflowInput, "takeHomeMonthly" | "bonusMonthly" | "otherIncomeMonthly" | "obligations" | "fixed" | "budgets" | "savings">): FlowSplit {
  const income = c.takeHomeMonthly + c.bonusMonthly + c.otherIncomeMonthly;
  const parts: FlowSplit["parts"] = [
    { key: "obligations", label: "Obligations", amount: c.obligations },
    { key: "fixed", label: "Fixed", amount: c.fixed },
    { key: "budgets", label: "Budgets", amount: c.budgets },
    { key: "savings", label: "Savings", amount: c.savings },
  ];
  return { income, parts, left: income - parts.reduce((s, p) => s + p.amount, 0) };
}
