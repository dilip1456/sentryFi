/**
 * Pure gift-card logic shared by the Gift Cards screen and its tests:
 * expiry status, issuer grouping, sorting, search, summary totals and
 * barcode-value normalisation. No React, no Supabase.
 */

export type BarcodeFormat = "code128" | "qrcode" | "ean13" | "pdf417";

export const DEFAULT_BARCODE_FORMAT: BarcodeFormat = "code128";

export const BARCODE_FORMATS: { value: BarcodeFormat; label: string; hint: string }[] = [
  { value: "code128", label: "Code 128", hint: "Most store gift cards" },
  { value: "qrcode",  label: "QR code",  hint: "Apps and e-gift cards" },
  { value: "ean13",   label: "EAN-13",   hint: "12–13 digit retail codes" },
  { value: "pdf417",  label: "PDF417",   hint: "Tall stacked barcode" },
];

export const barcodeFormatLabel = (f: BarcodeFormat): string =>
  BARCODE_FORMATS.find(b => b.value === f)?.label ?? "Code 128";

export const isBarcodeFormat = (v: unknown): v is BarcodeFormat =>
  typeof v === "string" && BARCODE_FORMATS.some(b => b.value === v);

/** Mirror of public.gift_cards (generated Supabase types don't include it). */
export type GiftCard = {
  id: string;
  user_id: string;
  brand_name: string;
  domain: string | null;
  logo_url: string | null;
  balance_check_url: string | null;
  buy_url: string | null;
  balance: number;
  initial_balance?: number | null;
  card_number: string | null;
  card_number_last4: string | null;
  pin: string | null;
  notes: string | null;
  expiry_date: string | null;
  balance_verified: boolean;
  last_balance_update?: string | null;
  created_at: string;
  updated_at?: string | null;
  deleted_at?: string | null;
  /** 20261117000000_gift_cards_barcode_archive.sql */
  barcode_format?: BarcodeFormat | string | null;
  /** 20261117000000_gift_cards_barcode_archive.sql: set by "Mark used / archive". */
  archived_at?: string | null;
};

export const EXPIRY_WARNING_DAYS = 30;
const DAY = 86_400_000;

/** Whole days from today (local) to a YYYY-MM-DD date; negative once past. */
export const daysUntil = (dateStr: string, now: number = Date.now()): number => {
  const target = new Date(dateStr + "T00:00:00").getTime();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today.getTime()) / DAY);
};

export type ExpiryStatus = "expired" | "soon" | null;

export const expiryStatus = (expiry: string | null | undefined, now: number = Date.now()): ExpiryStatus => {
  if (!expiry) return null;
  const d = daysUntil(expiry, now);
  if (d < 0) return "expired";
  if (d <= EXPIRY_WARNING_DAYS) return "soon";
  return null;
};

