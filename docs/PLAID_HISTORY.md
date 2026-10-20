# Plaid transaction history depth (730 days)

My Money's detectors (autopay, yearly bills, paychecks, set-aside funding) need
history: a yearly insurance premium is only seen twice in ~25 months, and the
recurring detector's default lookback is 25 months. Plaid's default is 90 days.

## What the code does

| Where | What |
| --- | --- |
| `supabase/functions/_shared/plaid-link.ts` | `newItemLinkProducts()` → `products: ["transactions"]`, `optional_products: ["investments", "liabilities"]`, `transactions: { days_requested: 730 }` |
| `plaid-create-link-token` (used by the app) | New Link sessions use `newItemLinkProducts()`. **Update mode** (`{ itemId }`, liabilities consent) does not: Plaid ignores `days_requested` for an Item whose Transactions product is already initialised. |
| `plaid-link-token` (legacy, not called by `src/`) | Same products, kept consistent. |
| `_shared/plaid-sync.ts` | `/transactions/sync` also sends `options.days_requested: 730`. This only matters for an Item that was linked **without** Transactions (it's initialised by the first sync call); for every other Item Plaid ignores it. Harmless. |

`days_requested` only takes effect when Transactions is **first initialised** for
an Item. For our Items that is at `/link/token/create` (because `transactions`
is in `products`). It can't be raised later: not with update mode, not with
`/transactions/sync`, not with `/transactions/refresh`.

The extra history arrives asynchronously. Plaid fires `HISTORICAL_UPDATE` when it's ready (typically
minutes, can be longer for 730 days). We have no webhook configured, so the next sync (the
"Sync" button / scheduled sync) picks it up through the cursor; nothing else is needed.

## Existing Items (linked before this change)

They keep whatever history they were linked with (90 days by default). The only
way to get 730 days for them is a **new Item**:

1. In SentryFi, remove the institution (Accounts → remove → `plaid-remove-item`,
   which calls Plaid `/item/remove` and deletes the item's accounts,
   transactions, credit details, loan details and statement history).
2. Link the same institution again (new Link session → 730 days).
3. Press Sync once; press again a few minutes later to pull the historical batch.

**Caveat: a re-link creates new `account_id`s and `transaction_id`s.** Anything
keyed by them is lost and has to be set again:

- Money Map account roles (`accountRoles`), card autopay source (`cardAutopayFrom`) and other
  per-account settings in `user_settings`;
- per-transaction overrides (`txn_overrides`), split / note edits;
- recurring streams' `account_id` / `pay_from_account_id` and confirmed findings that point at
  the old accounts (they'll be re-detected and asked again).

Because of that, re-linking is opt-in per institution. Do it once, early, before
confirming many findings. Alternative without a re-link: import older statements
(Import statement, `ImportStatementModal`) to backfill history for detection.

## Rollout

1. Deploy the edge functions (`plaid-create-link-token`, `plaid-link-token`,
   `plaid-sync-transactions`, `plaid-exchange-token`, `plaid-grant-consent`,
   `plaid-remove-item`). From then on every new Link requests 730 days.
2. Decide per existing institution whether to re-link (above).
