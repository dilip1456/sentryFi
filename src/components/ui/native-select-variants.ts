import { cva } from "class-variance-authority";

/**
 * The one select look (docs/ui-style.md › Selects & menus).
 *
 * A styled native <select>: on phones and in the Android WebView it opens the
 * platform picker (best for long option lists, always on screen, no portal or
 * z-index fights inside dialogs/sheets), and it gets keyboard, Escape and
 * screen-reader support for free. Same chevron, radius and height everywhere,
 * ported from the Financial Picture's `.cov-sel`.
 *
 * Heights: 44px on phones (tap target) / 40px (default) or 36px (sm) from md up.
 */
export const nativeSelectVariants = cva(
  "peer w-full min-w-0 appearance-none truncate border bg-secondary text-foreground font-medium transition-colors " +
    "hover:border-primary/40 focus:outline-none focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/25 " +
    "disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-negative/60 aria-[invalid=true]:text-negative-text",
  {
    variants: {
      size: {
        default: "h-11 md:h-10 text-[14px] md:text-[13.5px]",
        sm: "h-11 md:h-9 text-[14px] md:text-[12.5px]",
      },
      shape: {
        field: "rounded-[10px] border-border-strong pl-3 pr-9",
        pill: "rounded-full border-border-strong pl-3.5 pr-9",
      },
    },
    defaultVariants: { size: "default", shape: "field" },
  },
);
