/** Gift Cards redesign: issuer groups, search, archive section and the checkout barcode. */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
vi.mock("@/integrations/supabase/client", async () => (await import("./qa/mocks")).inertSupabase());
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, profile: null, isAdmin: false }) }));
import { GiftCardsSection } from "@/components/finance/GiftCardsSection";

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
});

describe("GiftCardsSection (demo)", () => {
  it("groups demo cards by issuer with per-issuer totals", async () => {
    localStorage.clear();
    render(<GiftCardsSection demo />);
    const sb = await screen.findByRole("button", { name: /^Starbucks, 2 cards, \$24\.65/ });
    expect(sb).toHaveAttribute("aria-expanded", "true");
    expect(within(sb).getByTestId("gc-issuer-total")).toHaveTextContent("$24.65");
    expect(screen.getAllByTestId("gc-issuer").length).toBeGreaterThanOrEqual(6);
    fireEvent.click(sb);
    expect(sb).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /^Starbucks ending 5521/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "All cards" }));
    expect(screen.queryAllByTestId("gc-issuer")).toHaveLength(0);
    expect(screen.getByRole("button", { name: /^Starbucks ending 5521/ })).toBeInTheDocument();
  });

  it("searches, and keeps archived cards out of the list and total", async () => {
    localStorage.clear();
    render(<GiftCardsSection demo />);
    await screen.findAllByTestId("gc-issuer");
    // Lowe's is archived: not in the list, but in the archived section.
    expect(screen.queryByRole("button", { name: /^Lowe's ending/ })).toBeNull();
    expect(screen.getByTestId("gc-archived")).toHaveTextContent("Used & archived (1)");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search gift cards" }), { target: { value: "raffle" } });
    expect(screen.getAllByRole("button", { name: /at checkout$/ })).toHaveLength(1);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search gift cards" }), { target: { value: "nothing-here" } });
    expect(screen.getByTestId("gc-no-results")).toBeInTheDocument();
  });

  it("opens the checkout view with an SVG barcode labelled with the number", async () => {
    localStorage.clear();
    render(<GiftCardsSection demo />);
    fireEvent.click(await screen.findByRole("button", { name: "Show Best Buy ending 5130 at checkout" }));
    const dlg = await screen.findByTestId("gc-checkout");
    const code = within(dlg).getByRole("img", { name: /Code 128 barcode for Best Buy card number 6155 4321 0987 5130/ });
    await waitFor(() => expect(code.querySelector("svg")).not.toBeNull(), { timeout: 5000 });
    expect(within(dlg).getByTestId("gc-checkout-number")).toHaveTextContent("6155 4321 0987 5130");
    expect(within(dlg).queryByTestId("gc-checkout-pin")).toBeNull();
    fireEvent.click(within(dlg).getByRole("button", { name: "Tap to reveal PIN" }));
    expect(within(dlg).getByTestId("gc-checkout-pin")).toHaveTextContent("2841");
    fireEvent.click(within(dlg).getByRole("button", { name: "QR code" }));
    await waitFor(() => expect(within(dlg).getByTestId("gc-barcode")).toHaveAttribute("data-format", "qrcode"));
  });
});
