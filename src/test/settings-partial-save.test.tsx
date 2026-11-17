/**
 * user_settings writes carry only the columns that changed (Tester, #61
 * follow-up): a dismiss on one device must not write back this tab's stale
 * financial_picture / budgets over an edit made meanwhile on another device.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const upserts: Record<string, unknown>[] = [];
const row = { user_id: "u1", budgets: { Food: 400 }, financial_picture: { overrides: { "income.salary": 6200 }, fundingAccounts: {} }, dismissed_insights: [] };
vi.mock("@/integrations/supabase/client", () => {
  const chain = {
    select: () => chain, eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
    upsert: (r: Record<string, unknown>) => { upserts.push(r); return Promise.resolve({ error: null }); },
    update: () => chain, insert: () => Promise.resolve({ error: null }),
  };
  return { supabase: { from: () => chain } };
});

import { changedColumns, dbToSettings, settingsToDb, useUserSettings } from "@/hooks/useUserSettings";

afterEach(() => { upserts.length = 0; vi.useRealTimers(); });

describe("changedColumns", () => {
  it("maps every persisted setting to its column, and only the asked ones", () => {
    const s = dbToSettings(row);
    const all = Object.keys(settingsToDb(s)).sort();
    const keys = Object.keys(s) as (keyof typeof s)[];
    expect(Object.keys(changedColumns(s, keys)).sort()).toEqual(all);
    expect(changedColumns(s, ["dismissedInsights"])).toEqual({ dismissed_insights: [] });
  });
});

describe("useUserSettings save", () => {
  it("a dismiss writes dismissed_insights only; a Picture edit writes financial_picture only", async () => {
    const { result } = renderHook(() => useUserSettings("u1"));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => { result.current.update({ dismissedInsights: ["rec:review:3"] }); });
    await waitFor(() => expect(upserts).toHaveLength(1), { timeout: 3000 });
    expect(upserts[0]).toEqual({ user_id: "u1", dismissed_insights: ["rec:review:3"] });

    act(() => { result.current.update({ financialPicture: { overrides: { "income.salary": 7000 }, fundingAccounts: {} } }); });
    await waitFor(() => expect(upserts).toHaveLength(2), { timeout: 3000 });
    expect(Object.keys(upserts[1]).sort()).toEqual(["financial_picture", "user_id"]);
  });
  it("changes batched into one save carry just those columns", async () => {
    const { result } = renderHook(() => useUserSettings("u1"));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => {
      result.current.update({ dismissedInsights: ["a"] });
      result.current.update({ budgets: { Food: 450 } });
    });
    await waitFor(() => expect(upserts).toHaveLength(1), { timeout: 3000 });
    expect(Object.keys(upserts[0]).sort()).toEqual(["budgets", "dismissed_insights", "user_id"]);
  });
});
