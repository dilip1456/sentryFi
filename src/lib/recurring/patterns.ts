/**
 * Recurring-specific descriptor helpers: merchant keys, display names, and
 * subtype refinement (tax / loan / bill) plus yearly hints. Transaction TYPE
 * decisions belong to the shared classifier in `src/lib/classify/`; these only
 * refine a type the classifier already chose.
 */

const STOPWORDS = new Set([
  "ach", "pos", "debit", "credit", "purchase", "payment", "pmt", "pymt", "autopay", "auto", "pay",
  "online", "web", "ppd", "ccd", "id", "co", "entry", "descr", "des", "ref", "trace", "indn", "recurring",
  "payroll", "dir", "dep", "direct", "deposit", "electronic", "epay", "e", "bill", "checkcard", "card",
  "visa", "mc", "the", "inc", "llc", "corp", "ltd", "www", "com",
]);

/**
 * Stable, normalised key for "the same payee". Strips trace numbers, ACH
 * boilerplate and payroll words so "ACME CORP PAYROLL PPD ID: 99123" and
 * "ACME CORP DIR DEP 0415" both become "acme".
 *
 * Each word is also capped to 6 characters before joining. Banks don't always
 * spell a payee's name the same way on every statement cycle - "PROVIDENT
 * FUNDING" one month, "PROVIDENT FUNDIN" (descriptor field truncated by the
 * bank) the next - which otherwise splits one recurring bill into two
 * separate, each-below-threshold entries. Capping the word length makes both
 * spellings collapse to the same key ("fundin") without needing to compare
 * against other transactions.
 */
export function merchantKey(name: string | null | undefined, merchant?: string | null): string {
  const raw = (merchant || name || "").toLowerCase();
  const cleaned = raw
    .replace(/\b(ppd|web|ccd|tel)\s*id:?\s*\S+/g, " ")
    .replace(/\b(indn|trace|ref|conf|id)[:#]?\s*\S+/g, " ")
    .replace(/#\s*\w+/g, " ")
    .replace(/\b\w*\d{3,}\w*\b/g, " ")
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, " ")
    .replace(/[^a-z&\s]/g, " ")
    .split(/\s+/)
    .filter(w => w && !STOPWORDS.has(w));
  const key = cleaned.slice(0, 3).map(w => w.slice(0, 6)).join(" ");
  return key || raw.replace(/\s+/g, " ").trim() || "unknown";
}

/** Strip trace noise and title-case ALL-CAPS descriptors for display. */
export function displayName(raw: string | null | undefined): string {
  let name = (raw ?? "")
    .replace(/\s*(?:ppd|web|ccd)\s*id:?\s*\S+/gi, "")
    .replace(/\s*(?:#|no\.?|ref|trace|conf|id)[:#]?\s*[a-z0-9-]{4,}\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (name === name.toUpperCase() && /[A-Z]/.test(name)) {
    name = name.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }
  return name || "Unknown";
}

export type TaxSubtype = "irs_estimated" | "irs_federal" | "state" | "property";
export function taxSubtype(text: string): TaxSubtype | null {
  if (/\b(1040\s*-?\s*es|est(imated)?\s*tax|estimated)\b/i.test(text)) return "irs_estimated";
  if (/\b(property\s*tax|county\s*treas(urer)?|tax\s*collector)\b/i.test(text)) return "property";
  if (/\b(dept\s*of\s*revenue|department\s*of\s*revenue|state\s*tax|franchise\s*tax|dor\b|tax\s*dept|nys\s*dtf|ftb)\b/i.test(text)) return "state";
  if (/\b(irs|usataxpymt|treas\s*tax|eftps|us\s*treasury)\b/i.test(text)) return "irs_federal";
  return null;
}

export type LoanSubtype = "mortgage" | "student" | "auto" | "personal";
export function loanSubtype(text: string): LoanSubtype | null {
  if (/\b(mortgage|mtg|mr\s*cooper|rocket\s*mortgage|loancare|home\s*loan|pennymac|newrez)\b/i.test(text)) return "mortgage";
  if (/\b(navient|nelnet|mohela|aidvantage|great\s*lakes|fedloan|dept\s*(of\s*)?educ(ation)?|student\s*l(oa)?n|sallie\s*mae)\b/i.test(text)) return "student";
  if (/\b(auto\s*loan|car\s*loan|toyota\s*(fin|financial)|honda\s*(fin|financial)|ally\s*(auto|financial)|ford\s*credit|gm\s*financial)\b/i.test(text)) return "auto";
  if (/\b(loan\s*(pmt|payment)|sofi\s*loan|lending\s*club|upstart|prosper)\b/i.test(text)) return "personal";
  return null;
}

export type BillSubtype = "rent" | "utility" | "insurance" | "phone" | "internet";
export function billSubtype(text: string): BillSubtype | null {
  if (/\b(rent|apartment|apts?|property\s*mgmt|property\s*management|leasing)\b/i.test(text)) return "rent";
  if (/\b(insurance|geico|state\s*farm|progressive|allstate|liberty\s*mutual|usaa\s*ins|lemonade)\b/i.test(text)) return "insurance";
  if (/\b(verizon|at&t|t-?mobile|sprint|mint\s*mobile|cricket)\b/i.test(text)) return "phone";
  if (/\b(comcast|xfinity|spectrum|optimum|cox\s*comm|fios|starlink)\b/i.test(text)) return "internet";
  if (/\b(electric|power|energy|edison|pg&e|con\s*ed|duke\s*energy|water|sewer|utility|utilities|gas\s*co)\b/i.test(text)) return "utility";
  return null;
}

/** Descriptors that strongly imply a once-a-year charge. */
export const YEARLY_HINT_RE =
  /\b(annual|yearly|renewal|annual\s*fee|membership\s*fee|dmv|vehicle\s*registration|registration\s*renewal|property\s*tax|prime\s*membership|premium\s*renewal)\b/i;
