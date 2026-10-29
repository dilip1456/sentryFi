import type { Locator, Page } from "@playwright/test";
import { expect } from "./fixtures";

/**
 * Geometry checks shared by the popup specs.
 *
 * closeXProblems: the popup's close X (an accessible "Close" button) must be a
 * 44x44 tap target and no visible glyph (text, icon, image, form control) of
 * the popup may sit under it. Text is measured per line box with a Range, so a
 * full-width header div is fine as long as its words stay clear of the X.
 *
 * overflowProblems: nothing inside the popup scrolls (or spills) sideways.
 */
export async function closeXProblems(pop: Locator): Promise<string[]> {
  return pop.evaluate((root: HTMLElement) => {
    const out: string[] = [];
    const x = Array.from(root.querySelectorAll<HTMLElement>("button[aria-label='Close'], button[aria-label='close']"))
      .find(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(b).visibility !== "hidden"; });
    if (!x) return ["no visible Close button"];
    const xr = x.getBoundingClientRect();
    if (xr.width < 43.5 || xr.height < 43.5) out.push(`Close is ${Math.round(xr.width)}x${Math.round(xr.height)}, want >= 44x44`);
    // The visible X glyph is what must not collide; allow the transparent
    // tap area to brush neighbours by a few px.
    const glyph = (x.querySelector("svg") ?? x).getBoundingClientRect();
    const pad = 4;
    const zone = { l: glyph.left - pad, r: glyph.right + pad, t: glyph.top - pad, b: glyph.bottom + pad };
    const hits = (r: DOMRect) => r.width > 0 && r.height > 0 && r.left < zone.r && r.right > zone.l && r.top < zone.b && r.bottom > zone.t;
    const visible = (el: Element) => {
      for (let e: Element | null = el; e && e !== root.parentElement; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return false;
        if (e.classList.contains("sr-only")) return false;
      }
      return true;
    };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement!;
      if (!n.textContent!.trim() || x.contains(el) || !visible(el)) continue;
      const range = document.createRange(); range.selectNodeContents(n);
      for (const r of Array.from(range.getClientRects())) if (hits(r as DOMRect)) { out.push(`text "${n.textContent!.trim().slice(0, 30)}" under the X`); break; }
    }
    for (const el of Array.from(root.querySelectorAll("svg, img, input, select, textarea, button"))) {
      if (el === x || x.contains(el) || el.contains(x) || !visible(el)) continue;
      if (el.closest("button") && el.tagName !== "BUTTON") continue; // judged via its button
      if (hits(el.getBoundingClientRect())) out.push(`<${el.tagName.toLowerCase()}${el.getAttribute("aria-label") ? ` "${el.getAttribute("aria-label")}"` : ""}> under the X`);
    }
    return Array.from(new Set(out));
  });
}

export async function overflowProblems(pop: Locator): Promise<string[]> {
  return pop.evaluate((root: HTMLElement) => {
    const out: string[] = [];
    const vw = document.documentElement.clientWidth;
    const rr = root.getBoundingClientRect();
    if (rr.left < -1 || rr.right > vw + 1) out.push(`popup spans ${Math.round(rr.left)}..${Math.round(rr.right)} of a ${vw}px viewport`);
    const intentional = (el: Element) => /\boverflow-x-(auto|scroll)\b/.test(String(el.className));
    for (const el of [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))]) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || el.closest(".sr-only")) continue;
      // inside a deliberate sideways scroller (chip rows): that's by design
      let inXScroller = false, clipped = false;
      for (let a = el.parentElement; a && root.contains(a); a = a.parentElement) {
        if (intentional(a)) inXScroller = true;
        if (getComputedStyle(a).overflowX !== "visible") clipped = true;
        if (a === root) break;
      }
      if (inXScroller) continue;
      // Only containers the user could actually drag sideways count; clipped
      // (overflow hidden) art and `truncate` ellipses are by design.
      if ((el === root || /(auto|scroll)/.test(cs.overflowX)) && !intentional(el) && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) {
        out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 3).join(".")} scrollWidth ${el.scrollWidth} > ${el.clientWidth}`);
      }
      const r = el.getBoundingClientRect();
      if (!clipped && r.width > 0 && (r.right > vw + 1 || r.left < -1) && cs.position !== "fixed") {
        out.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 24)}" spills to ${Math.round(r.left)}..${Math.round(r.right)}`);
      }
    }
    return Array.from(new Set(out)).slice(0, 8);
  });
}

export async function settle(page: Page) {
  await page.waitForFunction(() => document.getAnimations().filter(a => a.playState === "running").length === 0);
}

export async function expectCleanPopup(page: Page, pop: Locator, label: string, opts: { x?: boolean } = {}) {
  await settle(page);
  expect(await overflowProblems(pop), `${label}: no sideways overflow`).toEqual([]);
  if (opts.x !== false) expect(await closeXProblems(pop), `${label}: close X is a clear 44px target`).toEqual([]);
}
