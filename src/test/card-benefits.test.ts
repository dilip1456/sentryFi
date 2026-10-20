import { describe, it, expect } from "vitest";
import {
  cleanText, displayValue, normalizeBenefitName, sameBenefitName, benefitsMatch,
  dedupeBenefits, summarizeBenefits, rewardUnitForCard, formatRewardRate,
  buildSpendSuggestions, reconcileFetched, bucketForRewardCategory, type RawBenefit,
} from "@/lib/card-benefits";
import { isMissingColumnError, isMissingTableError } from "@/lib/supabase-errors";

const raw = (key: string, title: string, extra: Partial<RawBenefit> = {}): RawBenefit => ({
  key, title, description: "", value: null, period: "annual", action_type: "none",
  action_label: null, cashback_category: null, cashback_rate: null, priority: 3, used_at: null, ...extra,
});

describe("cleanText / displayValue", () => {
  it("never yields null-ish strings", () => {
    for (const v of [null, undefined, "null", "NULL", " undefined ", "n/a", "", "None"]) expect(cleanText(v)).toBe("");
    expect(cleanText("Activate Priority Pass · null")).toBe("Activate Priority Pass");
    expect(cleanText("Earn 10x on Capital One Travel · undefined")).toBe("Earn 10x on Capital One Travel");
  });
  it("hides zero-dollar values", () => {
    for (const v of ["$0", "0", "$0/year", "$0.00", "$0 per year", "null", null]) expect(displayValue(v)).toBe("");
    expect(displayValue("$300/year")).toBe("$300/year");
    expect(displayValue("$100 every 4 years")).toBe("$100 every 4 years");
  });
});

describe("benefit name normalization", () => {
  it("strips verbs and filler", () => {
    expect(normalizeBenefitName("Apply $300 travel credit")).toBe(normalizeBenefitName("$300 Annual Travel Credit"));
    expect(normalizeBenefitName("Register for Hertz status")).toBe("hertz status");
  });
  it("matches subset phrasings with 2+ tokens", () => {
    expect(sameBenefitName("Use Global Entry credit", "Global Entry / TSA PreCheck Credit")).toBe(true);
    expect(sameBenefitName("Activate Priority Pass", "Priority Pass Select membership")).toBe(true);
    expect(sameBenefitName("Cell phone protection", "Purchase protection")).toBe(false);
    expect(sameBenefitName("$300 travel credit", "$50 travel credit")).toBe(false);
  });
  it("does not glue unrelated perks through generic action labels", () => {
    const a = raw("a", "Priority Pass lounges", { action_label: "Activate now" });
    const b = raw("b", "Hertz President's Circle", { action_label: "Activate now" });
    expect(benefitsMatch(a, b)).toBe(false);
  });
  it("matches a title against another row's action label", () => {
    const action = raw("apply_credit", "Travel credit reminder", { action_label: "Apply $300 travel credit", action_type: "use_credit" });
    const perk = raw("annual_travel_credit", "$300 Annual Travel Credit", { value: "$300/year" });
    expect(benefitsMatch(action, perk)).toBe(true);
  });
});

describe("dedupeBenefits", () => {
  const rows = [
    raw("travel_credit", "$300 Annual Travel Credit", { value: "$300/year", priority: 2 }),
    raw("annual_travel_credit", "$300 annual travel credit", { value: "null" }),
    raw("venture_x_travel_credit", "$300 Annual Travel Credit", { used_at: "2026-10-01T00:00:00Z" }),
    raw("apply_300", "Apply $300 travel credit", { action_type: "use_credit", action_label: "Apply $300 travel credit", priority: 1 }),
    raw("global_entry", "Use Global Entry credit", { action_type: "use_credit" }),
    raw("global_entry_tsa", "Global Entry/TSA PreCheck credit", { value: "$120 every 4 years" }),
    raw("pp", "Activate Priority Pass", { action_type: "activate", value: "null" }),
    raw("pp2", "Activate Priority Pass", { action_type: "activate" }),
    raw("hertz", "Register for Hertz status", { action_type: "register" }),
    raw("hertz2", "Register for Hertz status", { action_type: "register" }),
    raw("portal", "Earn 10x on Capital One Travel", { value: "null", cashback_category: "portal_travel", cashback_rate: 10 }),
  ];
  const out = dedupeBenefits(rows);

  it("collapses duplicates to one entry each", () => {
    expect(out.map(b => b.title)).toHaveLength(5);
    const travel = out.filter(b => /travel credit/i.test(b.title));
    expect(travel).toHaveLength(1);
    expect(out.filter(b => /priority pass/i.test(b.title))).toHaveLength(1);
    expect(out.filter(b => /hertz/i.test(b.title))).toHaveLength(1);
    expect(out.filter(b => /global entry/i.test(b.title))).toHaveLength(1);
  });

  it("merges keys, keeps the actionable row, best value, and done state", () => {
    const travel = out.find(b => /travel credit/i.test(b.title))!;
    expect(travel.keys.sort()).toEqual(["annual_travel_credit", "apply_300", "travel_credit", "venture_x_travel_credit"]);
    expect(travel.action_type).toBe("use_credit");
    expect(travel.value).toBe("$300/year");
    expect(travel.used_at).toBe("2026-10-01T00:00:00Z");
    expect(travel.priority).toBe(1);
  });

  it("never renders null text", () => {
    for (const b of out) {
      for (const v of [b.title, b.description, b.value, b.action_label ?? ""]) {
        expect(v).not.toMatch(/\b(null|undefined)\b/i);
      }
    }
  });
});

