/**
 * Regression for React #185 (Maximum update depth exceeded) on live Home.
 *
 * LivePlaidDashboard published Home action items into a module-level store
 * from an effect whose cleanup cleared the store, then re-published a newly
 * allocated list (visibleActions is a new array every render). Demo never
 * published, so /demo didn't crash. This harness mirrors that live path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import type { CompactItem } from "@/lib/notifications/compact";
import {
  getHomeActionItems,
  resetInboxExtrasForTests,
  setHomeActionItems,
  useInboxExtras,
  usePublishHomeActionItems,
} from "@/lib/notifications/extras-store";

const liveShaped = (at = "2026-11-16T12:00:00.000Z"): CompactItem[] => [
  {
    id: "action:low-checking", type: "low_balance", priority: "urgent",
    title: "Low checking balance", body: "Primary Checking is at $142. Consider a transfer.",
    amount: 142, at, account: "Primary Checking", source: "Home", status: "Needs review",
    stack: null, read: false, payload: { account_id: "acc_checking" },
  },
  {
    id: "action:budget-overage", type: "budget_threshold", priority: "urgent",
    title: "Budget exceeded: Dining", body: "$624 spent vs $500 budget, $124 over.",
    amount: -624, at, account: null, source: "Home", status: "Needs review",
    stack: null, read: false, payload: { category: "Dining", spent: 624, budget: 500 },
  },
  {
    id: "action:cc-due", type: "payment_due", priority: "soon",
    title: "Amex Gold due in 5 days", body: "Statement balance $1,388.",
    amount: -1388, at, account: "Amex Gold", source: "Home", status: "Pay now",
    stack: null, read: false, payload: { due_date: "2026-11-21" },
  },
  {
    id: "action:dup-starbucks", type: "insight", priority: "urgent",
    title: "Possible duplicate charge", body: "Starbucks billed $34.50 twice within two days.",
    amount: -34.5, at, account: "Amex Gold", source: "Home", status: "Needs review",
    stack: null, read: false, payload: {},
  },
  // Same title/type as the previous row — mergeUnique in the inbox would drop
  // one; the store must still treat the ids as distinct and not loop.
  {
    id: "action:dup-starbucks-2", type: "insight", priority: "urgent",
    title: "Possible duplicate charge", body: "Starbucks billed $34.50 twice within two days.",
    amount: -34.5, at, account: "Amex Gold", source: "Home", status: "Needs review",
    stack: null, read: true, payload: {},
  },
  {
    id: "action:large-bestbuy", type: "large_txn", priority: "soon",
    title: "Large purchase: Best Buy", body: "$320.00 posted on Sapphire Reserve.",
    amount: -320, at, account: "Sapphire Reserve", source: "Home", status: "Review",
    stack: null, read: false, payload: { transaction_id: "txn_bb_1" },
  },
];

/** Recreates the action list every render, as LivePlaidDashboard does. */
function LivePublisher({ dismissed = [] }: { dismissed?: string[] }) {
  const extras = useInboxExtras();
  const items = liveShaped(new Date().toISOString()).filter(i => !dismissed.includes(i.id) && !i.read);
  usePublishHomeActionItems(items, true);
  return (
    <div>
      <span data-testid="count">{extras.actions.length}</span>
      <ul>{extras.actions.map(a => <li key={a.id}>{a.title}</li>)}</ul>
    </div>
  );
}

/**
 * The pre-fix pattern: effect cleanup clears the store, then the effect
 * re-publishes a freshly allocated list. Kept here so we can show it throws.
 */
function LegacyLoopPublisher() {
  const extras = useInboxExtras();
  const items = liveShaped(new Date().toISOString());
  useEffect(() => {
    setHomeActionItems(items);
    return () => setHomeActionItems([]);
  }, [items]);
  return <span data-testid="legacy-count">{extras.actions.length}</span>;
}

beforeEach(() => { resetInboxExtrasForTests(); });
afterEach(() => { cleanup(); resetInboxExtrasForTests(); });

describe("home action-item store (React #185)", () => {
  it("the pre-fix cleanup-then-republish pattern exceeds the update depth", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => render(<LegacyLoopPublisher />)).toThrow(/Maximum update depth exceeded|Too many re-renders/i);
    } finally {
      err.mockRestore();
    }
  });

  it("publishing live-shaped actions every render does not loop, and skips dismissed/read rows", () => {
    expect(() => {
      render(<LivePublisher dismissed={["action:cc-due"]} />);
    }).not.toThrow();
    // seed has 6; one dismissed, one already read → 4 published
    expect(screen.getByTestId("count")).toHaveTextContent("4");
    expect(screen.getByText("Low checking balance")).toBeInTheDocument();
    expect(screen.getByText("Budget exceeded: Dining")).toBeInTheDocument();
    expect(screen.getByText("Possible duplicate charge")).toBeInTheDocument();
    expect(screen.getByText("Large purchase: Best Buy")).toBeInTheDocument();
    expect(screen.queryByText("Amex Gold due in 5 days")).not.toBeInTheDocument();
    expect(getHomeActionItems()).toHaveLength(4);
  });

  it("setHomeActionItems does not emit when the list is unchanged", () => {
    const items = liveShaped();
    setHomeActionItems(items);
    const first = getHomeActionItems();
    setHomeActionItems(items.map(i => ({ ...i, at: new Date().toISOString() })));
    expect(getHomeActionItems()).toBe(first);
  });
});
