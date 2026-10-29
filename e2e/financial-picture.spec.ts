import { test, expect, openDemo } from "./fixtures";
import type { Locator, Page } from "@playwright/test";

/**
 * My Financial Picture at 390px (phone): every screen, sheet and dialog opens
 * and closes by X/Back, Escape, browser back, backdrop (sheets) and
 * swipe-down (sheets); nothing overflows horizontally. Plus the 1440px
 * dialog closes. Demo data only; the fixture stubs every backend request.
 */

async function openPicture(page: Page) {
  await page.addInitScript(() => sessionStorage.setItem("sentryfi_view", "myfinances"));
  await openDemo(page);
  await expect(page.getByTestId("financial-picture")).toBeVisible();
}


async function noHorizontalOverflow(el: Locator) {
  // Wait for the slide/zoom-in animation to settle.
  await expect.poll(async () => (await el.evaluate(n => n.getAnimations({ subtree: true }).filter(a => a.playState === "running").length)), { timeout: 3000 }).toBe(0);
  const { sw, cw } = await el.evaluate(n => {
    const body = n.querySelector(".scr-b, .ov-b") ?? n;
    return { sw: body.scrollWidth, cw: body.clientWidth };
  });
  expect(sw, "horizontal overflow").toBeLessThanOrEqual(cw + 1);
  const box = await el.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(391);
}

type Close = "x" | "escape" | "back" | "backdrop" | "swipe";

async function closeBy(page: Page, dlg: Locator, how: Close) {
  if (how === "x") await dlg.getByRole("button", { name: /^(Close|Back)$/ }).first().click();
  else if (how === "escape") await page.keyboard.press("Escape");
  else if (how === "back") await page.goBack();
  else if (how === "backdrop") await page.mouse.click(195, 20);
  else {
    // vaul measures drag time with Date.now(); the fixture's frozen clock
    // makes every drag look instantaneous and vaul ignores it, so let time
    // flow for the gesture. Jump a few seconds ahead too: vaul also ignores
    // drags in the first 500ms after the sheet opened.
    const now = await page.evaluate(() => Date.now());
    await page.clock.setSystemTime(new Date(now + 5000));
    const grab = dlg.locator(".grab");
    const b = (await grab.boundingBox())!;
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    for (let i = 1; i <= 12; i++) { await page.mouse.move(x, y + i * 40); await page.waitForTimeout(16); }
    await page.mouse.up();
  }
  await expect(dlg).toBeHidden();
}