/** Short human label for an expiry chip: "Expired", "Today", "3d left", "Mar 2027". */
export const expiryLabel = (expiry: string | null | undefined, now: number = Date.now()): string | null => {
  if (!expiry) return null;
  const d = daysUntil(expiry, now);
  if (d < 0) return "Expired";
  if (d === 0) return "Expires today";
  if (d <= EXPIRY_WARNING_DAYS) return `${d}d left`;
  return new Date(expiry + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" });
};

/** Grouping key so "Starbucks", "starbucks " and "Starbucks Gift Card" land together. */
export const issuerKey = (name: string): string =>
  name
    .toLowerCase()
    .replace(/\b(e-?gift|gift)\s*cards?\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    || name.toLowerCase().trim();

/** Up to two initials for an issuer badge: "Best Buy" → "BB", "IKEA" → "IK", "7-Eleven" → "7E". */
export const issuerInitials = (name: string): string => {
  const words = name.replace(/['’]/g, "").split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
};

/** Stable hue (0–359) derived from the issuer name, for logo-less tiles. */
export const issuerHue = (name: string): number => {
  const seed = issuerKey(name);
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash % 360;
};

export type SortKey = "balance-desc" | "balance-asc" | "expiry" | "name" | "recent";

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "balance-desc", label: "Highest balance" },
  { value: "balance-asc",  label: "Lowest balance" },
  { value: "expiry",       label: "Expiring soonest" },
  { value: "name",         label: "Issuer A–Z" },
  { value: "recent",       label: "Newest" },
];

const expiryTime = (c: Pick<GiftCard, "expiry_date">): number =>
  c.expiry_date ? new Date(c.expiry_date + "T00:00:00").getTime() : Number.POSITIVE_INFINITY;

const byName = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base" });

/** Returns a new array; ties fall back to issuer name, then id, so order is stable.
 *  "expiry" puts upcoming expiries first (soonest first), then undated cards,
 *  then already-expired ones — the ones you can still act on come first. */
export const sortCards = <T extends GiftCard>(cards: readonly T[], key: SortKey, now: number = Date.now()): T[] => {
  const tie = (a: T, b: T) => byName(a.brand_name, b.brand_name) || a.id.localeCompare(b.id);
  const bucket = (c: T) => expiryStatus(c.expiry_date, now) === "expired" ? 2 : c.expiry_date ? 0 : 1;
  const cmp: Record<SortKey, (a: T, b: T) => number> = {
    "balance-desc": (a, b) => Number(b.balance) - Number(a.balance) || tie(a, b),
    "balance-asc":  (a, b) => Number(a.balance) - Number(b.balance) || tie(a, b),
    expiry:         (a, b) => (bucket(a) - bucket(b)) || ((bucket(a) === 1 ? 0 : expiryTime(a) - expiryTime(b))) || tie(a, b),
    name:           (a, b) => tie(a, b) || Number(b.balance) - Number(a.balance),
    recent:         (a, b) => (new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) || tie(a, b),
  };
  return [...cards].sort(cmp[key]);
};

export type IssuerGroup<T extends GiftCard = GiftCard> = {
  key: string;
  /** Display name: the most common spelling within the group. */
  name: string;
  domain: string | null;
  logo_url: string | null;
  cards: T[];
  total: number;
  /** Soonest non-expired expiry in the group, or null. */
  nextExpiry: string | null;
  expiringSoon: number;
};

/** Groups by issuer; groups and the cards inside them both follow `sort`. */
export const groupByIssuer = <T extends GiftCard>(cards: readonly T[], sort: SortKey, now: number = Date.now()): IssuerGroup<T>[] => {
  const map = new Map<string, T[]>();
  for (const c of sortCards(cards, sort, now)) {
    const k = issuerKey(c.brand_name);
    const list = map.get(k);
    if (list) list.push(c); else map.set(k, [c]);
  }
  const groups: IssuerGroup<T>[] = [];
  for (const [key, list] of map) {
    const counts = new Map<string, number>();
    for (const c of list) counts.set(c.brand_name.trim(), (counts.get(c.brand_name.trim()) ?? 0) + 1);
    const name = [...counts.entries()].sort((a, b) => b[1] - a[1] || byName(a[0], b[0]))[0][0];
    const upcoming = list
      .filter(c => c.expiry_date && daysUntil(c.expiry_date, now) >= 0)
      .map(c => c.expiry_date!)
      .sort();
    groups.push({
      key,
      name,
      domain: list.find(c => c.domain)?.domain ?? null,
      logo_url: list.find(c => c.logo_url)?.logo_url ?? null,
      cards: list,
      total: round2(list.reduce((s, c) => s + Number(c.balance), 0)),
      nextExpiry: upcoming[0] ?? null,
      expiringSoon: list.filter(c => expiryStatus(c.expiry_date, now) === "soon").length,
    });
  }
  const tie = (a: IssuerGroup<T>, b: IssuerGroup<T>) => byName(a.name, b.name);
  const groupExpiry = (g: IssuerGroup<T>) => g.nextExpiry ? new Date(g.nextExpiry + "T00:00:00").getTime() : Number.POSITIVE_INFINITY;
  // Same buckets as sortCards("expiry"): upcoming expiry, then undated, then only-expired groups.
  const groupBucket = (g: IssuerGroup<T>) => g.nextExpiry ? 0 : g.cards.some(c => expiryStatus(c.expiry_date, now) !== "expired") ? 1 : 2;
  const newest = (g: IssuerGroup<T>) => Math.max(...g.cards.map(c => new Date(c.created_at).getTime()));
  const cmp: Record<SortKey, (a: IssuerGroup<T>, b: IssuerGroup<T>) => number> = {
    "balance-desc": (a, b) => b.total - a.total || tie(a, b),
    "balance-asc":  (a, b) => a.total - b.total || tie(a, b),
    expiry:         (a, b) => (groupBucket(a) - groupBucket(b)) || (groupBucket(a) === 0 ? groupExpiry(a) - groupExpiry(b) : 0) || tie(a, b),
    name:           tie,
    recent:         (a, b) => newest(b) - newest(a) || tie(a, b),
  };
  return groups.sort(cmp[sort]);
};

/** Case-insensitive match on issuer, notes, last 4 and domain. */
export const filterCards = <T extends GiftCard>(cards: readonly T[], query: string): T[] => {
  const q = query.trim().toLowerCase();
  if (!q) return [...cards];
  const digits = q.replace(/\D/g, "");
  return cards.filter(c =>
    c.brand_name.toLowerCase().includes(q)
    || (c.notes ?? "").toLowerCase().includes(q)
    || (c.domain ?? "").toLowerCase().includes(q)
    || (digits.length >= 2 && ((c.card_number_last4 ?? "").includes(digits) || (c.card_number ?? "").replace(/\D/g, "").endsWith(digits))),
  );
};

/** Active (usable) vs archived ("marked used") cards. Soft-deleted rows are excluded by the query. */
export const splitArchived = <T extends GiftCard>(cards: readonly T[]): { active: T[]; archived: T[] } => {
  const active: T[] = [];
  const archived: T[] = [];
  for (const c of cards) (c.archived_at ? archived : active).push(c);
  return { active, archived };
};

export type GiftCardSummary = {
  total: number;
  count: number;
  issuers: number;
  expiringSoon: number;
  expiringSoonValue: number;
  expired: number;
};

export const summarize = (cards: readonly GiftCard[], now: number = Date.now()): GiftCardSummary => {
  let total = 0, expiringSoon = 0, expiringSoonValue = 0, expired = 0;
  const issuers = new Set<string>();
  for (const c of cards) {
    const bal = Number(c.balance) || 0;
    const st = expiryStatus(c.expiry_date, now);
    issuers.add(issuerKey(c.brand_name));
    if (st === "expired") { expired++; continue; }
    total += bal;
    if (st === "soon") { expiringSoon++; expiringSoonValue += bal; }
  }
  return { total: round2(total), count: cards.length, issuers: issuers.size, expiringSoon, expiringSoonValue: round2(expiringSoonValue), expired };
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** EAN-13 check digit for the first 12 digits. */
export const ean13CheckDigit = (twelve: string): number => {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(twelve[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
};

/**
 * What to actually encode for a card. Strips spaces/dashes for linear codes;
 * EAN-13 needs 12 digits (check digit added) or 13 with a valid check digit,
 * otherwise it falls back to Code 128 so the screen never fails to render.
 */
export const barcodeValue = (raw: string, format: BarcodeFormat): { value: string; format: BarcodeFormat; fellBack: boolean } => {
  const compact = raw.replace(/[\s-]+/g, "");
  if (format === "ean13") {
    const digits = compact.replace(/\D/g, "");
    const ok = digits === compact && (
      digits.length === 12 || (digits.length === 13 && ean13CheckDigit(digits.slice(0, 12)) === Number(digits[12]))
    );
    if (ok) return { value: digits.slice(0, 12), format, fellBack: false };
    return { value: compact, format: "code128", fellBack: true };
  }
  if (format === "qrcode" || format === "pdf417") return { value: raw.trim(), format, fellBack: false };
  return { value: compact, format: "code128", fellBack: false };
};

/** "6006491234567890" → "6006 4912 3456 7890" for readability at the till. */
export const groupDigits = (raw: string): string => {
  const compact = raw.replace(/\s+/g, "");
  return compact.replace(/(.{4})(?=.)/g, "$1 ");
};

export const resolveFormat = (c: Pick<GiftCard, "barcode_format">): BarcodeFormat =>
  isBarcodeFormat(c.barcode_format) ? c.barcode_format : DEFAULT_BARCODE_FORMAT;
