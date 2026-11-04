/** Shared UI primitives (docs/ui-style.md): headers, NativeSelect, menus, chips, empty state. */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Settings } from "lucide-react";
import { Eyebrow, OverlayHeader, PageHeader, SectionAction, SectionHeader } from "@/components/ui/headers";
import { NativeSelect } from "@/components/ui/native-select";
import { nativeSelectVariants } from "@/components/ui/native-select-variants";
import { menuItem, menuItemClass, menuSurface } from "@/components/ui/menu-styles";
import { EmptyState } from "@/components/ui/empty-state";
import { ChipButton, SegmentedControl } from "@/components/ui/chip-button";
import { Skeleton } from "@/components/ui/skeleton";
import { buttonVariants } from "@/components/ui/button";

describe("PageHeader / SectionHeader / Eyebrow / OverlayHeader", () => {
  it("renders one h1 page title with subtitle and actions", () => {
    render(<PageHeader title="Spending" subtitle="October 2026" actions={<button>Export</button>} />);
    const h = screen.getByRole("heading", { level: 1, name: "Spending" });
    expect(h.className).toMatch(/font-display/);
    expect(screen.getByText("October 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
  });

  it("section header: h2 by default, icon tile is decorative, action slot rendered", () => {
    const { container } = render(<SectionHeader title="Top merchants" subtitle="This month" icon={<Settings />} action={<SectionAction>See all</SectionAction>} />);
    expect(screen.getByRole("heading", { level: 2, name: "Top merchants" })).toBeInTheDocument();
    expect(container.querySelector("[aria-hidden=true] svg")).not.toBeNull();
    const act = screen.getByRole("button", { name: "See all" });
    expect(act).toHaveAttribute("type", "button");
    expect(act.className).toMatch(/min-h-11/); // 44px tap target on phones
  });

  it("section header honours `as` and the compact size", () => {
    render(<SectionHeader as="h3" size="sm" title="Rules" />);
    const h = screen.getByRole("heading", { level: 3, name: "Rules" });
    expect(h.className).toMatch(/text-\[14px\]/);
  });

  it("eyebrow is an uppercase h3 by default and can be a div", () => {
    const { rerender } = render(<Eyebrow>Accounts</Eyebrow>);
    expect(screen.getByRole("heading", { level: 3, name: "Accounts" }).className).toMatch(/uppercase/);
    rerender(<Eyebrow as="div">Accounts</Eyebrow>);
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("overlay header renders title, description and trailing close", () => {
    const onClose = vi.fn();
    render(<OverlayHeader title="Transaction details" description="Oct 27" trailing={<button aria-label="Close" onClick={onClose} />} />);
    expect(screen.getByRole("heading", { level: 2, name: "Transaction details" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("NativeSelect", () => {
  it("is a real <select>: label, value and onChange work", () => {
    const onChange = vi.fn();
    render(
      <NativeSelect aria-label="Category" value="b" onChange={onChange}>
        <option value="a">A</option><option value="b">B</option>
      </NativeSelect>,
    );
    const sel = screen.getByRole("combobox", { name: "Category" }) as HTMLSelectElement;
    expect(sel.tagName).toBe("SELECT");
    expect(sel.value).toBe("b");
    fireEvent.change(sel, { target: { value: "a" } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("uses the shared look: 44px on phones, custom chevron, no native arrow", () => {
    const { container } = render(<NativeSelect aria-label="x"><option>1</option></NativeSelect>);
    const sel = container.querySelector("select")!;
    expect(sel.className).toMatch(/\bh-11\b/);
    expect(sel.className).toMatch(/md:h-10/);
    expect(sel.className).toMatch(/appearance-none/);
    expect(container.querySelector("svg[aria-hidden=true]")).not.toBeNull();
  });

  it("sm and pill variants keep the 44px phone height", () => {
    const cls = nativeSelectVariants({ size: "sm", shape: "pill" });
    expect(cls).toMatch(/\bh-11\b/);
    expect(cls).toMatch(/md:h-9/);
    expect(cls).toMatch(/rounded-full/);
  });

  it("invalid sets aria-invalid; wrapperClassName goes on the wrapper", () => {
    const { container } = render(<NativeSelect aria-label="x" invalid wrapperClassName="flex-1"><option>1</option></NativeSelect>);
    expect(container.querySelector("select")).toHaveAttribute("aria-invalid", "true");
    expect((container.firstChild as HTMLElement).className).toMatch(/flex-1/);
  });

  it("forwards refs", () => {
    const ref = { current: null as HTMLSelectElement | null };
    render(<NativeSelect ref={ref} aria-label="x"><option>1</option></NativeSelect>);
    expect(ref.current?.tagName).toBe("SELECT");
  });
});

describe("menu styles", () => {
  it("menu rows are 44px on phones, 36px from md up", () => {
    expect(menuItem).toMatch(/min-h-11/);
    expect(menuItem).toMatch(/md:min-h-9/);
    expect(menuSurface).toMatch(/rounded-xl/);
    expect(menuItemClass("text-primary")).toMatch(/text-primary/);
  });
});

describe("ChipButton / SegmentedControl", () => {
  it("chip exposes aria-pressed", () => {
    render(<ChipButton pressed>Expenses</ChipButton>);
    expect(screen.getByRole("button", { name: "Expenses" })).toHaveAttribute("aria-pressed", "true");
  });

  it("segmented control switches value", () => {
    const onChange = vi.fn();
    render(<SegmentedControl aria-label="Period" value="m" onChange={onChange} options={[{ value: "m", label: "Month" }, { value: "y", label: "Year" }]} />);
    expect(screen.getByRole("group", { name: "Period" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Month" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Year" }));
    expect(onChange).toHaveBeenCalledWith("y");
  });
});

describe("EmptyState / Skeleton / Button variants", () => {
  it("empty state is a status region with title, copy and action", () => {
    render(<EmptyState title="No transactions" description="Try another month" action={<button>Clear filters</button>} />);
    const s = screen.getByRole("status");
    expect(s).toHaveTextContent("No transactions");
    expect(s).toHaveTextContent("Try another month");
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });

  it("skeleton is decorative and uses the shared shimmer", () => {
    const { container } = render(<Skeleton className="h-4 w-20" />);
    const el = container.firstChild as HTMLElement;
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el.className).toMatch(/\bskeleton\b/);
  });

  it("house button variants exist and default stays unchanged", () => {
    expect(buttonVariants({ variant: "gold", size: "touch" })).toMatch(/bg-gold/);
    expect(buttonVariants({ variant: "quiet", size: "compact" })).toMatch(/min-h-11/);
    expect(buttonVariants()).toMatch(/bg-primary/);
    expect(buttonVariants()).toMatch(/h-10/);
  });
});
