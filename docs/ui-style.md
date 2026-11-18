# SentryFi UI style guide

Short, practical rules so every screen looks like it was made by one person.
The reference is **My Financial Picture** (`src/components/finance/picture/picture.css`,
designer files in `review/financial-picture/`): it is the newest and most polished
screen. Tokens live in `src/index.css` (`--primary`, `--border-strong`, `--shadow-*`, …)
and `tailwind.config.ts`.

Shared primitives live in `src/components/ui/`:

| Need | Use | File |
| --- | --- | --- |
| Page title | `PageHeader` | `headers.tsx` |
| Card / section title | `SectionHeader` (+ `SectionAction`) | `headers.tsx` |
| Group label inside a card | `Eyebrow` | `headers.tsx` |
| Dialog / sheet title bar | `OverlayHeader` | `headers.tsx` |
| Any dropdown choice (category, account, type, frequency…) | `NativeSelect` | `native-select.tsx` |
| Action menu (⋯, Add, profile) | Radix `DropdownMenu` (already styled) | `dropdown-menu.tsx` |
| Hand-rolled popover / portaled panel | `menuSurface`, `menuItem`, `menuLabel`, `menuSeparator` | `menu-styles.ts` |
| Filter pill / toggle | `ChipButton` | `chip-button.tsx` |
| 2–4 way switch (Month / Year) | `SegmentedControl` | `chip-button.tsx` |
| Nothing to show | `EmptyState` | `empty-state.tsx` |
| Loading placeholder | `Skeleton` | `skeleton.tsx` |
| Buttons | `Button` with `variant="gold" \| "quiet" \| "danger"`, `size="touch" \| "compact" \| "icon-touch"` | `button.tsx` |

## Headers

* **A screen says its name once.** The phone top bar already shows the tab name
  ("Spending", "Money Map"); the desktop page header shows it on Home-style pages.
  The first card must not repeat it — name the card for what it holds
  ("Where it went", "Accounts"), or drop the card title.
* Don't stack two headers that say the same thing (page header + section header,
  dialog title + first heading in the body). Keep the clearer one and move any
  controls it had (buttons, menus, filters) onto the one you keep.
* Sizes (all `font-semibold`):

  | Level | Font | Size |
  | --- | --- | --- |
  | Page title (`PageHeader`) | Fraunces | 22px phone / 26px desktop |
  | Overlay title (`OverlayHeader`) | Fraunces | 20px phone / 22px desktop |
  | Section / card title (`SectionHeader`) | Inter | 16px (14px `size="sm"`) |
  | Eyebrow (`Eyebrow`) | Inter 700, uppercase, `tracking-[0.07em]` | 11.5px, muted |
  | Subtitle / helper text | Inter | 12.5–13px, muted |

* Gold (`text-primary`) is for money that matters and active state — not for
  headings. Section titles are `text-foreground`.
* Use real heading levels: one `h1` per page, `h2` for sections, `h3` inside cards.

## Selects & menus

* **Choosing a value → `NativeSelect`.** It is a styled native `<select>`, so on
  phones / the Android app it opens the system picker, it works inside dialogs and
  sheets without z-index or portal problems, and keyboard + Escape just work.
  One look: `bg-secondary`, `border-border-strong`, 10px radius (or `shape="pill"`
  for inline filters), Lucide chevron, 44px tall on phones, 40px (`sm`: 36px) on desktop.
  Always give it a label (`<label htmlFor>` or `aria-label`).
* **Doing an action → menu.** Prefer Radix `DropdownMenu` (focus, arrow keys,
  Escape, typeahead for free). Existing hand-rolled panels must use the
  `menu-styles.ts` classes so they look identical, close on Escape and backdrop tap,
  and return focus to the trigger.
* Menu rows: 44px on phones, 36px from `md` up, 14/13.5px text, 16px icons,
  hover/focus = `bg-surface-hover`. Destructive rows use `menuItemDanger`.

## Buttons, chips, inputs

* Primary CTA: `variant="gold"` (one per view). Secondary: `variant="quiet"`
  (outlined, `border-border-strong`). Destructive: `variant="danger"`.
* Radius 10px for buttons/inputs/selects, `rounded-full` for chips and icon buttons,
  `--radius` (12px) for cards, `rounded-xl` for menus.
* **Tap targets are 44px on phones** (`size="touch"`, `compact`, `icon-touch`;
  `ChipButton`; `NativeSelect`). Desktop may be denser (36–40px).
* Icon-only buttons need `aria-label`.

## Cards, spacing, states

* Card: `surface-card` (12px radius, 1px `--border`, `--shadow-sm`) with
  `p-4 md:p-5`; gap between cards `space-y-4 md:space-y-5`.
* Empty: `EmptyState` (icon tile, one-line title, one sentence, optional action).
* Loading: `Skeleton` blocks shaped like the content; never a lone spinner on a
  full page. Respect `prefers-reduced-motion` (handled by `.skeleton`).
* Numbers: `tabular` / `tabular-nums`; negative money uses `text-negative-text`
  on tinted backgrounds for contrast.

## Checklist for a new screen

1. One page title; no card repeats it.
2. Every dropdown is a `NativeSelect` or a styled `DropdownMenu`.
3. Every control is ≥ 44px tall on a 360px-wide phone and has an accessible name.
4. No horizontal scroll at 360 / 390 / 430; long names truncate with an ellipsis.
5. Empty and loading states use `EmptyState` / `Skeleton`.
6. Escape and the Android Back button close the top-most overlay only.
