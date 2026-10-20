/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Typed access to module-private helpers exposed by qa-expose-internals.
 * `need(mod, "name")` throws a clear error if a branch removed/renamed the
 * helper, so a refactor shows up as one obvious failure per helper.
 */
import * as Dash from "@/components/finance/LivePlaidDashboard";
import * as SpendView from "@/components/finance/SpendingBudgetView";
import * as Budget from "@/components/finance/BudgetPage";

type Bag = Record<string, any>;
const bag = (m: unknown): Bag => ((m as { __qa_internals__?: Bag }).__qa_internals__ ?? {});

export const dash = bag(Dash);
export const spendView = bag(SpendView);
export const budgetPage = bag(Budget);

export function need<T = any>(b: Bag, name: string): T {
  const v = b[name];
  if (v === undefined) throw new Error(`QA harness: helper "${name}" is no longer defined in its module (renamed/moved?). Update src/test/qa/expose-internals.plugin.ts.`);
  return v as T;
}
