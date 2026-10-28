# SentryFi - Future Upgrades

All items from the prior batch have shipped (see below). This file now only tracks
new/remaining ideas.

## Open ideas
- Offers page: single-pane view of card-linked cashback offers (US Bank, Citi, BofA).
  No free public API exists; plan is manual entry + transaction matching now, with a
  licensed feed (Cardlytics/Fidel) as a possible future data source.

## Planned: multi-provider bank linking
Goal: stop depending on Plaid alone, without rewriting the app per provider.
Context: Plaid is referenced in ~94 files; classify/pfc.ts and plaid-categories.ts
assume Plaid's category taxonomy; dedup.ts assumes one source per account.

1. Provider abstraction layer. Define neutral Account / Transaction / Category types.
   Wrap the current plaid-* edge functions as a "Plaid adapter" that maps into them.
   Classifier, recurring detection, budgets and insights read only the neutral types.
2. Connection-failure logging per institution (Plaid item errors, relink rate).
   This data decides whether step 4 is worth paying for.
3. Surface statement import (ImportStatementModal / parse-statement-ai) as the
   fallback whenever a Plaid link fails. Zero contract cost.
4. Second aggregator as fallback only, routed per institution where Plaid fails.
   Candidates: MX, Finicity (sales contracts, likely minimums), Teller (self-serve,
   smaller coverage). Not a user-facing "pick your provider" option.
5. Cross-provider dedup: same account linked via two providers must not double count.

## Backlog (from competitor review, 2026-10-28; not committed)
Competitors: PocketGuard, Simplifi, Monarch, YNAB, Rocket Money, Copilot, Origin.
Differentiators to protect: Money Map (purpose per account), Smart Suggestions
(move $X from the matching savings account), Gift Card Tracker.

- Savings goals with target date, tied to Money Map accounts (Monarch, Simplifi).
- Subscription view: list recurring charges, flag price increases, link to cancel
  (Rocket Money). Builds on lib/recurring.
- Net worth over time (Monarch, Origin).
- Investment tracking: PocketGuard has none, cheap win against it.
- Partner / shared access with per-account privacy (Monarch, Origin).
- Ask-your-money assistant over transactions (Origin Sidekick, Cleo). Reuses
  ai-categorize / analyze-finances.
- Gift card security: encrypt card numbers and PINs at rest, or stop storing PINs.
- Unit economics: Plaid cost per user vs "free to use". Decide paid tier before scale.
- Open question: marketing leads with "True Available" but the Safe to spend hero
  was removed from My Financial Picture. Pick one story, since PocketGuard and
  Simplifi already own safe-to-spend.

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
