/**
 * Turn raw bank/ACH statement descriptors into something a person would
 * write, for display and for grouping recurring patterns:
 *
 *   "ACME CORP DES:PAYROLL ID:XXXXX1234 INDN:DILIP NAIK CO ID:99 PPD" → "Acme Corp"
 *   "Zelle payment to DILIP NAIK Conf# 1a2b3c4d"                      → "Zelle to Dilip Naik"
 *   "PURCHASE AUTHORIZED ON 10/12 NETFLIX.COM CARD 4471"              → "Netflix.com"
 *   "PLANET FITNESS CLUB #4471 REF 88213"                             → "Planet Fitness Club"
 *
 * Pure functions, no app imports, so any page (Budget, Obligations, Home)
 * can share one cleanup instead of each keeping its own regex.
 */

const KEEP_UPPER = new Set(["ATM", "ACH", "USA", "LLC", "IRS", "DMV", "HOA", "CVS", "BP", "USAA", "IKEA", "HSA", "FSA", "IRA", "UPS", "TJX", "AMC", "HBO", "NYC", "GEICO", "AT&T", "H&M", "PNC", "TD", "BMO", "NY", "NJ", "CA", "TX", "FL"]);

/** Leading descriptor noise banks put in front of the merchant. */
const PREFIX_RES: RegExp[] = [
  /^(?:recurring\s+)?(?:purchase|payment)\s+authorized\s+on\s+\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s*/i,
  /^(?:pos|debit\s+card|dbt\s+crd|check\s*card|checkcard|visa|mc)\s+(?:debit|purchase|pur|pmt|payment)?\s*(?:\d{4}\b)?\s*/i,
  /^(?:checkcard|check\s*card)\s+\d{4}\s*/i,
  /^(?:ach|electronic|online|web|preauthorized|pre-authorized|bill)\s+(?:debit|credit|pmt|payment|withdrawal|deposit|transfer)s?\s*[-:]?\s*/i,
  /^(?:sq|tst|pp|py|sp|ckc|dd|ic|lyft|uber)\s*\*\s*(?=\S)/i,
];

