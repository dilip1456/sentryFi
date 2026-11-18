/**
 * Canonical payee keys for My Financial Picture.
 *
 * Bank descriptors for one payee drift: "ROCKET MORTGAGE PAYMENT",
 * "Rocket Mortgage" and "ROCKET MTG ACH WEB PMT" are the same loan; "ADP
 * PAYROLL GLOBEX", "GLOBEX CORP DIR DEP" and merchant_name "ADP" are the same
 * employer. The recurring detector's default merchantKey keeps them apart
 * (and its seriesKeys are persisted, so it can't change). The picture groups
 * by these keys instead, so one payee shows once.
 */
import { merchantKey } from "./patterns";
import { P2P_RE } from "../classify/patterns";

/** Payroll processors that appear instead of the employer's name. */
export const PAYROLL_PROCESSOR_RE =
  /\b(adp|paychex|gusto|workday|paylocity|paycom|rippling|trinet|justworks|intuit|quickbooks|zenefits|deel|bamboohr|ceridian|dayforce|ukg|ultipro|square\s+payroll|onpay|wagepoint|namely|insperity)\b/i;

const SYNONYMS: Record<string, string> = {
  mtg: "mortgage", mortg: "mortgage", mtge: "mortgage", mortgag: "mortgage",
  svcs: "services", svc: "services", serv: "services",
  fin: "financial", finl: "financial", fncl: "financial",
  ins: "insurance", insur: "insurance",
  corporation: "corp", company: "co", incorporated: "inc",
  util: "utility", utils: "utility", utilities: "utility",
  wrls: "wireless", wireles: "wireless",
  natl: "national", mgmt: "management", mgt: "management", prop: "property", props: "property", apts: "apartments", apt: "apartments",
};
/** Words that say how it was paid, not who was paid. */
const GENERIC = new Set([
  "payment", "payments", "pmt", "pymt", "pmnt", "ach", "web", "online", "principal", "escrow", "autopay", "auto", "debit", "bill", "billpay",
  "corp", "co", "inc", "llc", "ltd", "the", "of", "and", "to", "from", "for", "sent", "received", "transfer", "xfer", "money", "conf", "confirmation",
  "zelle", "venmo", "cashapp", "cash", "app", "paypal", "apple", "inst", "instant", "p2p", "square",
  "payroll", "dir", "dep", "direct", "deposit", "salary", "pay", "net", "via", "reg", "regular", "ppd", "ccd",
  "pos", "purchase", "checkcard", "card", "visa", "mc", "recurring", "www", "com", "e", "entry", "descr", "des", "indn", "epay", "electronic", "id",
]);

