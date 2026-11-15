import { test, expect, openDemo, goTo } from "./fixtures";

// After the Spending redesign, the "Where it went" / "Top merchants" overview
// cards are no longer on this page. The period strip (In / Out + month bars)
// is the summary that must stay readable and must not overflow at desktop
// widths (and the rest of the page must not scroll sideways).
for (const [w, h] of [[1024, 768], [1280, 800], [1440, 900]] as const) {
  test.describe(`Spending layout at ${w}x${h}`, () => {
    test.use({ viewport: { width: w, height: h } });
    test("period strip fits, In/Out do not overlap, no page overflow", async ({ page }) => {
      await openDemo(page);
      await goTo(page, "Spending");
      const strip = page.getByRole("region", { name: "Spending by period" });
      await expect(strip).toBeVisible();
      const inn = page.getByTestId("period-in");
      const out = page.getByTestId("period-out");
      await expect(inn).toBeVisible();
      await expect(out).toBeVisible();
      const ib = (await inn.boundingBox())!;
      const ob = (await out.boundingBox())!;
      const overlap = !(ib.x + ib.width <= ob.x || ob.x + ob.width <= ib.x || ib.y + ib.height <= ob.y || ob.y + ob.height <= ib.y);
      expect(overlap, "In and Out values overlap").toBe(false);

      const overflow = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        body: document.body.scrollWidth - document.body.clientWidth,
      }));
      expect(overflow.doc, "document horizontal overflow").toBeLessThanOrEqual(1);
      expect(overflow.body, "body horizontal overflow").toBeLessThanOrEqual(1);
    });
  });
}
