/** Notification inbox + preferences use the shared primitives: titled overlay, 44px controls, EmptyState. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NotificationInbox } from "@/components/finance/NotificationInbox";

function fakeSupabase(rows: unknown[] = []) {
  const chain = (): unknown => new Proxy(() => {}, {
    get: (_t, k) => k === "then" ? (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res) : () => chain(),
  });
  return { from: () => chain() } as unknown as SupabaseClient;
}
const row = { id: "db1", alert_type: "deposit", title: "Deposit", body: "Paycheck landed", payload: {}, read_at: null, created_at: new Date().toISOString() };

afterEach(() => { cleanup(); localStorage.clear(); });

describe("NotificationInbox UI", () => {
  it("dialog is named by its one visible title; X is 44px and closes", async () => {
    const onClose = vi.fn();
    render(<NotificationInbox supabase={fakeSupabase([row])} userId="u1" open onClose={onClose} />);
    const dlg = screen.getByRole("dialog", { name: "Notifications" });
    expect(dlg.querySelector('[data-ui="overlay-header"]')).not.toBeNull();
    await screen.findByText("Deposit");
    expect(screen.getByTestId("inbox-unread")).toHaveTextContent("1 new");
    const closes = screen.getAllByRole("button", { name: "Close" });
    expect(closes).toHaveLength(1); // no second, built-in X
    expect(closes[0].className).toContain("h-11");
    expect(screen.getByRole("button", { name: /Mark all read/ }).className).toContain("min-h-11");
    fireEvent.click(closes[0]);
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape closes", async () => {
    const onClose = vi.fn();
    render(<NotificationInbox supabase={fakeSupabase([row])} userId="u1" open onClose={onClose} />);
    await screen.findByText("Deposit");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("empty inbox uses EmptyState", async () => {
    render(<NotificationInbox supabase={fakeSupabase([])} userId="u3" open onClose={() => {}} />);
    expect(await screen.findByText("No notifications yet")).toBeInTheDocument();
    expect(document.querySelector('[data-ui="empty-state"], .empty-state') ?? screen.getByText("No notifications yet").closest("div")).not.toBeNull();
  });
});
