/** Versioned descriptor pattern library (stage 6). */
export const PATTERN_LIBRARY_VERSION = 1;

export const PAYROLL_RE = /payroll|\bdes:\s*pay\b|dir(ect)?\s?dep|\bsalary\b|paycheck|\badp\b|gusto|paychex|\bpayrl\b/i;
export const INTEREST_RE = /\binterest\s+(earned|paid|payment|credit|deposit)\b|\bint(erest)?\s+earned\b|\bapy\s+earned\b|^interest$|\binterest\s+income\b/i;
export const DIVIDEND_RE = /\bdividend|\bdiv\s+(paid|credit)\b/i;
export const TAX_RE = /\birs\b|usataxpymt|treas\s+tax|\beftps\b|\btax\s+(pymt|payment|pmt)\b|state\s+tax|dept\.?\s+of\s+revenue|department\s+of\s+revenue|franchise\s+tax|property\s+tax|county\s+treas|comptroller|\bftb\b/i;
export const TAX_REFUND_RE = /tax\s+ref(und)?|\btreas\s+310\b|irs\s+treas\s+310/i;
/**
 * Person-to-person payment apps (descriptor evidence only; see
 * isPersonToPerson for the full test). PayPal needs transfer wording right
 * after it ("PAYPAL INST XFER", "PayPal transfer to …", "PayPal sent money"),
 * so "PAYPAL *NETFLIX", "PAYPAL *MONEY LION" and "PAYPAL *SEND GRID" (a
 * merchant name that happens to contain money/send) never match.
 */
export const P2P_RE = /\bzelle\b|\bvenmo\b|cash\s?app|\bsquare\s+cash\b|\bpaypal\s+(inst(ant)?\s+xfer|xfer|transfer|p2p|sent|received|send\s+money|money\s+(sent|received))\b|apple\s+cash|\bp2p\b/i;

/** merchant_name values that are just the P2P app, not a real merchant. */
const P2P_APP_MERCHANT_RE = /^(venmo|zelle|cash\s?app|square\s+cash|paypal|apple\s+cash)$/i;
/**
 * Checkout through a P2P app: "CASH APP*STARBUCKS" (Cash Card purchase),
 * "PAYPAL *NETFLIX", "PAYPAL INST XFER 2389 NETFLIX.COM" (bank-funded PayPal
 * purchase naming the merchant's domain).
 */
const P2P_APP_PURCHASE_RE = /\b(cash\s?app|paypal)\s*\*|\bpaypal\b.*\b[a-z0-9-]+\.(com|net|org|io|co|tv|app)\b/i;

/**
 * Money sent to / received from another person through a P2P app. True only
 * when the descriptor names a P2P app AND nothing says it's a merchant
 * purchase:
 *   - merchant_name is empty (or just the app's own name, e.g. "Venmo"),
 *   - Plaid isn't confident it's a purchase: its PFC primary is
 *     TRANSFER_IN/TRANSFER_OUT, or a non-transfer category below HIGH,
 *   - it isn't app checkout ("CASH APP*<merchant>", "PAYPAL *<merchant>",
 *     a merchant domain), unless Plaid files it as a transfer,
 *   - it isn't employer payroll.
 * Payments to the user's own name / linked accounts are caught earlier
 * (pairs, namesSelf) as transfer_internal.
 */
export function isPersonToPerson(t: {
  name: string | null; merchant_name: string | null;
  pfc_primary?: string | null; pfc_confidence?: string | null;
}): boolean {
  const text = descriptor(t);
  if (!P2P_RE.test(text) || EMPLOYER_ACH_RE.test(text)) return false;
  const merchant = (t.merchant_name ?? "").trim();
  if (merchant && !P2P_APP_MERCHANT_RE.test(merchant)) return false;
  const transferPfc = /^TRANSFER_(IN|OUT)$/i.test(t.pfc_primary ?? "");
  if (t.pfc_primary && !transferPfc && /^(HIGH|VERY_HIGH)$/i.test(t.pfc_confidence ?? "")) return false;
  if (!transferPfc && P2P_APP_PURCHASE_RE.test(t.name ?? "")) return false;
  return true;
}
export const BROKERAGE_RE =
  /\b(robinhood|fidelity|vanguard|schwab|e\s?\*?\s?trade|webull|m1\s+finance|acorns|betterment|wealthfront|stash|public\.com|interactive\s+brokers|merrill\s+edge|td\s+ameritrade|ally\s+invest|sofi\s+invest|coinbase|firstrade|tastytrade)\b/i;
