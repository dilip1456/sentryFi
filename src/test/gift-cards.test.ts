import { describe, it, expect } from "vitest";
import {
  barcodeValue, daysUntil, ean13CheckDigit, expiryLabel, expiryStatus, filterCards, groupByIssuer,
  groupDigits, issuerHue, issuerInitials, issuerKey, resolveFormat, sortCards, splitArchived, summarize,
  type GiftCard,
} from "@/lib/gift-cards";

// Local noon on Nov 16 2026 (TZ pinned to America/New_York in vitest.config).
const NOW = new Date(2026, 10, 16, 12, 0, 0).getTime();
const plus = (d: number) => {
  const t = new Date(2026, 10, 16 + d);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};

let n = 0;
const card = (p: Partial<GiftCard> & { brand_name: string }): GiftCard => ({
  id: `c${++n}`, user_id: "u", domain: null, logo_url: null, balance_check_url: null, buy_url: null,
  balance: 0, card_number: null, card_number_last4: null, pin: null, notes: null, expiry_date: null,
  balance_verified: false, created_at: new Date(2026, 0, n).toISOString(), ...p,
});

describe("expiry", () => {
  it("counts whole local days and flags soon/expired", () => {
    expect(daysUntil(plus(0), NOW)).toBe(0);
    expect(daysUntil(plus(1), NOW)).toBe(1);
    expect(daysUntil(plus(-1), NOW)).toBe(-1);
    expect(expiryStatus(null, NOW)).toBeNull();
    expect(expiryStatus(plus(-1), NOW)).toBe("expired");
    expect(expiryStatus(plus(0), NOW)).toBe("soon");
    expect(expiryStatus(plus(30), NOW)).toBe("soon");
    expect(expiryStatus(plus(31), NOW)).toBeNull();
  });
  it("labels chips", () => {
    expect(expiryLabel(plus(-3), NOW)).toBe("Expired");
    expect(expiryLabel(plus(0), NOW)).toBe("Expires today");
    expect(expiryLabel(plus(5), NOW)).toBe("5d left");
    expect(expiryLabel("2027-03-15", NOW)).toBe("Mar 2027");
    expect(expiryLabel(null, NOW)).toBeNull();
  });
});

describe("issuer identity", () => {
  it("normalises names for grouping", () => {
    expect(issuerKey("Starbucks")).toBe(issuerKey("starbucks "));
    expect(issuerKey("Starbucks Gift Card")).toBe(issuerKey("Starbucks"));
    expect(issuerKey("Domino's")).toBe("dominos");
    expect(issuerKey("Best Buy")).not.toBe(issuerKey("Best Western"));
  });
  it("derives initials and a stable hue", () => {
    expect(issuerInitials("Best Buy")).toBe("BB");
    expect(issuerInitials("IKEA")).toBe("IK");
    expect(issuerInitials("Domino's")).toBe("DO");
    expect(issuerInitials("7-Eleven")).toBe("7E");
    expect(issuerInitials("")).toBe("?");
    expect(issuerHue("Target")).toBe(issuerHue("target gift card"));
    expect(issuerHue("Target")).toBeGreaterThanOrEqual(0);
    expect(issuerHue("Target")).toBeLessThan(360);
  });
});

describe("sortCards", () => {
  const a = card({ brand_name: "Amazon", balance: 10, expiry_date: plus(90) });
  const b = card({ brand_name: "Target", balance: 50, expiry_date: plus(5) });
  const c = card({ brand_name: "Best Buy", balance: 25 });
  it("sorts by balance both ways", () => {
    expect(sortCards([a, b, c], "balance-desc").map(x => x.brand_name)).toEqual(["Target", "Best Buy", "Amazon"]);
    expect(sortCards([a, b, c], "balance-asc").map(x => x.brand_name)).toEqual(["Amazon", "Best Buy", "Target"]);
  });
  it("sorts by soonest expiry, then undated, then already expired", () => {
    const gone = card({ brand_name: "Domino's", balance: 5, expiry_date: plus(-3) });
    expect(sortCards([gone, a, b, c], "expiry", NOW).map(x => x.brand_name)).toEqual(["Target", "Amazon", "Best Buy", "Domino's"]);
  });
  it("sorts by name and by recency without mutating input", () => {
    const input = [b, c, a];
    expect(sortCards(input, "name").map(x => x.brand_name)).toEqual(["Amazon", "Best Buy", "Target"]);
    expect(sortCards(input, "recent")[0]).toBe(c);
    expect(input).toEqual([b, c, a]);
  });
});

