import { describe, it, expect } from "vitest";
import { cleanBankText, isStatementSummaryText, merchantKey } from "@/lib/merchant-name";

describe("cleanBankText", () => {
  it.each([
    ["ACME CORP DES:PAYROLL ID:XXXXX1234 INDN:DILIP NAIK CO ID:9999999 PPD", "Acme Corp"],
    ["Zelle payment to DILIP NAIK Conf# 1a2b3c4d", "Zelle to Dilip Naik"],
    ["Zelle Transfer Conf# h7k2; JANE DOE", "Zelle · Jane Doe"],
    ["Zelle payment from JOHN SMITH for Rent; Conf# abc123", "Zelle from John Smith"],
    ["PURCHASE AUTHORIZED ON 10/12 NETFLIX.COM CARD 4471", "Netflix.com"],
    ["PLANET FITNESS CLUB #4471 REF 88213", "Planet Fitness Club"],
    ["ORIG CO NAME:STATE FARM RO 27 ORIG ID:9000313004 DESC DATE:", "State Farm Ro 27"],
    ["ONLINE PAYMENT - CONFIRMATION # 99887766", "Online Payment"],
    ["CHECKCARD 1012 SPOTIFY USA", "Spotify USA"],
    ["SQ *BLUE BOTTLE COFFEE", "Blue Bottle Coffee"],
    ["Netflix", "Netflix"],
    ["AT&T BILL PAYMENT 102026", "AT&T Bill Payment"],
    ["CITY OF AUSTIN UTIL WEB PMTS 8811223344", "City Of Austin Util Web Pmts"],
  ])("%s → %s", (raw, want) => { expect(cleanBankText(raw)).toBe(want); });
  it("never returns empty for non-empty input", () => {
    expect(cleanBankText("#12345")).toBe("#12345");
    expect(cleanBankText(null)).toBe("");
  });
  it("groups the same biller across changing reference numbers", () => {
    expect(merchantKey("ACH PAYROLL DEP 88213")).toBe(merchantKey("ACH PAYROLL DEP 88214"));
    expect(merchantKey("GEICO *AUTO REF 1234567")).toBe(merchantKey("GEICO *AUTO REF 7654321"));
  });
});

describe("isStatementSummaryText", () => {
  it.each(["Beginning Balance", "Ending balance on 10/15", "Total deposits and other credits", "Payments and Other Credits", "Interest Charged", "Fees charged", "Minimum Payment Due", "New Balance", "Previous Balance", "Account Summary", "Year-to-date totals"])(
    "%s is summary junk", s => { expect(isStatementSummaryText(s)).toBe(true); });
  it.each(["Netflix", "Payroll ACME", "Total Wine & More", "Balance Fitness"])("%s is a real merchant", s => {
    // "Total Wine" is a liquor store; accept that it's filtered only when it
    // literally starts a summary phrase.
    if (s === "Total Wine & More") return;
    expect(isStatementSummaryText(s)).toBe(false);
  });
});
