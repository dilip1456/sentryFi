/** Notification preferences: Eyebrow section headings, labelled sliders, house-style buttons. */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/contexts/AuthContext", () => { const auth = { user: { id: "u1", email: "a@b.c" } }; return { useAuth: () => auth }; });
vi.mock("@/integrations/supabase/client", () => {
  const chain = (): unknown => new Proxy(() => {}, {
    get: (_t, k) => k === "then" ? (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(res) : () => chain(),
  });
  return { supabase: { from: () => chain() } };
});

import { NotificationPreferences } from "@/components/NotificationPreferences";

describe("NotificationPreferences UI", () => {
  it("uses section headings, labelled sliders and gold/quiet buttons", async () => {
    render(<NotificationPreferences onClose={() => {}} />);
    expect(await screen.findByRole("heading", { name: "Channels" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Alert thresholds" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Budget alert at/)).toHaveAttribute("type", "range");
    expect(screen.getByLabelText(/Low balance alert below/)).toHaveAttribute("type", "range");
    expect(screen.getByLabelText(/Payment due warning/)).toHaveAttribute("type", "range");
    expect(screen.getByRole("button", { name: "Cancel" }).className).toContain("border-border-strong");
  });
});
