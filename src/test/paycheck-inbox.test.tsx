/** Paycheck anomaly alerts show in the notification inbox (on-device, no alert_log write). */
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { NotificationInbox } from "@/components/finance/NotificationInbox";
import { setDerivedAlerts, derivedUnreadCount } from "@/lib/derived-alerts";
import { paycheckAlerts } from "@/lib/paycheck-anomaly";
import type { SupabaseClient } from "@supabase/supabase-js";

function fakeSupabase(rows: unknown[] = []) {
  const updates: string[] = [];
  const chain = (op: string): unknown => new Proxy(() => {}, {
    get: (_t, k) => k === "then" ? (res: (v: unknown) => unknown) => Promise.resolve({ data: op === "select" ? rows : null, error: null }).then(res)
      : (...a: unknown[]) => { if (k === "update") { updates.push(JSON.stringify(a[0])); return chain("update"); } return chain(op); },
  });
  return { client: { from: () => chain("select") } as unknown as SupabaseClient, updates };
}

const txns = ["2026-08-14", "2026-08-28", "2026-09-11", "2026-09-25", "2026-10-09"].map((d, i) => ({ id: `p${i}`, date: d, amount: -2500 }));
const alerts = () => paycheckAlerts(txns, () => ({ type: "income_salary" }), new Date(2026, 9, 22, 12));

afterEach(() => { cleanup(); localStorage.clear(); act(() => setDerivedAlerts([])); });

describe("NotificationInbox + paycheck anomaly", () => {
  it("lists the alert, opens its detail and marks it read locally", async () => {
    const { client, updates } = fakeSupabase();
    act(() => setDerivedAlerts(alerts()));
    expect(derivedUnreadCount("u1")).toBe(1);
    render(<NotificationInbox supabase={client} userId="u1" open onClose={() => {}} />);
    const row = await screen.findByText("Fewer paychecks than usual this month");
    fireEvent.click(row);
    await waitFor(() => expect(screen.getByText("Paychecks this month")).toBeTruthy());
    expect(screen.getByText("~2")).toBeTruthy();
    expect(derivedUnreadCount("u1")).toBe(0);
    expect(updates).toEqual([]); // nothing written to alert_log for a derived alert
  });

  it("Mark all read clears derived alerts too", async () => {
    const { client } = fakeSupabase([{ id: "db1", alert_type: "deposit", title: "Deposit", body: "x", payload: {}, read_at: null, created_at: "2026-10-01T00:00:00Z" }]);
    act(() => setDerivedAlerts(alerts()));
    render(<NotificationInbox supabase={client} userId="u2" open onClose={() => {}} />);
    await screen.findByText("Deposit");
    fireEvent.click(screen.getByText(/Mark all read/));
    await waitFor(() => expect(derivedUnreadCount("u2")).toBe(0));
  });
});
