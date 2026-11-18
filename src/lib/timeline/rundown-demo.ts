/**
 * Demo / guest rundown: realistic EXAMPLE data dated relative to today (the
 * Designer's "risky" scenario). Planned recurring items only, no network.
 */
import { addDays } from "@/lib/recurring/dates";
import type { PlannedItem, RundownAccount, RundownTxn } from "./rundown";

export const DEMO_RUNDOWN_ACCOUNTS: RundownAccount[] = [
  { id: "rd-chk", name: "Primary Checking", mask: "0042", type: "depository", subtype: "checking", balance: 1840 },
  { id: "rd-joint", name: "Joint Checking", mask: "7731", type: "depository", subtype: "checking", balance: 420 },
  { id: "rd-amex", name: "Amex Gold", mask: "1004", type: "credit", subtype: "credit card", balance: 1388 },
  { id: "rd-brk", name: "Brokerage", mask: "BRK1", type: "investment", subtype: "brokerage", balance: 38420.5 },
];

type Raw = [id: string, offset: number, title: string, kind: PlannedItem["kind"], amount: number, account: string, src: "confirmed" | "detected", repeats: string, extra?: Partial<PlannedItem>];

const RAW: Raw[] = [
  ["spotify", -3, "Spotify", "subscription", -11.99, "rd-chk", "detected", "Monthly"],
  ["icloud-o", -3, "iCloud+", "subscription", -2.99, "rd-chk", "detected", "Monthly"],
  ["mortgage", -2, "Mortgage · Example Home Loans", "loan", -2400, "rd-chk", "confirmed", "Monthly on the 1st"],
  ["emerg", -2, "Emergency fund transfer", "savings", -500, "rd-chk", "confirmed", "Monthly on the 1st"],
  ["invoice", -2, "Client invoice · Example Studio", "income", 1200, "rd-chk", "detected", "Monthly around the 1st (5 of last 6 months)"],
  ["gym", -1, "Gym · Example Fitness", "bill", -85, "rd-chk", "detected", "Monthly on the 2nd"],
  ["edu", -1, "Kids' education · 529", "savings", -300, "rd-chk", "confirmed", "Monthly on the 2nd"],
  ["ptax", 0, "Property tax set-aside", "tax", -450, "rd-chk", "confirmed", "Monthly"],
  ["internet", 1, "Internet · Example Fiber", "utility", -70, "rd-joint", "detected", "Monthly"],
  ["icloud", 1, "iCloud+ family", "subscription", -2.99, "rd-chk", "detected", "Monthly"],
  ["audible", 1, "Audible", "subscription", -14.95, "rd-chk", "detected", "Monthly"],
  ["auto", 2, "Auto loan · Example Auto Finance", "loan", -410, "rd-joint", "confirmed", "Monthly · autopay"],
  ["phone", 3, "Phone · Example Mobile", "utility", -95, "rd-chk", "detected", "Monthly"],
  ["netflix", 4, "Netflix", "subscription", -15.49, "rd-chk", "detected", "Monthly"],
  ["hulu", 4, "Hulu", "subscription", -17.99, "rd-chk", "detected", "Monthly"],
  ["yt", 4, "YouTube Premium", "subscription", -13.99, "rd-chk", "detected", "Monthly"],
  ["amex", 5, "Amex Gold payment", "card", -1388, "rd-chk", "confirmed", "Monthly · full statement balance", { estimated: true, shift: "none" }],
  ["electric", 7, "Electric · Example Power", "utility", -128, "rd-chk", "detected", "Monthly around the 10th", { estimated: true }],
  ["life", 9, "Life insurance · Example Life", "insurance", -65, "rd-chk", "confirmed", "Monthly"],
  ["pay", 10, "Paycheck · Example Corp", "income", 3330, "rd-chk", "confirmed", "Every other week"],
  ["sapph", 11, "Chase Sapphire payment", "card", -544, "rd-chk", "confirmed", "Monthly · statement balance", { estimated: true, shift: "none" }],
  ["xfer", 13, "Transfer to Joint Checking", "transfer", -1200, "rd-chk", "confirmed", "Monthly", { toAccountId: "rd-joint" }],
  ["travel", 13, "Travel fund transfer", "savings", -250, "rd-joint", "confirmed", "Monthly"],
  ["student", 13, "Student loan · Example Servicing", "loan", -280, "rd-chk", "detected", "Monthly"],
];

/** Items paid/received in the last few days (the rest of the past items stay unmatched → late). */
const PAID = new Set(["spotify", "icloud-o", "mortgage", "emerg", "gym"]);

export function demoRundown(today: string): { items: PlannedItem[]; txns: RundownTxn[]; accounts: RundownAccount[] } {
  const items: PlannedItem[] = RAW.map(([id, o, title, kind, amount, accountId, source, repeats, extra]) => ({
    id: `demo-rd:${id}`, title, kind, amount, date: addDays(today, o), accountId, source, repeats,
    // the example dates are already the posting days (no weekend shift)
    shift: "none", ...extra,
  }));
  const txns: RundownTxn[] = RAW.filter(r => PAID.has(r[0])).map(([id, o, title, , amount, accountId]) => ({
    id: `demo-rd-txn:${id}`, accountId, amount, date: addDays(today, o), name: title, pending: false,
  }));
  return { items, txns, accounts: DEMO_RUNDOWN_ACCOUNTS };
}
