import { test, expect, openDemo, goTo } from "./fixtures";

// The Spending overview's "Where it went" / "Top merchants" cards were split
// 7/5 from lg, which left them cramped at 1024px (every category name
// truncated). They now sit side by side only from xl.
for (const [w, h] of [[1024, 768], [1280, 800], [1440, 900]] as const) {
  test.describe(`Spending overview at ${w}x${h}`, () => {
    test.use({ viewport: { width: w, height: h } });
    test("cards have room: no truncated category names, no overlap", async ({ page }) => {
      await openDemo(page);
      await goTo(page, "Spending");
      const cats = page.getByRole("region", { name: "Spending by category" });
      const merch = page.getByRole("region", { name: "Top merchants" });
      await expect(cats).toBeVisible();
      const c = (await cats.boundingBox())!, m = (await merch.boundingBox())!;
      expect(c.width).toBeGreaterThanOrEqual(560);
      expect(m.width).toBeGreaterThanOrEqual(340);
      const overlap = !(c.x + c.width <= m.x || m.x + m.width <= c.x || c.y + c.height <= m.y || m.y + m.height <= c.y);
      expect(overlap).toBe(false);
      const truncated = await cats.locator(".truncate").evaluateAll(els =>
        els.filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent));
      expect(truncated).toEqual([]);
    });
  });
}
