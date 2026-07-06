# SentryFi - Future Upgrades

Planned for a later deploy. Not yet started.

## Home / Overall page
- Remove the "Home" tab and make the landing view more appealing.
- Replace static cards with dynamic insights driven by visuals (charts, infographics), not just card text.
- Add a top button bar: sync, notifications, logout, and profile image.

## Accounts
- Redesign how accounts are displayed (current grid/bucket layout is not clear enough).

## AI suggestions
- Move "Refresh AI suggestions" into the Suggestions box only, as a simple refresh icon (match the Upcoming Charges refresh style). Remove it from the section header.

## Spending / transactions
- Transactions list should not be so wide: use space better.
- Show reasonably larger graphs and infographics.
- Add standard filters on all fields.
- Move the daily trend chart above the transactions data and make it act as a filter based on the selected granularity (month / day / year).

## Pie chart
- Hovering the pie must not show a popup.
- Make the pie hover interaction more appealing.

## Popups / dialogs
- Any change made in a popup must have Apply / Save / Cancel buttons.
- Provide an "apply to all" option where relevant.

## Notifications
- Fix the radios/toggles styling on notification settings.

## Done (shipped earlier this cycle)
- Data-leak fix, Bell -> notification inbox, notification settings moved under Profile.
- content-max widened to 1600px.
- OAuth redirect pinned to VITE_APP_URL; .env repointed to correct Supabase project.
- Simplified budget tracker (aligned budget vs actual, add-category flow).
- Redesigned rules manager (category + name rules, inline CRUD).
