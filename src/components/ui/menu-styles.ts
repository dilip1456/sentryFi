import { cn } from "@/lib/utils";

/**
 * One menu / popover look, shared by Radix DropdownMenu, Radix Select content
 * and the hand-rolled portaled panels (useFloatingMenu, header menu, More menu)
 * so every dropdown has the same surface, radius, shadow and row height.
 * Rows are 44px on phones and 36px from md up.
 */
export const menuSurface =
  "rounded-xl border border-border bg-popover text-popover-foreground shadow-[var(--shadow-elevated)] p-1";

export const menuItem =
  "relative flex w-full cursor-default select-none items-center gap-2.5 rounded-lg px-2.5 min-h-11 md:min-h-9 text-left text-[14px] md:text-[13.5px] text-foreground outline-none transition-colors " +
  "hover:bg-surface-hover focus:bg-surface-hover focus-visible:bg-surface-hover data-[highlighted]:bg-surface-hover " +
  "data-[disabled]:pointer-events-none data-[disabled]:opacity-50 disabled:pointer-events-none disabled:opacity-50 " +
  "[&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0";

/** Selected / current row in a menu (sort order, active tab in More). */
export const menuItemActive = "text-primary font-semibold";

/** Destructive row (Sign out, Delete). */
export const menuItemDanger = "text-negative-text hover:text-negative-text focus:text-negative-text";

export const menuLabel = "px-2.5 pt-2 pb-1 text-[11.5px] font-bold uppercase tracking-[0.07em] text-muted-foreground";

export const menuSeparator = "-mx-1 my-1 h-px bg-border";

export const menuItemClass = (...extra: Array<string | false | null | undefined>) => cn(menuItem, ...extra);
