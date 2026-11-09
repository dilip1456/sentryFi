/** Settings dialog: one visible title (the dialog's accessible name), 44px tabs that scroll
 *  instead of overflowing, labelled fields, gold save, closes on X / Escape. */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: null, profile: null, refresh: vi.fn(), signOut: vi.fn() }),
}));
vi.mock("@/components/NotificationPreferences", () => ({ NotificationPreferences: () => <div>prefs</div> }));

import { ProfileDialog } from "@/components/finance/ProfileDialog";

const renderDlg = (onOpenChange = vi.fn()) => {
  render(<MemoryRouter><ProfileDialog open onOpenChange={onOpenChange} initialTab="profile" /></MemoryRouter>);
  return onOpenChange;
};

describe("ProfileDialog (Settings) UI", () => {
  it("is named Settings once, via OverlayHeader", () => {
    renderDlg();
    const dlg = screen.getByRole("dialog", { name: "Settings" });
    expect(dlg.querySelector('[data-ui="overlay-header"]')).not.toBeNull();
    expect(screen.getAllByText("Settings", { selector: "h2, h1, div" })).toHaveLength(1);
  });

  it("tabs are 44px on phones, pressed state, and scroll sideways", () => {
    renderDlg();
    const tabs = screen.getByTestId("settings-tabs");
    expect(tabs.className).toContain("overflow-x-auto");
    const banks = screen.getByRole("button", { name: "Banks" });
    expect(banks.className).toContain("min-h-11");
    expect(screen.getByRole("button", { name: "Profile" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(banks);
    expect(banks).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Connected banks" })).toBeInTheDocument();
  });

  it("fields are labelled and 44px; save is the gold CTA", () => {
    renderDlg();
    for (const l of ["Display name", "Timezone", "Phone"]) expect(screen.getByLabelText(l).className).toContain("min-h-11");
    expect(screen.getByRole("button", { name: "Save changes" }).className).toContain("bg-gold");
  });

  it("closes from the 44px X and from Escape", () => {
    const onOpenChange = renderDlg();
    const x = screen.getByRole("button", { name: "Close" });
    expect(x.className).toContain("h-11");
    fireEvent.click(x);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledTimes(2);
  });
});