function tokens(raw: string): string[] {
  return merchantKeyTokens(raw)
    .map(w => SYNONYMS[w] ?? w)
    .filter(w => w && !GENERIC.has(w));
}
/** merchantKey's cleaning (trace numbers, ids, digits), keeping every word. */
function merchantKeyTokens(raw: string): string[] {
  return raw.toLowerCase()
    .replace(/\b(ppd|web|ccd|tel)\s*id:?\s*\S+/g, " ")
    .replace(/\b(indn|trace|ref|conf|id)[:#]?\s*\S+/g, " ")
    .replace(/#\s*\w+/g, " ")
    .replace(/\S+@\S+/g, m => ` ${m.split("@")[0]} `)
    .replace(/\b\w*\d{3,}\w*\b/g, " ")
    .replace(/[^a-z&\s]/g, " ")
    .split(/\s+/).filter(Boolean);
}

const P2P_APP_ONLY_RE = /^(venmo|zelle|cash\s?app|square\s+cash|paypal|apple\s+cash)$/i;
/** merchant_name is only the P2P app (Plaid labels Apple Cash transfers merchant "Apple"). */
const isAppOnlyMerchant = (m: string, name: string | null) =>
  P2P_APP_ONLY_RE.test(m) || (/^apple$/i.test(m) && /\bapple\s+cash\b/i.test(name ?? ""));

/** The text that names the payee: merchant_name unless it's just the P2P app or a payroll processor. */
export function payeeText(t: { name: string | null; merchant_name: string | null }): string {
  const m = (t.merchant_name ?? "").trim();
  if (m && !isAppOnlyMerchant(m, t.name) && !PAYROLL_PROCESSOR_RE.test(m)) return m;
  return t.name ?? m ?? "";
}

/** Canonical key for a payee (bills, subscriptions, P2P, taxes). */
export function payeeKey(t: { name: string | null; merchant_name: string | null }): string {
  const tk = tokens(payeeText(t));
  if (tk.length) return tk.slice(0, 3).join(" ");
  return merchantKey(t.name, t.merchant_name);
}

/** First meaningful word of the payee ("rocket", "verizon"). */
export function payeeBrand(t: { name: string | null; merchant_name: string | null }): string {
  return payeeKey(t).split(" ")[0] ?? "";
}

/**
 * Employer for a paycheck: the payroll processor and payroll boilerplate are
 * dropped, then the first word is the employer ("ADP PAYROLL GLOBEX" and
 * "GLOBEX CORPORATION DIR DEP" are both "globex").
 */
export function employerKey(t: { name: string | null; merchant_name: string | null }): string {
  const strip = (s: string) => s.replace(new RegExp(PAYROLL_PROCESSOR_RE.source, "gi"), " ");
  const m = (t.merchant_name ?? "").trim();
  const useName = !m || PAYROLL_PROCESSOR_RE.test(m) || isAppOnlyMerchant(m, t.name);
  const tk = tokens(strip(useName ? t.name ?? "" : m));
  if (tk.length) return tk[0];
  // Only the processor is named (e.g. "ADP"): that's the best we have.
  return tokens(t.name ?? m ?? "")[0] ?? merchantKey(t.name, t.merchant_name);
}

/** A display name for an employer key from its newest deposit. */
export function employerLabel(t: { name: string | null; merchant_name: string | null }): string {
  const k = employerKey(t);
  // A cleaned company name ("CGI Technologies") reads better than its first word.
  const m = (t.merchant_name ?? "").trim();
  if (m && !PAYROLL_PROCESSOR_RE.test(m) && !isAppOnlyMerchant(m, t.name) && /[a-z]/.test(m) && m.toLowerCase().split(/\s+/)[0] === k) return m;
  const src = [t.merchant_name, t.name].filter(Boolean).join(" ");
  // Keep the original casing when the merchant name already reads well ("DoorDash").
  const word = src.split(/[^A-Za-z&]+/).find(w => w.toLowerCase() === k);
  if (word && word !== word.toUpperCase()) return word;
  return k.replace(/\b\w/g, c => c.toUpperCase());
}

export const isP2PText = (t: { name: string | null; merchant_name: string | null }) => P2P_RE.test(`${t.name ?? ""} ${t.merchant_name ?? ""}`);
/** Which P2P app, for display ("Zelle"). */
export function p2pApp(t: { name: string | null; merchant_name: string | null }): string | null {
  const m = `${t.name ?? ""} ${t.merchant_name ?? ""}`.match(/zelle|venmo|cash\s?app|apple\s+cash|paypal/i)?.[0];
  if (!m) return null;
  const l = m.toLowerCase().replace(/\s+/g, " ");
  return l === "cashapp" || l === "cash app" ? "Cash App" : l === "apple cash" ? "Apple Cash" : l === "paypal" ? "PayPal" : l[0].toUpperCase() + l.slice(1);
}

// ── Payee cleanup for display and grouping ────────────────────────────────

const SMALL_WORDS = new Set(["the", "a", "an", "and", "for", "of", "to", "at", "in", "on", "by"]);
/** "CGI TECHNOLOGIES" → "CGI Technologies": a short leading all-caps word is usually an acronym. */
function companyCase(raw: string): string {
  const words = raw.trim().split(/\s+/).filter(Boolean);
  return words.map((w, i) => {
    const l = w.toLowerCase();
    if (i === 0 && words.length > 1 && /^[A-Z&]{2,3}$/.test(w) && !SMALL_WORDS.has(l)) return w;
    return l.replace(/(^|[-'(/&])([a-z])/g, (_, p, c) => p + c.toUpperCase());
  }).join(" ");
}

/** BofA P2P lines: "Zelle Credit PAY ID:… ORG ID:BAC NAME:CHANDRIKA RA" → "Chandrika Ra". */
export function bankNameField(name: string | null | undefined): string | null {
  const m = (name ?? "").match(/\bNAME:\s*([A-Za-z][A-Za-z .,'&-]*?)\s*(?:\b(?:ID|INDN|CO ID|CONF|PAY ID|ORG ID):|$)/);
  return m ? companyCase(m[1].replace(/[.,]+$/, "")) : null;
}

/** Payroll ACH: "CGI TECHNOLOGIES DES:PAYROLL ID:… INDN:…" → "CGI Technologies". */
export function payrollCompany(name: string | null | undefined): string | null {
  const m = (name ?? "").match(/^(.+?)\s+DES:\s*(?:PAYROLL|PAY|DIR\s*DEP|SALARY)\b/i);
  if (!m) return null;
  const co = m[1].replace(new RegExp(PAYROLL_PROCESSOR_RE.source, "gi"), " ").replace(/\s+/g, " ").trim();
  return co ? companyCase(co) : null;
}

/**
 * Merchant names a bank truncated one month and spelled out the next
 * ("Provident Fundin" / "Provident Funding"): map each truncated form to the
 * full one so one payee stays one row with its full name.
 */
export function canonicalMerchants(names: Iterable<string | null | undefined>): Map<string, string> {
  const uniq = [...new Set([...names].map(n => (n ?? "").trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  const out = new Map<string, string>();
  for (const short of uniq) {
    if (short.length < 8) continue;
    const l = short.toLowerCase();
    const full = uniq.find(f => f.length > short.length && f.length - short.length <= 4 && f.toLowerCase().startsWith(l) && /^[a-z]/i.test(f.slice(short.length)));
    if (full) out.set(l, full);
  }
  return out;
}

/** The payee name to group and show a transaction by (raw fields untouched). */
export function cleanPayee(t: { name: string | null; merchant_name: string | null }, canon?: Map<string, string>): string | null {
  const m = (t.merchant_name ?? "").trim();
  if (m && !PAYROLL_PROCESSOR_RE.test(m) && !isAppOnlyMerchant(m, t.name)) return canon?.get(m.toLowerCase()) ?? m;
  return payrollCompany(t.name) ?? bankNameField(t.name) ?? (m || null);
}
