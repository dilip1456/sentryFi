import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { cursorAfter, eventFromRow } from "@/lib/timeline";
import { isValidTimeZone } from "@/lib/timezone";
import { MobileMoreMenu } from "@/components/nav/MobileMoreMenu";

const calls: { table: string; op: string; args: unknown[] }[] = [];
let selectError: { message: string } | null = null;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: (...a: unknown[]) => {
        calls.push({ table, op: "select", args: a });
        return {
          eq: (...e: unknown[]) => {
            calls.push({ table, op: "eq", args: e });
            return {
              order: (...o: unknown[]) => {
                calls.push({ table, op: "order", args: o });
                return { range: async () => ({ data: selectError ? null : [], error: selectError }) };
              },
            };
          },
        };
      },
      upsert: async (rows: unknown[]) => { calls.push({ table, op: "upsert", args: [rows] }); return { data: null, error: null }; },
    }),
  },
}));
import { usePersistTxnClassifications } from "@/hooks/usePersistTxnClassifications";
import type { Classification } from "@/lib/classify";

describe("lossless keyset cursor", () => {
  const row = { id: "inf:1", source: "inference", source_id: "1", occurred_on: "2026-10-20", occurred_at: "2026-10-20T15:00:00.654321+00:00", category: "alerts", title: "x", status: "open" };
  it("keeps the server's microsecond timestamp for the cursor", () => {
    const e = eventFromRow(row);
    expect(e.occurred_at).toBe("2026-10-20T15:00:00.654Z"); // display/sort value (ms)
    expect(cursorAfter(e).at).toBe("2026-10-20T15:00:00.654321+00:00"); // what goes back to timeline_page
  });
  it("falls back to occurred_at for in-memory (demo) events", () => {
    expect(cursorAfter({ occurred_on: "2026-10-20", occurred_at: "2026-10-20T12:00:00.000Z", id: "txn:a" }).at).toBe("2026-10-20T12:00:00.000Z");
  });
});

describe("isValidTimeZone", () => {
  it("accepts IANA names, UTC and engine-canonicalised aliases", () => {
    for (const z of ["America/New_York", "Europe/Paris", "Asia/Kolkata", "UTC", "Etc/UTC", "Asia/Calcutta", "US/Eastern", " America/Chicago "]) expect(isValidTimeZone(z), z).toBe(true);
  });
  it("rejects free text Postgres can't use", () => {
    for (const z of ["Eastern Time", "EST5EDT nonsense", "New York", "", "   ", null, undefined, "America/Nowhere"]) expect(isValidTimeZone(z as string), String(z)).toBe(false);
  });
});

describe("MobileMoreMenu", () => {
  const setup = () => {
    const onClose = vi.fn();
    const utils = render(<div className="backdrop-blur"><MobileMoreMenu open onClose={onClose}><button>Item</button></MobileMoreMenu></div>);
    return { onClose, ...utils };
  };
  // first: later tests' unmounts schedule history.go(), whose pops are swallowed
  it("closes on Back (popstate)", () => {
    const { onClose } = setup();
    act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("renders on <body> (outside the blurred nav) with an X", () => {
    const { container } = setup();
    expect(container.querySelector("[data-testid=more-menu]")).toBeNull();
    expect(document.body.querySelector(":scope > [data-testid=more-menu]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });
  it("closes on backdrop, X and Escape", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByTestId("more-backdrop"));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

describe("usePersistTxnClassifications", () => {
  beforeEach(() => { vi.useFakeTimers(); calls.length = 0; selectError = null; vi.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  const txns = [{ id: "t1", transaction_id: "t1" }];
  const classes = new Map<string, Classification>([["t1", { type: "spend" } as Classification]]);

  it("pages stored rows in a stable order", async () => {
    renderHook(() => usePersistTxnClassifications("u1", txns, classes));
    await act(async () => { await vi.advanceTimersByTimeAsync(2600); });
    expect(calls.find(c => c.op === "order")?.args).toEqual(["transaction_id", { ascending: true }]);
  });
  it("re-enables for a new user after a failure for the previous one", async () => {
    selectError = { message: "relation does not exist" };
    const { rerender } = renderHook(({ u }) => usePersistTxnClassifications(u, txns, classes), { initialProps: { u: "u1" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(2600); });
    expect(calls.filter(c => c.op === "select")).toHaveLength(1);
    // same user: stays disabled
    rerender({ u: "u1" });
    await act(async () => { await vi.advanceTimersByTimeAsync(2600); });
    expect(calls.filter(c => c.op === "select")).toHaveLength(1);
    selectError = null;
    rerender({ u: "u2" });
    await act(async () => { await vi.advanceTimersByTimeAsync(2600); });
    const eqs = calls.filter(c => c.op === "eq").map(c => c.args[1]);
    expect(eqs).toEqual(["u1", "u2"]);
  });
});
