# SentryFi - Future Upgrades

All items from the prior batch have shipped (see below). This file now only tracks
new/remaining ideas.

## Open ideas
- Offers page: single-pane view of card-linked cashback offers (US Bank, Citi, BofA).
  No free public API exists; plan is manual entry + transaction matching now, with a
  licensed feed (Cardlytics/Fidel) as a possible future data source.

## Done (this cycle)
- Home / Overall: removed the "Home" tab (logo is now Home), welcome header, top button
  bar with sync / notifications / logout / profile image; account-composition
  infographic bar and buckets open by default.
- AI suggestions: "Refresh AI" moved into the Saving-opportunities box as a simple
  refresh icon; removed from the section header.
- Spending: daily/monthly trend moved full-width above the transactions and enlarged;
  it doubles as a date filter (tap a bar). Two-column layout rebalanced so the
  transactions column no longer stretches full width. Standard filters (amount /
  category / merchant / account) available via the filter builder.
- Pie chart: removed the hover popup; hover now highlights the active slice and the
  center label reflects the hovered category, value, and share.
- Popups: notification settings, rules, budget, and profile dialogs have explicit
  Apply/Save + Cancel; transaction category/name changes offer "apply to all".
- Notifications: rebuilt toggles as a single consistent Switch component with an
  Apply/Cancel footer.

## Done (earlier this cycle)
- Data-leak fix, Bell -> notification inbox, notification settings moved under Profile.
- content-max widened to 1600px.
- OAuth redirect pinned to VITE_APP_URL; .env repointed to correct Supabase project.
- Simplified budget tracker (aligned budget vs actual, add-category flow).
- Redesigned rules manager (category + name rules, inline CRUD).
