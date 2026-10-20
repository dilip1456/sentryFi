/**
 * Hand-built transaction fixtures for the QA money tests. "Today" is pinned
 * to QA_NOW (mid-October 2026, America/New_York) by each test via
 * vi.setSystemTime, so every date below is deterministic.
 *
 * Plaid sign convention: amount > 0 = money out (spend), < 0 = money in.
 */
export const QA_NOW = new Date("2026-10-20T12:00:00-04:00");

export type Txn = {
  id: string; account_id: string; item_id: string | null; transaction_id: string | null;
  amount: number; date: string; authorized_date: string | null;
  name: string | null; merchant_name: string | null; category: string[] | null;
  pending: boolean | null; payment_channel: string | null;
};

let n = 0;
export const txn = (p: Partial<Txn> & Pick<Txn, "amount" | "date">): Txn => ({
  id: p.id ?? `qa${++n}`,
  account_id: "acc_card", item_id: null, transaction_id: null, authorized_date: null,
  name: p.merchant_name ?? "Merchant", merchant_name: null, category: null,
  pending: false, payment_channel: "online",
  ...p,
});

export const accounts = [
  { id: "acc_chk", account_id: "acc_chk", name: "Everyday Checking", official_name: null, mask: "0001", type: "depository", subtype: "checking", current_balance: 5000, available_balance: 4900, iso_currency_code: "USD", item_id: "i1" },
  { id: "acc_sav", account_id: "acc_sav", name: "Savings", official_name: null, mask: "0002", type: "depository", subtype: "savings", current_balance: 20000, available_balance: 20000, iso_currency_code: "USD", item_id: "i1" },
  { id: "acc_card", account_id: "acc_card", name: "Rewards Card", official_name: null, mask: "0003", type: "credit", subtype: "credit card", current_balance: 1200, available_balance: 8800, iso_currency_code: "USD", item_id: "i1" },
  { id: "acc_loan", account_id: "acc_loan", name: "Car Loan", official_name: null, mask: "0004", type: "loan", subtype: "auto", current_balance: 9000, available_balance: null, iso_currency_code: "USD", item_id: "i1" },
  { id: "acc_brk", account_id: "acc_brk", name: "Brokerage", official_name: null, mask: "0005", type: "investment", subtype: "brokerage", current_balance: 30000, available_balance: null, iso_currency_code: "USD", item_id: "i1" },
];

/**
 * A month (October 2026) that exercises every classification rule the Home
 * and Spending totals disagree on. Comments give the app category each row
 * resolves to.
 */
export const octoberMix: Txn[] = [
  txn({ id: "groc",   amount: 100,   date: "2026-10-05", merchant_name: "Kroger",   category: ["Groceries"] }),                       // Groceries
  txn({ id: "shop",   amount: 200,   date: "2026-10-06", merchant_name: "Target",   category: ["Shopping"] }),                        // Shopping
  txn({ id: "refund", amount: -50,   date: "2026-10-07", merchant_name: "Target",   category: ["Shopping"] }),                        // Shopping refund (nets)
  txn({ id: "pay",    amount: -3000, date: "2026-10-01", account_id: "acc_chk", name: "Payroll ACME", category: ["Salary"] }),        // Salary (income)
  txn({ id: "mort",   amount: 1500,  date: "2026-10-02", account_id: "acc_chk", merchant_name: "Rocket Mortgage", category: ["Service", "Financial", "Mortgages"] }), // Mortgage
  txn({ id: "venmo",  amount: 75,    date: "2026-10-08", account_id: "acc_chk", name: "Venmo to J Doe", category: ["Transfer", "Third Party", "Venmo"] }), // Transfer Out, unpaired = real outflow
  txn({ id: "xferA",  amount: 500,   date: "2026-10-09", account_id: "acc_chk", name: "Transfer to Savings", category: ["Transfer"] }),  // internal pair leg
  txn({ id: "xferB",  amount: -500,  date: "2026-10-09", account_id: "acc_sav", name: "Transfer from Checking", category: ["Transfer"] }), // internal pair leg
  txn({ id: "pend",   amount: 40,    date: "2026-10-19", merchant_name: "Chipotle", category: ["Food & Drink"], pending: true }),  // pending purchase
  txn({ id: "ccpay",  amount: 300,   date: "2026-10-10", account_id: "acc_chk", name: "Payment Thank You", category: ["Payment", "Credit Card"] }), // Credit Card Payment
  // previous month, must not leak into October totals
  txn({ id: "sepGroc", amount: 80,   date: "2026-09-30", merchant_name: "Kroger",   category: ["Groceries"] }),
];
