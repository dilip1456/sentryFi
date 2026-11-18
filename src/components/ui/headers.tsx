import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Shared header primitives (see docs/ui-style.md).
 *
 * One look for every page, section, card and overlay header, ported from the
 * My Financial Picture design (picture.css: .col-h, .sec-h, .h4, .ov-h):
 *   PageHeader    – Fraunces 22/26px title, 13px muted subtitle, actions right.
 *   SectionHeader – optional 36px icon tile, 16px/600 title, 12.5px subtitle,
 *                   one action slot (a "See all" link, a button, a menu).
 *   Eyebrow       – 11.5px/700 uppercase label for groups inside a card.
 *   OverlayHeader – dialog / sheet title bar: Fraunces title + close slot.
 *
 * Rule of thumb: a screen shows its name once. If the app chrome (mobile top
 * bar, desktop page header) already says "Spending", the first card on the
 * page must not say "Spending" again — give it a section title that says what
 * the card is about, or no header at all.
 */

type HeadingTag = "h1" | "h2" | "h3" | "h4";

export interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Buttons / menus shown on the right (wrap below the title on narrow screens). */
  actions?: React.ReactNode;
  /** Small label above the title (e.g. "Demo", a date). */
  eyebrow?: React.ReactNode;
  as?: HeadingTag;
}

export const PageHeader = React.forwardRef<HTMLElement, PageHeaderProps>(
  ({ title, subtitle, actions, eyebrow, as: Tag = "h1", className, ...props }, ref) => (
    <header ref={ref} data-ui="page-header"
      className={cn("flex flex-wrap items-end justify-between gap-x-4 gap-y-3", className)} {...props}>
      <div className="min-w-0 flex-1">
        {eyebrow && <div className="mb-1 text-[11.5px] font-bold uppercase tracking-[0.07em] text-muted-foreground">{eyebrow}</div>}
        <Tag className="font-display text-[22px] md:text-[26px] font-semibold leading-tight tracking-[-0.025em] text-foreground">{title}</Tag>
        {subtitle && <p className="mt-1 text-[13px] text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  ),
);
PageHeader.displayName = "PageHeader";

export interface SectionHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Lucide icon (or any node) shown in a 36px tinted tile. */
  icon?: React.ReactNode;
  action?: React.ReactNode;
  as?: HeadingTag;
  /** Tighter variant for headers inside a dense card (no icon tile, 14px title). */
  size?: "default" | "sm";
}

export const SectionHeader = React.forwardRef<HTMLDivElement, SectionHeaderProps>(
  ({ title, subtitle, icon, action, as: Tag = "h2", size = "default", className, ...props }, ref) => (
    <div ref={ref} data-ui="section-header" className={cn("flex items-center gap-3", size === "sm" ? "mb-2" : "mb-3", className)} {...props}>
      {icon && (
        <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-primary/10 text-primary [&_svg]:h-[18px] [&_svg]:w-[18px]">
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <Tag className={cn("font-semibold leading-tight text-foreground", size === "sm" ? "text-[14px]" : "text-[16px]")}>{title}</Tag>
        {subtitle && <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">{subtitle}</p>}
      </div>
      {action && <div className="ml-auto flex shrink-0 items-center gap-1">{action}</div>}
    </div>
  ),
);
SectionHeader.displayName = "SectionHeader";

/** "See all ›" style link/button for a SectionHeader action slot. 36px tall, 44px on phones. */
export const SectionAction = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, type = "button", ...props }, ref) => (
    <button ref={ref} type={type}
      className={cn("inline-flex min-h-11 md:min-h-9 items-center gap-1 whitespace-nowrap rounded-lg px-2.5 text-[13px] font-semibold text-foreground transition-colors hover:bg-surface-hover/70 disabled:opacity-50 [&_svg]:h-4 [&_svg]:w-4", className)}
      {...props} />
  ),
);
SectionAction.displayName = "SectionAction";

export const Eyebrow = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement> & { as?: HeadingTag | "div" }>(
  ({ className, as: Tag = "h3", ...props }, ref) => (
    <Tag ref={ref as React.Ref<HTMLHeadingElement>} data-ui="eyebrow"
      className={cn("text-[11.5px] font-bold uppercase tracking-[0.07em] text-muted-foreground", className)} {...props} />
  ),
);
Eyebrow.displayName = "Eyebrow";

export interface OverlayHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Leading slot (icon, avatar, Back button). */
  leading?: React.ReactNode;
  /** Trailing slot, normally the close button (44px). */
  trailing?: React.ReactNode;
  /** Render the title with this element, e.g. Radix DialogTitle via asChild. */
  titleAs?: React.ElementType;
  divider?: boolean;
}

/** Title bar for dialogs and sheets: one title, optional one-line description, close on the right. */
export const OverlayHeader = React.forwardRef<HTMLDivElement, OverlayHeaderProps>(
  ({ title, description, leading, trailing, titleAs: TitleTag = "h2", divider = true, className, ...props }, ref) => (
    <div ref={ref} data-ui="overlay-header"
      className={cn("flex items-center gap-3 py-3 pl-5 pr-2 md:pl-[22px]", divider && "border-b border-border", className)} {...props}>
      {leading}
      <div className="min-w-0 flex-1">
        <TitleTag className="truncate font-display text-[20px] md:text-[22px] font-semibold leading-tight tracking-[-0.02em] text-foreground">{title}</TitleTag>
        {description && <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">{description}</p>}
      </div>
      {trailing}
    </div>
  ),
);
OverlayHeader.displayName = "OverlayHeader";
