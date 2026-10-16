/**
 * PDF bank-statement import — extracts transaction rows from an uploaded
 * statement PDF so they can be reviewed and merged into the same
 * plaid_transactions dataset every other screen in the app reads from
 * (visible everywhere via the "Imported" tag, not a separate silo).
 *
 * PDF text extraction uses pdf.js loaded from a CDN at runtime rather than
 * bundled as an npm dependency — statement imports happen rarely enough
 * that shipping a PDF parser in every page load isn't worth it.
 */

const PDFJS_VERSION = "3.11.174";
const PDFJS_BASE = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfjsPromise: Promise<any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadPdfJs(): Promise<any> {
  if (pdfjsPromise) return pdfjsPromise;
  pdfjsPromise = new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existing = (window as any).pdfjsLib;
    if (existing) { resolve(existing); return; }
    const script = document.createElement("script");
    script.src = `${PDFJS_BASE}/pdf.min.js`;
    script.onload = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lib = (window as any).pdfjsLib;
      if (!lib) { reject(new Error("PDF reader failed to load")); return; }
      lib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.js`;
      resolve(lib);
    };
    script.onerror = () => reject(new Error("Couldn't load the PDF reader. Check your connection and try again"));
    document.head.appendChild(script);
  });
  return pdfjsPromise;
}

// Reconstructs visual lines from pdf.js's flat list of positioned text runs.
// getTextContent() returns individual text fragments with x/y coordinates,
// not paragraphs — fragments sharing a y-coordinate (sitting on the same
// visual row) are grouped and ordered left-to-right, which recovers the
// original table layout well enough for line-based regex parsing below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function extractPageLines(page: any): Promise<string[]> {
  const content = await page.getTextContent();
  const items: { y: number; x: number; str: string }[] = content.items
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((it: any) => ({ y: Math.round(it.transform[5]), x: it.transform[4], str: String(it.str) }))
    .filter((it: { str: string }) => it.str.trim().length > 0);

  const byY: Record<number, { x: number; str: string }[]> = {};
  for (const it of items) {
    // Merge into an existing bucket within 2px — pdf.js can report slightly
    // different y-values for runs on the same visual line due to font metrics.
    const bucketKey = Object.keys(byY).map(Number).find(k => Math.abs(k - it.y) <= 2) ?? it.y;
    (byY[bucketKey] ??= []).push({ x: it.x, str: it.str });
  }
  return Object.entries(byY)
    .sort((a, b) => Number(b[0]) - Number(a[0])) // pdf y grows upward — top of page first
    .map(([, cells]) => cells.sort((a, b) => a.x - b.x).map(c => c.str).join(" ").replace(/\s{2,}/g, " ").trim())
    .filter(line => line.length > 0);
}

export async function extractPdfLines(file: File): Promise<string[]> {
  const pdfjsLib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const lines: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    lines.push(...await extractPageLines(page));
  }
  return lines;
}

export interface ParsedStatementTxn {
  date: string;        // YYYY-MM-DD
  description: string;
  amount: number;      // app convention: negative = money in, positive = money out
}

const DATE_LINE_RE = /^(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(.+?)\s+(-?[\d,]+\.\d{2})$/;

function toIsoDate(mmddyy: string): string | null {
  const parts = mmddyy.split("/");
  if (parts.length !== 3) return null;
  const [mm, dd] = parts;
  let yy = parts[2];
  if (yy.length === 2) yy = (Number(yy) >= 70 ? "19" : "20") + yy;
  const m = mm.padStart(2, "0"), d = dd.padStart(2, "0");
  if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  return `${yy}-${m}-${d}`;
}

const ADDITION_HEADER = /^deposits and other additions/i;
const SUBTRACTION_HEADER = /^(atm and debit card subtractions|other subtractions|checks?( paid)?|service fees)/i;
const SECTION_END = /^(total |sub-?total )/i;

// Bank of America's "combined statement" format — the layout this parser was
// built and tested against. Section headers determine whether a line's
// dollar amount means money in or money out; the sign is derived from the
// section itself rather than trusted from the printed text, so a statement
// that prints every amount unsigned would still parse correctly.
export function parseStatementLines(lines: string[]): { txns: ParsedStatementTxn[]; recognizedFormat: boolean } {
  const txns: ParsedStatementTxn[] = [];
  let section: "addition" | "subtraction" | null = null;
  let sawKnownHeader = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (ADDITION_HEADER.test(line)) { section = "addition"; sawKnownHeader = true; continue; }
    if (SUBTRACTION_HEADER.test(line)) { section = "subtraction"; sawKnownHeader = true; continue; }
    if (SECTION_END.test(line)) { section = null; continue; }
    if (!section) continue;
    if (/^date\s+description\s+amount$/i.test(line)) continue;

    const m = line.match(DATE_LINE_RE);
    if (m) {
      const iso = toIsoDate(m[1]);
      if (!iso) continue;
      const absAmt = Math.abs(parseFloat(m[3].replace(/,/g, "")));
      const amount = section === "addition" ? -absAmt : absAmt;
      txns.push({ date: iso, description: m[2].trim(), amount });
    } else if (txns.length > 0) {
      // Wrapped continuation of the previous row's description (no leading
      // date, no trailing amount) — long merchant descriptors wrap onto a
      // second line with neither.
      const last = txns[txns.length - 1];
      last.description = `${last.description} ${line}`.trim();
    }
  }

  if (sawKnownHeader) return { txns, recognizedFormat: true };

  // Fallback for anything that isn't this BoA layout: scan every line for a
  // leading date and trailing dollar amount, trusting whatever sign is
  // already printed. Less reliable — the caller surfaces a "double-check
  // this" notice when recognizedFormat is false.
  const fallback: ParsedStatementTxn[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    const m = line.match(DATE_LINE_RE);
    if (!m) continue;
    const iso = toIsoDate(m[1]);
    if (!iso) continue;
    const literal = parseFloat(m[3].replace(/,/g, ""));
    fallback.push({ date: iso, description: m[2].trim(), amount: -literal });
  }
  return { txns: fallback, recognizedFormat: false };
}

// One logical account's worth of transactions found inside a statement PDF.
// A single-account statement (Bank of America's layout) produces exactly
// one block; a combined statement covering several accounts on one PDF
// (Citibank's layout, checking + multiple savings sub-accounts) produces one
// block per account, each independently mappable to a linked account.
export interface ParsedAccountBlock {
  key: string;         // detected account number, or a synthetic fallback
  label: string;       // display name from the statement, e.g. "Regular Checking"
  hint?: string;        // last 4 digits, for auto-matching to a linked account
  txns: ParsedStatementTxn[];
}

export interface StatementParseResult {
  accounts: ParsedAccountBlock[];
  recognizedFormat: boolean;
}

// Finds "<Month> <day> - <Month> <day>, <year>" (e.g. "Jan 1 - Jan 31, 2026")
// so date-only rows (no year printed per-row, just MM/DD) can be resolved to
// a full date — including correctly rolling back a year for rows that fall
// in a statement period spanning a year boundary (e.g. "Dec 15 - Jan 15, 2026").
function detectStatementPeriod(lines: string[]): { startMonth: number; endMonth: number; year: number } | null {
  const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  for (const line of lines) {
    const m = line.match(/([A-Za-z]{3,9})\.?\s+\d{1,2}\s*[-–]\s*([A-Za-z]{3,9})\.?\s+\d{1,2},?\s*(\d{4})/);
    if (m) {
      const sm = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
      const em = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
      const year = parseInt(m[3], 10);
      if (sm >= 0 && em >= 0) return { startMonth: sm, endMonth: em, year };
    }
  }
  return null;
}

// Substring checks (not exact-line matches) on whitespace-stripped text —
// pdf.js's row reconstruction can add/drop a stray space or reorder how a
// header's cells get joined depending on the exact PDF, and a rigid anchored
// regex silently found zero rows the moment the real layout didn't match the
// hand-tested sample byte-for-byte.
function isCitiTableHeader(line: string): boolean {
  const norm = line.toLowerCase().replace(/\s+/g, "");
  return norm.includes("description") && norm.includes("amountsubtracted") && norm.includes("amountadded") && norm.includes("balance");
}
function isCitiTotalLine(line: string): boolean {
  return line.toLowerCase().replace(/\s+/g, "").includes("totalsubtracted");
}
const CITI_ACCOUNT_NUM_RE = /^(\d{9,17})\b/;
const CITI_ROW_RE = /^(\d{1,2}\/\d{1,2})\s+(.+)$/;
// Excludes a number immediately followed by "%" — interest-rate lines like
// "Annual Percentage Yield Earned 3.29% 16.10" would otherwise have their
// APY percentage mistaken for the transaction's actual dollar amount.
const MONEY_RE = /[\d,]+\.\d{2}(?!%)/g;

// Rows in this format print a bare unsigned dollar figure — there's no minus
// sign and no dedicated income/expense section like the BoA layout — so
// direction has to come from what the description itself says happened.
const CITI_CREDIT_KEYWORDS = [/\bcredit\b/i, /transfer from/i, /interest (paid|earned)/i, /\bdeposit\b/i];
const CITI_DEBIT_KEYWORDS = [/transfer to/i, /electronic debit/i, /\bdebit\b/i, /\bfee\b/i, /\bwithdrawal\b/i, /\bpurchase\b/i];

function classifyCitiRow(desc: string): "credit" | "debit" | null {
  if (CITI_CREDIT_KEYWORDS.some(re => re.test(desc))) return "credit";
  if (CITI_DEBIT_KEYWORDS.some(re => re.test(desc))) return "debit";
  return null;
}

// Citibank's combined-statement format: one or more account blocks (Regular
// Checking, then one per Savings sub-account), each with its own "Date
// Description Amount Subtracted Amount Added Balance" table ending in a
// "Total Subtracted/Added" line. A row shows only one of Subtracted/Added
// (a transaction is either money in or out, never both) plus, on the last
// row of a same-day run, a running balance — so a row with two dollar
// figures has [amount, balance]; a row with one has just [amount].
function parseCitiFormat(lines: string[]): StatementParseResult {
  const period = detectStatementPeriod(lines);
  const fallbackYear = new Date().getFullYear();

  const toIso = (mmdd: string): string | null => {
    const [mmStr, ddStr] = mmdd.split("/");
    const mm = parseInt(mmStr, 10), dd = parseInt(ddStr, 10);
    if (!mm || !dd || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    let year = fallbackYear;
    if (period) {
      const monthIdx = mm - 1;
      year = period.startMonth > period.endMonth
        ? (monthIdx >= period.startMonth ? period.year - 1 : period.year)
        : period.year;
    }
    return `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  };

  const accounts: ParsedAccountBlock[] = [];
  let pendingLabel: string | null = null;
  let currentKey: string | null = null;
  let currentLabel: string | null = null;
  let currentTxns: ParsedStatementTxn[] = [];
  let inTable = false;
  let sawAnyBlock = false;

  const flush = () => {
    if (currentKey) accounts.push({ key: currentKey, label: currentLabel ?? "Account", hint: currentKey.slice(-4), txns: currentTxns });
    currentKey = null; currentLabel = null; currentTxns = []; inTable = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // A line starting with a long account number only counts as the start of
    // a new account block if "Beginning Balance" shows up on this line or
    // one of the next couple — glued to it in the sample PDF, but not
    // something worth hard-requiring on the exact same reconstructed row.
    const acctMatch = line.match(CITI_ACCOUNT_NUM_RE);
    if (acctMatch) {
      const context = `${line} ${lines[i + 1] ?? ""} ${lines[i + 2] ?? ""}`.toLowerCase();
      if (context.includes("beginning balance")) {
        flush();
        currentKey = acctMatch[1];
        currentLabel = pendingLabel;
        sawAnyBlock = true;
        continue;
      }
    }
    if (isCitiTableHeader(line)) { inTable = true; continue; }
    if (isCitiTotalLine(line)) { inTable = false; continue; }

    if (!inTable) {
      // Track the most recent short, plain line as a candidate account label
      // — the account nickname ("Regular Checking", "Citi® Accelerate
      // Savings") always appears immediately before that account's number.
      if (line.length < 60 && !/\d{4,}/.test(line) && !/beginning|ending|balance/i.test(line)) {
        pendingLabel = line;
      }
      continue;
    }

    const rowMatch = line.match(CITI_ROW_RE);
    if (rowMatch) {
      const iso = toIso(rowMatch[1]);
      const numbers = [...rowMatch[2].matchAll(MONEY_RE)].map(m => parseFloat(m[0].replace(/,/g, "")));
      if (!iso || numbers.length === 0) continue;
      const amount = numbers[0]; // second figure, if present, is the running balance — not the transaction amount
      const desc = rowMatch[2].replace(MONEY_RE, "").trim().replace(/\s{2,}/g, " ");
      const dir = classifyCitiRow(desc);
      // Unclassified rows default to money-out rather than silently
      // inflating income — the import preview still shows every row for
      // manual review before anything is written.
      currentTxns.push({ date: iso, description: desc, amount: dir === "credit" ? -amount : amount });
    } else if (currentTxns.length > 0 && !/^[\d,.\s]+$/.test(line)) {
      const last = currentTxns[currentTxns.length - 1];
      last.description = `${last.description} ${line}`.trim();
    }
  }
  flush();

  return { recognizedFormat: sawAnyBlock && accounts.length > 0, accounts };
}