export const SAVINGS_SWEEP_RE =
  /transfer\s+to\s+(sav|savings|hysa|money\s+market|mm)\b|\bto\s+savings\b|online\s+transfer\s+to\s+sav|keep\s+the\s+change|round[- ]?up|save\s+as\s+you\s+go|automatic\s+savings|auto[- ]?save/i;
export const LOAN_RE = /\bmortgage\b|\bmtg\b|home\s+loan|auto\s+loan|car\s+loan|student\s+loan|\bnelnet\b|\bmohela\b|\bnavient\b|sallie\s+mae|aidvantage|\bloan\s+(pmt|pymt|payment)\b|rocket\s+mortgage|mr\.?\s+cooper|\bpennymac\b|lakeview\s+loan/i;
export const CARD_ISSUER_PAYMENT_RE =
  /(credit\s?(card|crd)|card\s?member|cardmember|\bamex\b|american\s+express|\bdiscover\b|capital\s+one|\bciti\b|citi\s?card|barclay|synchrony|chase\s+card|apple\s+card|\bbilt\b|card\s+services|bk\s+of\s+amer\s+card|wells\s+fargo\s+card|us\s+bank\s+card).{0,40}\b(pmt|pymt|payment|epay|e-?payment|autopay|auto\s?pay|online\s+pmt)\b|\b(payment|autopay|auto\s?pay)\b.{0,20}\bcredit\s+card\b/i;
export const CARD_RECEIVED_PAYMENT_RE = /payment\s*[-–]?\s*thank\s*you|thank\s+you\s+for\s+your\s+payment|automatic\s+payment|autopay|online\s+payment|mobile\s+payment|payment\s+received|payment\s+posted|\bpayment\b/i;
/** Transfer-ish wording on a leg (pair evidence). */
export const TRANSFER_TEXT_RE =
  /transfer|xfer|\btrnsfr\b|zelle|venmo|cash\s?app|paypal|\bwire\b|\bach\b|deposit|withdrawal|sweep|\bpayment\b|\bpymt\b|\bpmt\b|autopay|epay|bill\s?pay|thank\s+you|from\s+(chk|checking|sav|savings)|to\s+(chk|checking|sav|savings)|funds/i;

/** ACH payroll markers (not the word "salary", which people put in P2P memos). */
export const EMPLOYER_ACH_RE = /payroll|\bdes:\s*pay|\bindn:|dir(ect)?\s?dep|\bppd\b.*\bpay\b/i;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** Text of a transaction used for pattern matching. */
export const descriptor = (t: { name: string | null; merchant_name: string | null }) =>
  `${t.merchant_name ?? ""} ${t.name ?? ""}`.trim();

/**
 * True when a transfer-flavored descriptor names the user as the
 * counterparty ("Zelle payment to DILIP NAIK"). Payroll lines are excluded:
 * ACH payroll carries the employee's own name ("INDN:NAIK,DILIP").
 */
export function namesSelf(text: string, selfNames: string[] = []): boolean {
  if (!text || EMPLOYER_ACH_RE.test(text)) return false;
  if (!(P2P_RE.test(text) || /transfer|xfer|\bwire\b|\bach\b/i.test(text))) return false;
  const padded = ` ${norm(text)} `;
  for (const full of selfNames) {
    const parts = norm(full ?? "").split(" ").filter(p => p.length >= 2);
    if (parts.length < 2) continue;
    const first = parts[0], last = parts[parts.length - 1];
    if (padded.includes(` ${first} ${last} `) || padded.includes(` ${last} ${first} `)) return true;
  }
  return false;
}
