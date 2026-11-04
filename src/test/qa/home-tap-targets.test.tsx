/** Home: icon buttons / period chips opt into the 44px coarse-pointer tap target (docs/ui-style.md). */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { screen } from "@testing-library/react";
vi.mock("@/integrations/supabase/client", async () => (await import("./mocks")).inertSupabase());
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, profile: null, isAdmin: false }) }));
vi.mock("@/hooks/useCountUp", () => ({ useCountUp: (t: number) => t }));
import { renderDashboard } from "./render-harness";
import fs from "node:fs";

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
});

describe("Home tap targets", () => {
  it("defines .tap-44 as a 44px minimum on coarse pointers", () => {
    const css = fs.readFileSync("src/index.css", "utf8");
    expect(css).toMatch(/\.tap-44\s*\{\s*min-height:\s*44px[^}]*min-width:\s*44px/);
  });

  it("period chips and drag handles use tap-44", async () => {
    renderDashboard("overall");
    const oneMonth = await screen.findByRole("button", { name: "1M" });
    expect(oneMonth.className).toContain("tap-44");
    for (const b of screen.queryAllByRole("button", { name: /drag to reorder/i })) expect(b.className).toContain("tap-44");
  });
});
