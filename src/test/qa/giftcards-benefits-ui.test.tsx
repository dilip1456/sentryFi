/** Gift Cards / Benefits: the screen name is not repeated under the top bar / page header (docs/ui-style.md). */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
vi.mock("@/integrations/supabase/client", async () => (await import("./mocks")).inertSupabase());
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, profile: null, isAdmin: false }) }));
vi.mock("@/hooks/useCountUp", () => ({ useCountUp: (t: number) => t }));
import { renderDashboard } from "./render-harness";
import { GiftCardsSection } from "@/components/finance/GiftCardsSection";

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
});

describe("Gift Cards", () => {
  it("names the list instead of repeating 'Gift cards'", async () => {
    render(<GiftCardsSection demo />);
    expect(await screen.findByRole("heading", { name: "Your cards" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: /^gift cards$/i })).toBeNull();
  });
});

describe("Benefits", () => {
  it("names the content instead of repeating 'Card Benefits'; tabs expose pressed state", async () => {
    renderDashboard("benefits");
    expect(await screen.findByRole("heading", { name: "Your card perks" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: /^card benefits$/i })).toBeNull();
    const pressed = screen.getAllByRole("button").filter(b => b.getAttribute("aria-pressed") === "true");
    expect(pressed.length).toBeGreaterThan(0);
  });
});