describe("groupByIssuer", () => {
  const s1 = card({ brand_name: "Starbucks", balance: 15, expiry_date: plus(10) });
  const s2 = card({ brand_name: "starbucks", balance: 5.5 });
  const s3 = card({ brand_name: "Starbucks", balance: 20, domain: "starbucks.com" });
  const t1 = card({ brand_name: "Target", balance: 100, expiry_date: plus(-2) });
  const k1 = card({ brand_name: "IKEA", balance: 30, expiry_date: plus(200) });

  it("merges spellings, totals per issuer and picks the common spelling", () => {
    const g = groupByIssuer([s1, s2, s3, t1, k1], "balance-desc", NOW);
    const sb = g.find(x => x.key === "starbucks")!;
    expect(sb.name).toBe("Starbucks");
    expect(sb.cards).toHaveLength(3);
    expect(sb.total).toBe(40.5);
    expect(sb.domain).toBe("starbucks.com");
    expect(sb.cards.map(c => c.balance)).toEqual([20, 15, 5.5]);
    expect(sb.expiringSoon).toBe(1);
    expect(sb.nextExpiry).toBe(plus(10));
  });
  it("orders groups by the chosen sort", () => {
    const keys = (s: Parameters<typeof groupByIssuer>[1]) => groupByIssuer([s1, s2, s3, t1, k1], s, NOW).map(g => g.key);
    expect(keys("balance-desc")).toEqual(["target", "starbucks", "ikea"]);
    expect(keys("balance-asc")).toEqual(["ikea", "starbucks", "target"]);
    expect(keys("name")).toEqual(["ikea", "starbucks", "target"]);
    // Target's only card is already expired, so it sinks to the bottom.
    expect(keys("expiry")).toEqual(["starbucks", "ikea", "target"]);
    const undated = card({ brand_name: "Apple", balance: 1 });
    expect(groupByIssuer([t1, undated, k1], "expiry", NOW).map(g => g.key)).toEqual(["ikea", "apple", "target"]);
  });
});

describe("filter, archive split and summary", () => {
  const x = card({ brand_name: "Panera Bread", balance: 34.67, card_number: "6006491234564608", card_number_last4: "4608", notes: "Birthday" });
  const y = card({ brand_name: "REI", balance: 14.17, expiry_date: plus(12) });
  const z = card({ brand_name: "Domino's", balance: 5, expiry_date: plus(-1) });
  const w = card({ brand_name: "Lowe's", balance: 0, archived_at: "2026-11-01T00:00:00Z" });

  it("searches issuer, notes and card digits", () => {
    expect(filterCards([x, y, z], "pan").map(c => c.id)).toEqual([x.id]);
    expect(filterCards([x, y, z], "birthday").map(c => c.id)).toEqual([x.id]);
    expect(filterCards([x, y, z], "4608").map(c => c.id)).toEqual([x.id]);
    expect(filterCards([x, y, z], "  ")).toHaveLength(3);
    expect(filterCards([x, y, z], "zzz")).toHaveLength(0);
  });
  it("splits archived cards out", () => {
    const { active, archived } = splitArchived([x, y, w]);
    expect(active.map(c => c.id)).toEqual([x.id, y.id]);
    expect(archived.map(c => c.id)).toEqual([w.id]);
  });
  it("totals usable value and expiring-soon value, excluding expired", () => {
    expect(summarize([x, y, z], NOW)).toEqual({
      total: 48.84, count: 3, issuers: 3, expiringSoon: 1, expiringSoonValue: 14.17, expired: 1,
    });
  });
});

describe("barcode values", () => {
  it("computes the EAN-13 check digit", () => {
    expect(ean13CheckDigit("400638133393")).toBe(1);
  });
  it("keeps valid EAN-13 and falls back to Code 128 otherwise", () => {
    expect(barcodeValue("4006381333931", "ean13")).toEqual({ value: "400638133393", format: "ean13", fellBack: false });
    expect(barcodeValue("400638133393", "ean13")).toEqual({ value: "400638133393", format: "ean13", fellBack: false });
    expect(barcodeValue("4006381333932", "ean13").fellBack).toBe(true);
    expect(barcodeValue("ABC-123", "ean13")).toEqual({ value: "ABC123", format: "code128", fellBack: true });
  });
  it("strips spacing for Code 128 and keeps QR/PDF417 text", () => {
    expect(barcodeValue("6006 4912-3456", "code128").value).toBe("600649123456");
    expect(barcodeValue(" https://x.y/abc ", "qrcode").value).toBe("https://x.y/abc");
    expect(barcodeValue("A B", "pdf417").value).toBe("A B");
  });
  it("groups digits and resolves unknown formats to Code 128", () => {
    expect(groupDigits("6006491234567890")).toBe("6006 4912 3456 7890");
    expect(resolveFormat({ barcode_format: "pdf417" })).toBe("pdf417");
    expect(resolveFormat({ barcode_format: "upc" })).toBe("code128");
    expect(resolveFormat({ barcode_format: null })).toBe("code128");
  });
});
