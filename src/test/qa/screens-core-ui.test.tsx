/**
 * UI consistency checks for Home / Money Map / Spending (docs/ui-style.md),
 * rendered from the real dashboard in demo mode.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { screen } from "@testing-library/react";
vi.mock("@/integrations/supabase/client", async () => (await import("./mocks")).inertSupabase());
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, profile: null, isAdmin: false }) }));
vi.mock("@/hooks/useCountUp", () => ({ useCountUp: (t: number) => t }));
import { renderDashboard } from "./render-harness";

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
});

describe("Money Map", () => {
  it("does not repeat the screen name the page header / top bar already shows", async () => {
    renderDashboard("moneymap");
    await screen.findByText(/in hand right now/i);
    expect(screen.queryByRole("heading", { name: /^money map$/i })).toBeNull();
  });

  it("every dropdown is the shared NativeSelect and has an accessible name", async () => {
    const { container } = renderDashboard("moneymap");
    await screen.findByText(/in hand right now/i);
    const selects = Array.from(container.querySelectorAll("select"));
    // origin/main no longer renders the "Cover from…" select in demo data; still guard any that render.
    for (const s of selects) {
      expect(s.closest('[data-ui="select"]'), s.outerHTML.slice(0, 120)).not.toBeNull();
      expect(s.getAttribute("aria-label") || s.id, s.outerHTML.slice(0, 120)).toBeTruthy();
    }
  });
});

describe("Home", () => {
  it("section and card titles use one neutral style (not gold, not mixed sizes)", async () => {
    renderDashboard("overall");
    for (const name of [/^action items$/i, /^saving opportunities$/i, /^upcoming charges$/i]) {
      const h = await screen.findByRole("heading", { name });
      expect(h.className).toContain("text-foreground");
      expect(h.className).not.toContain("text-primary");
      expect(h.className).toContain("text-[14px]");
    }
    const group = screen.getByRole("heading", { name: /insights into your spending/i });
    expect(group.className).toContain("font-display");
    expect(group.className).not.toContain("text-primary");
  });
});
