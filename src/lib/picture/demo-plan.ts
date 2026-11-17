/**
 * Demo / guest only: example bills for the Financial Picture plan that the
 * shared demo transactions don't have (they'd change Home and Spending
 * totals other screens and tests rely on). Generated relative to `today` so
 * the plan always has something due soon, something yearly and something
 * twice a year. Never used for a signed-in person.
 */
import { addDays, irsEstimatedDueDates, type ISODate } from "@/lib/recurring/dates";
import type { PClass, PTxn } from "./model";

const tx = (id: string, date: ISODate, amount: number, name: string, category: string, account = "da1"): PTxn =>
  ({ id, account_id: account, transaction_id: id, amount, date, name, merchant_name: null, category: [category], pending: false, payment_channel: "online" });

export function demoPlanTransactions(today: ISODate): PTxn[] {
  const out: PTxn[] = [];
  const at = (n: number) => addDays(today, -n);
  // Car insurance every 6 months (next one ~12 days out).
  [170, 353, 535].forEach((n, i) => out.push(tx(`dpl-ins${i}`, at(n), 684, "GEICO AUTO INSURANCE PREMIUM", "Insurance")));
  // Vehicle registration once a year.
  [340, 705].forEach((n, i) => out.push(tx(`dpl-dmv${i}`, at(n), 186, "STATE DMV VEHICLE REGISTRATION RENEWAL", "Government")));
  // Property tax twice a year.
  [55, 238, 420].forEach((n, i) => out.push(tx(`dpl-ptx${i}`, at(n), 3120, "COUNTY TREASURER PROPERTY TAX", "Taxes")));
  // HOA dues every quarter.
  [20, 111, 202, 293, 384].forEach((n, i) => out.push(tx(`dpl-hoa${i}`, at(n), 375, "PINE RIDGE HOA DUES", "Bills & Utilities")));
  // Water & sewer every quarter.
  [30, 121, 212, 303, 394].forEach((n, i) => out.push(tx(`dpl-wtr${i}`, at(n), 86 + i * 2, "CITY WATER SEWER UTILITY", "Bills & Utilities")));
  // Electric every month, a bit higher than last year.
  for (let k = 0; k < 15; k++) {
    const n = 12 + k * 30;
    const seasonal = [128, 142, 118, 96, 88, 92, 110, 134, 148, 131, 104, 90, 102, 99, 112][k];
    out.push(tx(`dpl-ele${k}`, at(n), k < 3 ? seasonal : Math.round(seasonal * 0.8), "PSEG ELECTRIC BILL PAYMENT", "Bills & Utilities"));
  }
  // Federal estimated tax every quarter (IRS due dates already past).
  const y = Number(today.slice(0, 4));
  const irs = [...irsEstimatedDueDates(y - 1), ...irsEstimatedDueDates(y)].map(d => d.due).filter(d => d < today && d >= addDays(today, -400));
  irs.forEach((d, i) => out.push(tx(`dpl-irs${i}`, d, 1800, "IRS USATAXPYMT 1040ES ESTIMATED TAX", "Taxes")));
  // Costco membership, once (a yearly descriptor).
  out.push(tx("dpl-cost0", at(300), 65, "COSTCO ANNUAL MEMBERSHIP RENEWAL", "Shopping", "da4"));
  return out;
}

/** Classification for the demo plan bills (the dashboard's classifier never saw them). */
export function demoPlanClass(t: { id: string }): PClass | undefined {
  if (!t.id.startsWith("dpl-")) return undefined;
  if (t.id.startsWith("dpl-ptx")) return { type: "obligation_tax", subtype: "property" };
  if (t.id.startsWith("dpl-irs")) return { type: "obligation_tax", subtype: "irs_estimated" };
  if (t.id.startsWith("dpl-ins")) return { type: "obligation_bill", subtype: "insurance" };
  if (t.id.startsWith("dpl-wtr") || t.id.startsWith("dpl-ele")) return { type: "obligation_bill", subtype: "utility" };
  return { type: "obligation_bill" };
}