describe("summarizeBenefits", () => {
  it("is the single source for every count", () => {
    const cards = [
      { account_id: "a", name: "Venture X", official_name: "Capital One Venture X", benefits: dedupeBenefits([
        raw("1", "Activate Priority Pass", { action_type: "activate" }),
        raw("2", "Activate Priority Pass", { action_type: "activate", used_at: "2026-01-01" }),
        raw("3", "Cell phone protection"),
      ]) },
      { account_id: "b", name: "Macy's", official_name: "Macy's Card", benefits: [] },
    ];
    const s = summarizeBenefits(cards);
    expect(s.totalPerks).toBe(2);
    expect(s.completed).toBe(1);
    expect(s.pendingActions).toBe(0);
    expect(s.perCard.a).toEqual({ total: 2, completed: 1, pending: 0 });
    expect(s.perCard.b).toEqual({ total: 0, completed: 0, pending: 0 });
  });
});

describe("reward units", () => {
  it("labels miles/points cards correctly", () => {
    expect(rewardUnitForCard("Capital One Venture X")).toBe("miles");
    expect(rewardUnitForCard("Chase Sapphire Preferred")).toBe("points");
    expect(rewardUnitForCard("Citi Double Cash")).toBe("cash");
    expect(formatRewardRate(4, "miles")).toBe("4x miles");
    expect(formatRewardRate(2, "cash")).toBe("2% back");
    expect(formatRewardRate(1.5, "cash")).toBe("1.5% back");
    expect(formatRewardRate(null, "cash")).toBe("—");
  });
  it("keeps issuer-portal rates out of general travel", () => {
    expect(bucketForRewardCategory("Capital One Travel")).toBe("portal");
    expect(bucketForRewardCategory("portal_travel")).toBe("portal");
    expect(bucketForRewardCategory("dining")).toBe("dining");
  });
});

describe("buildSpendSuggestions", () => {
  it("names the current card and never says Unknown", () => {
    const now = Date.parse("2026-10-20T12:00:00Z");
    const accounts = [
      { account_id: "vx", name: "Venture X", official_name: "Capital One Venture X", type: "credit" },
      { account_id: "dc", name: "Double Cash", official_name: "Citi Double Cash", type: "credit" },
      { account_id: "chk", name: "Checking", type: "depository" },
    ];
    const cards = [
      { account_id: "vx", name: "Venture X", official_name: "Capital One Venture X", benefits: dedupeBenefits([
        raw("r1", "2x miles on everything", { cashback_category: "everything", cashback_rate: 2 }),
        raw("r2", "10x on Capital One Travel", { cashback_category: "portal_travel", cashback_rate: 10 }),
      ]) },
      { account_id: "dc", name: "Double Cash", official_name: "Citi Double Cash", benefits: [] },
    ];
    const txns = [
      ...Array.from({ length: 6 }, (_, i) => ({ account_id: "chk", amount: 200, date: `2026-10-0${i + 1}`, category: ["Food and Drink", "Restaurants"] })),
    ];
    const out = buildSpendSuggestions(cards, txns, accounts, now);
    expect(out).toHaveLength(1);
    expect(out[0].current_card_name).toBe("Checking");
    expect(out[0].current_rate_label).toBe("No rewards");
    expect(out[0].best_card_name).toBe("Capital One Venture X");
    expect(out[0].best_rate_label).toBe("2x miles");
    for (const s of out) expect(JSON.stringify(s)).not.toMatch(/Unknown|null|undefined/);
  });
});

describe("reconcileFetched", () => {
  it("reuses existing keys so re-fetching doesn't add duplicates", () => {
    const existing = [
      raw("travel_credit", "$300 Annual Travel Credit", { used_at: "2026-09-01" }),
      raw("annual_travel_credit_2", "$300 annual travel credit"),
      raw("lounge", "Priority Pass lounge access"),
    ];
    const incoming = [
      raw("annual_travel_credit", "$300 Annual Travel Credit"),
      raw("priority_pass", "Priority Pass Select lounge access"),
      raw("priority_pass_dup", "Priority Pass Select lounge access"),
      raw("hertz", "Hertz President's Circle status"),
    ];
    const { rows, redundantKeys } = reconcileFetched(existing, incoming);
    expect(rows.map(r => r.key)).toEqual(["travel_credit", "lounge", "hertz"]);
    expect(redundantKeys).toEqual(["annual_travel_credit_2"]);
  });
});

describe("supabase error classification", () => {
  it("detects the live Gift Cards failures", () => {
    expect(isMissingColumnError({ code: "42703", message: "column gift_cards.deleted_at does not exist" }, "deleted_at")).toBe(true);
    expect(isMissingColumnError({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingTableError({ code: "PGRST205", message: "Could not find the table 'public.gift_card_activity' in the schema cache" })).toBe(true);
    expect(isMissingTableError(null)).toBe(false);
  });
});
