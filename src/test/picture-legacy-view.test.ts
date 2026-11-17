import { describe, expect, it } from "vitest";
import { isLegacyPictureView, normalizeView } from "@/lib/picture/legacy-view";

describe("one Financial Picture: old view ids", () => {
  it("maps the removed Picture Preview view to the Picture", () => {
    expect(isLegacyPictureView("myfinances-redesign")).toBe(true);
    expect(normalizeView("myfinances-redesign")).toBe("myfinances");
  });
  it("leaves every other view alone", () => {
    for (const v of ["myfinances", "overall", "spending", "giftcards", "moneymap", ""]) {
      expect(isLegacyPictureView(v)).toBe(false);
      expect(normalizeView(v)).toBe(v);
    }
    expect(isLegacyPictureView(null)).toBe(false);
  });
});