test.describe("phone (390x844)", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test.beforeEach(async ({ page }) => openPicture(page));

  const sections = ["Income", "Paycheck Deductions", "Obligations", "Fixed Expenses", "Budgeted Categories", "Cards & Payoff Accounts", "Savings"];
  for (const name of sections) {
    test(`section screen: ${name}`, async ({ page, guard }) => {
      const card = page.locator("button.sum-card").filter({ hasText: name }).first();
      for (const how of ["x", "escape", "back"] as Close[]) {
        await card.click();
        const dlg = page.getByRole("dialog", { name });
        await expect(dlg).toBeVisible();
        await noHorizontalOverflow(dlg);
        await closeBy(page, dlg, how);
      }
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(guard.consoleErrors).toEqual([]);
    });
  }

  test("Full Picture adds the Taxes screen", async ({ page }) => {
    await page.getByRole("button", { name: "Full Picture" }).click();
    await page.locator("button.sum-card").filter({ hasText: "Taxes" }).click();
    const dlg = page.getByRole("dialog", { name: "Taxes" });
    await expect(dlg).toBeVisible();
    await noHorizontalOverflow(dlg);
    await closeBy(page, dlg, "back");
  });

  const insights: [string, string, string][] = [
    ["sum-card", "Coverage Health", "Coverage Health"], ["sum-card", "Tax Savers", "Tax Savers"], ["tile", "Savings", "Savings Breakdown"],
    ["tile", "Tax Bracket", "Tax Bracket"], ["tile", "Risk Profile", "Risk Profile"], ["tile", "Shares", "Shares (ESPP + RSU)"], ["sum-card", "Where your money goes", "Where your money goes"],
  ];
  for (const [cls, card, title] of insights) {
    test(`insight screen: ${title}`, async ({ page, guard }) => {
      const btn = page.locator(`button.${cls}`).filter({ hasText: card }).first();
      for (const how of ["x", "escape", "back"] as Close[]) {
        await btn.click();
        const dlg = page.getByRole("dialog", { name: title });
        await expect(dlg).toBeVisible();
        await noHorizontalOverflow(dlg);
        await closeBy(page, dlg, how);
      }
      expect(guard.consoleErrors).toEqual([]);
    });
  }

  test("row bottom sheet closes by X, Escape, backdrop, swipe-down and back", async ({ page, guard }) => {
    await page.locator("button.sum-card").filter({ hasText: "Fixed Expenses" }).click();
    const screen = page.getByRole("dialog", { name: "Fixed Expenses" });
    await expect(screen).toBeVisible();
    for (const how of ["x", "escape", "backdrop", "swipe", "back"] as Close[]) {
      await screen.getByRole("button", { name: /^Gym membership, / }).click();
      const sheet = page.getByRole("dialog", { name: "Gym membership" });
      await expect(sheet).toBeVisible();
      await expect(sheet).toHaveAttribute("data-fp-sheet", "");
      await noHorizontalOverflow(sheet);
      await test.step(`close by ${how}`, () => closeBy(page, sheet, how));
      await expect(screen, `section screen stays open after ${how}`).toBeVisible();
    }
    expect(guard.consoleErrors).toEqual([]);
  });

  test("assigning cover from the sheet clears the red flag", async ({ page }) => {
    await page.locator("button.sum-card").filter({ hasText: "Fixed Expenses" }).click();
    await page.getByRole("dialog", { name: "Fixed Expenses" }).getByRole("button", { name: /^Gym membership, / }).click();
    const sheet = page.getByRole("dialog", { name: "Gym membership" });
    await sheet.getByRole("radiogroup", { name: "Covered by" }).getByRole("radio").first().click();
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByText("Saved. Your picture is updated.")).toBeVisible();
  });

  test("card sheet and pick sheet", async ({ page }) => {
    await page.locator("button.sum-card").filter({ hasText: "Cards & Payoff Accounts" }).click();
    const screen = page.getByRole("dialog", { name: "Cards & Payoff Accounts" });
    const cards = screen.locator("button.card-item");
    const n = await cards.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      await cards.nth(i).click();
      const sheet = page.locator("[data-fp-sheet]");
      await expect(sheet).toBeVisible();
      await noHorizontalOverflow(sheet);
      await closeBy(page, sheet, "escape");
    }
  });

  test("add sheets (loan, bill, budget, goal)", async ({ page }) => {
    for (const [sec, btn, title] of [["Obligations", "Add one", "Add a loan or obligation"], ["Fixed Expenses", "Add one", "Add a bill"], ["Budgeted Categories", "Add a budget", "Add a budget"], ["Savings", "Add a goal", "Add a savings goal"]]) {
      await page.locator("button.sum-card").filter({ hasText: sec }).click();
      const screen = page.getByRole("dialog", { name: sec });
      await screen.getByRole("button", { name: btn }).click();
      const sheet = page.getByRole("dialog", { name: title });
      await expect(sheet).toBeVisible();
      await noHorizontalOverflow(sheet);
      await closeBy(page, sheet, "backdrop");
      await closeBy(page, screen, "back");
    }
  });

  test("add a bill end to end", async ({ page }) => {
    await page.locator("button.sum-card").filter({ hasText: "Fixed Expenses" }).click();
    const screen = page.getByRole("dialog", { name: "Fixed Expenses" });
    await screen.getByRole("button", { name: "Add one" }).click();
    const sheet = page.getByRole("dialog", { name: "Add a bill" });
    await sheet.getByLabel("Name").fill("Streaming");
    await sheet.getByLabel("Amount per month").fill("18");
    await sheet.getByRole("button", { name: "Add", exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(screen.getByRole("button", { name: /^Streaming/ })).toBeVisible();
  });

  test("edit screen: pick sheet, cancel and save", async ({ page, guard }) => {
    await page.getByRole("button", { name: "Edit" }).click();
    const screen = page.getByRole("dialog", { name: "Edit your data" });
    await expect(screen).toBeVisible();
    await noHorizontalOverflow(screen);
    await screen.getByRole("button", { name: /Gym membership covered by/ }).click();
    const pick = page.getByRole("dialog", { name: /Gym membership: covered by/ });
    await expect(pick).toBeVisible();
    await noHorizontalOverflow(pick);
    await closeBy(page, pick, "swipe");
    await screen.getByRole("button", { name: /Gym membership covered by/ }).click();
    await pick.getByRole("radio").first().click();
    await pick.getByRole("button", { name: "Done" }).click();
    await expect(pick).toBeHidden();
    await expect(screen).toBeVisible();
    await screen.getByRole("button", { name: "Save changes" }).click();
    await expect(screen).toBeHidden();
    await expect(page.getByText("Saved. Your picture is updated.")).toBeVisible();
    // Cancel path
    await page.getByRole("button", { name: "Edit" }).click();
    await screen.getByRole("button", { name: "Cancel" }).click();
    await expect(screen).toBeHidden();
    expect(guard.consoleErrors).toEqual([]);
  });

  test("coverage Fix opens the row sheet over the screen", async ({ page }) => {
    await page.locator("button.sum-card").filter({ hasText: "Coverage Health" }).click();
    const screen = page.getByRole("dialog", { name: "Coverage Health" });
    await screen.getByRole("button", { name: /Gym membership/ }).first().click();
    const sheet = page.getByRole("dialog", { name: "Gym membership" });
    await expect(sheet).toBeVisible();
    await closeBy(page, sheet, "back");
    await expect(screen).toBeVisible();
  });

  test("what-if sliders and filing toggle", async ({ page }) => {
    await page.locator("button.sum-card").filter({ hasText: "Tax Savers" }).click();
    const s = page.getByRole("dialog", { name: "Tax Savers" });
    await s.getByRole("button", { name: "Max both" }).click();
    await expect(s.getByText(/vs now/)).toContainText("+$");
    await s.getByRole("button", { name: "Reset" }).click();
    await expect(s.getByText(/vs now/)).toContainText("+$0");
    await closeBy(page, s, "back");
    await page.locator("button.tile").filter({ hasText: "Tax Bracket" }).click();
    const b = page.getByRole("dialog", { name: "Tax Bracket" });
    await b.getByRole("button", { name: "Married" }).click();
    await expect(b.getByRole("button", { name: "Married" })).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("desktop (1440x900)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.beforeEach(async ({ page }) => openPicture(page));

  test("insight dialogs close by X, Escape, backdrop and back", async ({ page, guard }) => {
    const opens: [() => Promise<void>, string][] = [
      [() => page.getByRole("button", { name: "Where it goes" }).click(), "Where your money goes"],
      [() => page.locator(".sec").filter({ hasText: "Coverage Health" }).getByRole("button", { name: "View details" }).click(), "Coverage Health"],
      [() => page.locator(".sec").filter({ hasText: "Tax Savers" }).getByRole("button", { name: "View details" }).first().click(), "Tax Savers"],
    ];
    for (const [open, title] of opens) {
      for (const how of ["x", "escape", "backdrop", "back"] as Close[]) {
        await open();
        const dlg = page.getByRole("dialog", { name: title });
        await expect(dlg).toBeVisible();
        if (how === "backdrop") { await page.mouse.click(10, 10); await expect(dlg).toBeHidden(); }
        else await closeBy(page, dlg, how);
      }
    }
    expect(guard.consoleErrors).toEqual([]);
  });

  test("row dialog and inline edit", async ({ page }) => {
    await page.getByRole("button", { name: /^Gym membership, / }).click();
    const dlg = page.getByRole("dialog", { name: "Gym membership" });
    await expect(dlg).toBeVisible();
    await closeBy(page, dlg, "escape");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByText(/Editing: change any amount/)).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText(/Editing: change any amount/)).toBeHidden();
  });

  test("Add on a desktop section opens the same add form as the phone", async ({ page, guard }) => {
    const pairs: [string, string][] = [["Obligations", "Add a loan or obligation"], ["Fixed Expenses", "Add a bill"], ["Budgeted Categories", "Add a budget"], ["Savings", "Add a savings goal"]];
    for (const [sec, title] of pairs) {
      await page.getByRole("button", { name: `Add to ${sec}` }).click();
      const dlg = page.getByRole("dialog", { name: title });
      await expect(dlg).toBeVisible();
      await closeBy(page, dlg, "x");
    }
    expect(guard.consoleErrors).toEqual([]);
  });
});

// ── PR #28 follow-ups: history hint → Settings → Banks, state tax notes ─────
for (const vp of [{ name: "390", width: 390, height: 844, mobile: true }, { name: "1440", width: 1440, height: 900, mobile: false }]) {
  test.describe(`follow-ups at ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile });
    test.beforeEach(async ({ page }) => openPicture(page));

    test("history hint links to Settings → Banks and can be dismissed", async ({ page, guard }) => {
      const hint = page.getByTestId("history-hint");
      await expect(hint).toBeVisible();
      await expect(hint).toContainText(/less than 2 years of history|months of history/);
      await hint.getByRole("button", { name: "Extend history" }).click();
      const dlg = page.getByRole("dialog").filter({ hasText: "Settings" });
      await expect(dlg).toBeVisible();
      await expect(dlg.getByRole("button", { name: "Banks", pressed: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dlg).toBeHidden();
      await hint.getByRole("button", { name: "Dismiss history hint" }).click();
      await expect(hint).toBeHidden();
      // Demo is a guest: settings live in memory, so the dismissal holds while the page does.
      if (vp.mobile) {
        await page.getByRole("button", { name: /^Income/ }).first().click();
        await page.getByRole("button", { name: "Back" }).first().click();
      }
      await expect(page.getByTestId("history-hint")).toBeHidden();
      expect(guard.consoleErrors).toEqual([]);
    });

    test("Tax Savers and Tax Bracket say state tax isn't included", async ({ page }) => {
      const notes = page.getByTestId("state-tax-note");
      await notes.first().scrollIntoViewIfNeeded();
      await expect(notes.filter({ visible: true })).toHaveCount(2);
      if (vp.mobile) await page.getByRole("button", { name: /^Tax Bracket/ }).click();
      else await page.getByRole("button", { name: "Tax Bracket details" }).click();
      await expect(page.getByRole("dialog", { name: "Tax Bracket" }).getByText(/State tax not included/)).toBeVisible();
    });
  });
}
