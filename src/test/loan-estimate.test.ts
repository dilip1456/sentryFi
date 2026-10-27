import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { estimateRemainingBalance } from "@/hooks/useManualAccounts";

afterEach(() => { vi.useRealTimers(); });

describe("estimateRemainingBalance", () => {
  it("amortizes 0% APR loans linearly", () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-20T12:00:00-04:00"));
    const r = estimateRemainingBalance(12000, 0, 1, "2026-04-01")!;
    expect(r).not.toBeNull();
    expect(r.balance).toBe(6000);
    expect(r.monthsRemaining).toBe(6);
  });
  it("is exactly 0 once the term is over", () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-20T12:00:00-04:00"));
    expect(estimateRemainingBalance(10000, 5, 1, "2020-01-01")!.balance).toBe(0);
    expect(estimateRemainingBalance(10000, 0, 1, "2020-01-01")!.balance).toBe(0);
  });
});
