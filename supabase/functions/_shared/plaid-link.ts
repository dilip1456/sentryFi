// Link token parameters shared by plaid-create-link-token (used by the app)
// and plaid-link-token (older endpoint, kept in sync).
//
// Transaction history depth. Plaid only honours `days_requested` when the
// Transactions product is *initialised*. Our Items are initialised at Link
// (`transactions` is in `products`), so the value must go in
// /link/token/create as `transactions.days_requested`. The same field on
// /transactions/sync is ignored for those Items. Once an Item has Transactions,
// its history depth can never be raised: existing Items need /item/remove and
// a fresh Link (update mode does NOT backfill). See docs/PLAID_HISTORY.md.

/** Maximum Plaid allows (24 months): enough to see a yearly bill twice. */
export const TRANSACTIONS_DAYS_REQUESTED = 730;

/** Products for a brand-new Item (not update mode). */
export function newItemLinkProducts() {
  return {
    products: ["transactions"],
    optional_products: ["investments", "liabilities"],
    transactions: { days_requested: TRANSACTIONS_DAYS_REQUESTED },
  };
}
