/** Header (gear) menu: focus management, Escape (respecting defaultPrevented), X, backdrop. */
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { HeaderMenu } from "@/components/nav/HeaderMenu";
import { MobileMoreMenu } from "@/components/nav/MobileMoreMenu";

function Harness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(true)}>Gear</button>
      <HeaderMenu open={open} onClose={() => { onClose?.(); setOpen(false); }}>
        <button>Notifications</button>
        <button>Settings</button>
      </HeaderMenu>
    </div>
  );
}

const openMenu = () => { const g = screen.getByText("Gear"); g.focus(); fireEvent.click(g); };

describe("HeaderMenu", () => {
  it("is a labelled modal dialog and focuses the first row", () => {
    render(<Harness />);
    openMenu();
    const d = screen.getByRole("dialog", { name: "Menu" });
    expect(d).toHaveAttribute("aria-modal", "true");
    expect(document.activeElement).toBe(screen.getByText("Notifications"));
  });

  it("Escape closes and returns focus to the opener", () => {
    render(<Harness />);
    openMenu();
    act(() => { fireEvent.keyDown(screen.getByText("Notifications"), { key: "Escape" }); });
    expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByText("Gear"));
  });

  it("ignores an Escape an inner control already handled", () => {
    render(<Harness />);
    openMenu();
    const ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    ev.preventDefault();
    act(() => { window.dispatchEvent(ev); });
    expect(screen.getByRole("dialog", { name: "Menu" })).toBeInTheDocument();
  });

  it("X and backdrop close it", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    openMenu();
    fireEvent.click(screen.getByTestId("header-menu-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("keeps Tab inside the panel", () => {
    render(<Harness />);
    openMenu();
    screen.getByText("Settings").focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
  });
});

describe("MobileMoreMenu", () => {
  it("focuses the first row and leaves an already-handled Escape alone", () => {
    const onClose = vi.fn();
    render(<MobileMoreMenu open onClose={onClose}><button role="menuitem">Timeline</button></MobileMoreMenu>);
    expect(document.activeElement).toBe(screen.getByText("Timeline"));
    const ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    ev.preventDefault();
    act(() => { document.dispatchEvent(ev); });
    expect(onClose).not.toHaveBeenCalled();
    act(() => { fireEvent.keyDown(document, { key: "Escape" }); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
