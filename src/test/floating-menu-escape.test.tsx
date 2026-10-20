/** Phone filter/sort sheets (and every other Spending popover) close on Escape. */
import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useFloatingMenu } from "@/components/finance/spending/useFloatingMenu";

function Harness() {
  const filters = useFloatingMenu(320);
  const sort = useFloatingMenu(192);
  return (
    <div>
      <button ref={filters.btnRef} onClick={filters.toggle}>Filter</button>
      <button ref={sort.btnRef} onClick={sort.toggle}>Sort</button>
      {filters.open && <div role="dialog" aria-label="Filters"><input aria-label="Min" /></div>}
      {sort.open && <div role="menu" aria-label="Sort by" />}
    </div>
  );
}

describe("useFloatingMenu: Escape", () => {
  it("closes the filter sheet and returns focus to its button", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Filter"));
    expect(screen.getByRole("dialog", { name: "Filters" })).toBeInTheDocument();
    // Escape while typing in a field inside the sheet
    act(() => { fireEvent.keyDown(screen.getByLabelText("Min"), { key: "Escape" }); });
    expect(screen.queryByRole("dialog", { name: "Filters" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByText("Filter"));
  });

  it("closes the sort sheet", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Sort"));
    expect(screen.getByRole("menu", { name: "Sort by" })).toBeInTheDocument();
    act(() => { fireEvent.keyDown(document, { key: "Escape" }); });
    expect(screen.queryByRole("menu", { name: "Sort by" })).toBeNull();
  });

  it("ignores other keys and does nothing when closed", () => {
    render(<Harness />);
    act(() => { fireEvent.keyDown(document, { key: "Escape" }); });
    fireEvent.click(screen.getByText("Filter"));
    act(() => { fireEvent.keyDown(document, { key: "Enter" }); });
    expect(screen.getByRole("dialog", { name: "Filters" })).toBeInTheDocument();
  });
});
