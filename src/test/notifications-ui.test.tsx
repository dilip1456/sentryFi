/** Compact inbox: 400px panel, Unread/All, Mark all read, 44px close, Escape, EmptyState. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

beforeEach(() => { localStorage.setItem("sentryfi_apk_banner_dismissed", "1"); });
afterEach(() => { cleanup(); localStorage.clear(); });

describe("NotificationInbox UI", () => {
  it("dialog is named Notifications; Close is 44px and closes; Unread/All and Mark all read are present", async () => {
    const onClose = vi.fn();
    render(<NotificationInbox supabase={fakeSupabase([row])} userId="u1" open onClose={onClose} />);
    const dlg = await screen.findByRole("dialog", { name: "Notifications" });
    expect(dlg).toBeTruthy();
    await screen.findByText("Deposit");
    expect(screen.getByRole("button", { name: "Unread" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
    const mark = screen.getByRole("button", { name: /Mark all read/ });
    expect(mark.className).toMatch(/min-h-11|tap-44/);
    const close = screen.getByRole("button", { name: "Close" });
    expect(close.className).toMatch(/h-11|tap-44/);
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape closes", async () => {
    const onClose = vi.fn();
    render(<NotificationInbox supabase={fakeSupabase([row])} userId="u1" open onClose={onClose} />);
    await screen.findByText("Deposit");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("empty inbox uses EmptyState", async () => {
    render(<NotificationInbox supabase={fakeSupabase([])} userId="u3" open onClose={() => {}} />);
    expect(await screen.findByText("No unread notifications")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(await screen.findByText("No notifications yet")).toBeInTheDocument();
  });
});