// Last-resort scan for statements that don't match any known layout and
// print dates as bare MM/DD (no year, like Citibank's) rather than a full
// MM/DD/YYYY the BoA-style fallback in parseStatementLines already handles.
// Trusts whatever sign is printed and resolves the missing year from the
// statement period line, same as parseCitiFormat.
function parseGenericMMDD(lines: string[]): ParsedStatementTxn[] {
  const period = detectStatementPeriod(lines);
  if (!period) return [];
  const ROW_RE = /^(\d{1,2}\/\d{1,2})\s+(.+?)\s+(-?[\d,]+\.\d{2})(?:\s+[\d,]+\.\d{2})?$/;
  const out: ParsedStatementTxn[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    const m = line.match(ROW_RE);
    if (!m) continue;
    const [mmStr, ddStr] = m[1].split("/");
    const mm = parseInt(mmStr, 10), dd = parseInt(ddStr, 10);
    if (!mm || !dd || mm < 1 || mm > 12 || dd < 1 || dd > 31) continue;
    const monthIdx = mm - 1;
    const year = period.startMonth > period.endMonth
      ? (monthIdx >= period.startMonth ? period.year - 1 : period.year)
      : period.year;
    const iso = `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    out.push({ date: iso, description: m[2].trim(), amount: parseFloat(m[3].replace(/,/g, "")) });
  }
  return out;
}

// Strips the noise that survives PDF text extraction but adds nothing for a
// human reading the transaction list — and actively hurts anything that
// compares descriptions (categorization, the cross-source duplicate check in
// lib/dedup.ts), since a per-transaction-unique reference number makes two
// occurrences of the exact same merchant look different from each other.
// Removed: confirmation/reference/trace/auth codes and their labels, embedded
// timestamps that just repeat the transaction's own date column, and bare
// digit runs six or more characters long (account/trace numbers with no
// label at all). "NAME:" labels are stripped but the name itself is kept —
// unlike a reference code, who a Zelle payment was from/to is real
// information. Never returns an empty string; falls back to the original
// text trimmed if cleaning would otherwise strip everything.
export function cleanDescription(raw: string): string {
  let s = raw;
  s = s.replace(/\bNAME:\s*/gi, "");
  // A leading "ONLINE" is only stripped as part of a reference-code phrase
  // (e.g. the Citi continuation line "ONLINE Reference # 000336") — bare
  // "Card" is deliberately NOT one of these labels, since it shows up
  // constantly in ordinary descriptive text ("CHASE CARD", "DEBIT CARD
  // PURCHASE") and would swallow whatever real word follows it.
  s = s.replace(/\b(?:ONLINE\s+)?(?:Conf(?:irmation)?|Reference|Ref|Trace|Auth|Pay\s*ID|Org\s*ID)\s*#?\s*:?\s*[A-Za-z0-9]+[;,]?\s*/gi, "");
  s = s.replace(/#\d{3,}/g, "");
  s = s.replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s+\d{1,2}:\d{2}\s*[ap]m?\b/gi, "");
  s = s.replace(/\b\d{6,}\b/g, "");
  s = s.replace(/[:#]+(?=\s|$)/g, "");
  s = s.replace(/\s{2,}/g, " ").replace(/\s+([,.;])/g, "$1").trim();
  s = s.replace(/^[-,;:\s]+|[-,;:\s]+$/g, "");
  return s || raw.trim();
}

// Tries every known statement layout, then falls back to a generic scan.
// Single-account formats (Bank of America) come back as one synthetic block
// so the caller always deals with a uniform accounts[] shape regardless of
// which layout actually matched. Descriptions are cleaned right before
// returning so every layout — including the generic fallback — benefits
// without each parser needing its own cleanup pass.
export function parseStatement(lines: string[]): StatementParseResult {
  const cleanAccounts = (accounts: ParsedAccountBlock[]): ParsedAccountBlock[] =>
    accounts.map(a => ({ ...a, txns: a.txns.map(t => ({ ...t, description: cleanDescription(t.description) })) }));

  const citi = parseCitiFormat(lines);
  if (citi.recognizedFormat) return { ...citi, accounts: cleanAccounts(citi.accounts) };

  const boa = parseStatementLines(lines);
  const hint = detectAccountHint(lines) ?? undefined;
  if (boa.recognizedFormat || boa.txns.length > 0) {
    return { recognizedFormat: boa.recognizedFormat, accounts: cleanAccounts([{ key: hint ?? "file", label: "Statement", hint, txns: boa.txns }]) };
  }

  // Neither known layout matched and the MM/DD/YYYY fallback found nothing —
  // try the MM/DD-only scan before giving up entirely.
  const generic = parseGenericMMDD(lines);
  return { recognizedFormat: false, accounts: cleanAccounts([{ key: hint ?? "file", label: "Statement", hint, txns: generic }]) };
}

// Pulls a bank account number out of statement text (e.g. "Account number:
// 2370 2827 4704" or "Adv Plus Banking   2370 2827 4704") so the import UI
// can suggest which linked account a statement belongs to by matching its
// last 4 digits against each account's mask, instead of always making the
// user pick manually.
export function detectAccountHint(lines: string[]): string | null {
  for (const line of lines) {
    const m = line.match(/account(?:\/plan)?\s*(?:number)?[:#]?\s*(\d[\d\s]{6,}\d)\b/i);
    if (m) {
      const digits = m[1].replace(/\s/g, "");
      if (digits.length >= 4) return digits.slice(-4);
    }
  }
  return null;
}

// Short, stable hash used to build a deterministic transaction_id — the
// same insert key every time the same line is parsed, so re-importing the
// same statement (or an overlapping one) upserts onto the same rows instead
// of creating duplicates.
function hashStr(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return Math.abs(h).toString(36);
}

export function buildImportTransactionId(accountId: string, date: string, description: string, amount: number): string {
  return `pdfimport_${accountId}_${date}_${hashStr(`${description}|${amount}`)}`;
}