/** Trailing reference/confirmation/card/date noise. Applied repeatedly. */
const SUFFIX_RES: RegExp[] = [
  /\s+(?:conf(?:irmation)?|ref(?:erence)?|trace|trn|txn|auth|seq|web\s*id|id|no\.?|number)\s*(?:#|no\.?|num(?:ber)?)?\s*[:#]?\s*[a-z0-9-]*\d[a-z0-9-]*\s*$/i,
  /\s+#\s*[a-z0-9-]*\d[a-z0-9-]*\s*$/i,
  /\s+(?:card|acct|account)\s*(?:#|ending(?:\s+in)?)?\s*[x*]*\d{4}\s*$/i,
  /\s+[x*]{2,}\d{2,}\s*$/i,
  /\s+\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s*$/,
  /\s+\d{5,}\s*$/,
  /\s+(?:ppd|ccd|web|tel|arc|boc|pos|ach)\s*$/i,
];

const ACH_KEY_RE = /\b(?:DES|ID|INDN|CO\s*ID|ORIG\s*ID|SEC|TRACE|EED|IND\s*ID|IND\s*NAME|CO\s*ENTRY\s*DESCR|ENTRY\s*DESCR|DESCR|PMT\s*INFO)\s*:/i;

function titleCase(s: string): string {
  return s.split(/(\s+)/).map(w => {
    if (/^\s+$/.test(w)) return w;
    const bare = w.replace(/[^A-Za-z&]/g, "").toUpperCase();
    if (KEEP_UPPER.has(bare)) return w.toUpperCase();
    if (/\d/.test(w) && !/^\d/.test(w) && w.length <= 4) return w.toUpperCase();
    return w.toLowerCase().replace(/(^|[-'(/])([a-z])/g, (_, p, c) => p + c.toUpperCase());
  }).join("");
}

/** Clean a raw descriptor for display. Never returns an empty string. */
export function cleanBankText(raw: string | null | undefined): string {
  const original = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!original) return "";
  let s = original;

  // Zelle / P2P: keep the direction and the counterparty, drop conf numbers and memos.
  const zelle = s.match(/^zelle\s+(?:payment|transfer|pmt)?\s*(to|from)\s+(.+?)(?:\s+(?:on\s+\d|conf|ref|id\b|for\b|memo\b|;)|$)/i);
  if (zelle) {
    const who = titleCase(zelle[2].replace(/[;,.]+$/, "").trim());
    return `Zelle ${zelle[1].toLowerCase()} ${who}`;
  }
  const zelleConf = s.match(/^zelle\s+(?:payment|transfer)?\s*conf(?:irmation)?\s*#?\s*\w+\s*[;,:-]?\s*(.+)$/i);
  if (zelleConf) return `Zelle · ${titleCase(zelleConf[1].trim())}`;

  // ACH "ORIG CO NAME:ACME CORP ORIG ID:..." → company name.
  const orig = s.match(/orig(?:inator)?\s*co(?:mpany)?\s*name\s*:\s*(.+?)(?=\s+[A-Z][A-Z ]{1,14}:|$)/i);
  if (orig) s = orig[1];
  // ACH "ACME CORP DES:PAYROLL ID:... INDN:..." → part before the first key.
  const key = s.search(ACH_KEY_RE);
  if (key > 0) s = s.slice(0, key);

  const tidy = (x: string) => x.replace(/[\s;,:*#-]+$/, "").replace(/^[\s;,:*#-]+/, "").replace(/\s{2,}/g, " ").trim();
  for (let i = 0; i < 4; i++) {
    const before = s;
    for (const re of SUFFIX_RES) s = s.replace(re, "");
    s = tidy(s);
    if (s === before) break;
  }
  // Only drop a prefix when something meaningful is left after it.
  for (const re of PREFIX_RES) {
    const rest = tidy(s.replace(re, ""));
    if (/[a-z]{2}/i.test(rest)) s = rest;
  }
  if (!/[a-z]/i.test(s)) s = original;
  if (s === s.toUpperCase() && /[A-Z]/.test(s)) s = titleCase(s);
  return s;
}

/**
 * Lines that come from a statement's summary box rather than a real
 * transaction (imported PDFs sometimes carry these through). Never a
 * merchant, never a recurring bill or income source.
 */
const SUMMARY_RE = new RegExp([
  String.raw`^(?:beginning|ending|opening|closing|previous|prior|new|current|statement|average(?:\s+daily)?|daily\s+ending|collected)\s+(?:account\s+)?balance\b`,
  String.raw`^balance\s+(?:forward|brought\s+forward|as\s+of)\b`,
  String.raw`^total\b`,
  String.raw`^sub-?total\b`,
  String.raw`^(?:payments?|deposits?|other\s+credits?|withdrawals?|checks?)(?:\s*(?:and|&|,)\s*(?:other\s+)?(?:credits?|additions?|debits?|subtractions?|withdrawals?|deposits?))+\b`,
  String.raw`^(?:interest|fees?)\s+charged\b`,
  String.raw`^(?:minimum\s+)?payment\s+due\b`,
  String.raw`^(?:credit|cash\s+advance)\s+limit\b`,
  String.raw`^available\s+(?:credit|balance)\b`,
  String.raw`^annual\s+percentage\b`,
  String.raw`^(?:account\s+)?summary\b`,
  String.raw`^(?:year|ytd)[-\s]+to[-\s]+date\b`,
  String.raw`^ytd\b`,
  String.raw`^(?:days?\s+in\s+(?:billing\s+)?(?:cycle|period))\b`,
  String.raw`^(?:statement|billing)\s+(?:period|closing\s+date|date)\b`,
].join("|"), "i");

export function isStatementSummaryText(raw: string | null | undefined): boolean {
  const s = (raw ?? "").replace(/\s+/g, " ").trim();
  return !!s && SUMMARY_RE.test(s);
}

/** Grouping key: cleaned, lower-cased, without legal suffixes. */
export function merchantKey(raw: string | null | undefined): string {
  return cleanBankText(raw).toLowerCase()
    .replace(/\s+(?:and|&|llc|inc|co\.?|corp\.?|ltd)[\s,.]*$/i, "")
    .replace(/[^a-z0-9& ]+/g, " ").replace(/\s+/g, " ").trim();
}
