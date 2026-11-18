/**
 * Shapes the Accounts page and the shared net-worth maths work on. Structural,
 * so LivePlaidDashboard's PAccount / ManualAccount rows fit without casts.
 */

/** A linked (Plaid) account row from plaid_accounts. */
export interface LinkedAccount {
  id: string;
  account_id: string;
  name: string | null;
  official_name: string | null;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  current_balance: number | null;
  available_balance: number | null;
  /** Plaid balances.limit, once plaid_accounts.credit_limit exists (PR B). */
  credit_limit?: number | null;
  item_id?: string | null;
}

/** A manually tracked account (manual_accounts). */
export interface ManualAccountLike {
  id: string;
  name: string;
  institution_name: string | null;
  type: string;
  role: string;
  current_balance: number | null;
  property_value?: number | null;
  monthly_payment?: number | null;
  interest_rate?: number | null;
  updated_at?: string | null;
}

/**
 * Per-account settings in user_settings.account_meta (jsonb, so no migration).
 * Linked accounts are keyed by plaid_accounts.id, manual ones by `manual:<id>`.
 */
export interface AccountMetaEntry {
  nickname?: string;
  apr?: number;
  promoApr?: number;
  promoEndDate?: string;
  customUrl?: string;
  /** Hidden from the Accounts list, Home lists, alerts and Spending. */
  hidden?: boolean;
  /** Left out of net worth (only offered while hidden). */
  excludeFromNetWorth?: boolean;
  /** "Keep" on a dormant suggestion: don't ask again until this ISO date. */
  keepUntil?: string;
  /** One-tap confirm of a detected card autopay. */
  autopayConfirmed?: boolean;
  /** Findings the user dismissed for this account (kind → ISO date). */
  dismissed?: Record<string, string>;
}

/** Reserved account_meta key for page preferences (not an account). */
export const ACCOUNTS_PREFS_KEY = "__accounts";
export type AccountsGroupBy = "type" | "bank";
export interface AccountsPrefs {
  group?: AccountsGroupBy;
  /** "Remind me tomorrow" on the reconnect strip: item id → ISO time. */
  snooze?: Record<string, string>;
}

export type AccountMetaMap = Record<string, AccountMetaEntry | undefined>;

export const manualKey = (id: string) => `manual:${id}`;

/** Plaid item health, read from plaid_items when the columns exist. */
export interface ItemHealth {
  id: string;
  status?: string | null;
  error_code?: string | null;
  error_at?: string | null;
  last_synced_at?: string | null;
  updated_at?: string | null;
}

export interface InstitutionItem {
  id: string;
  item_id: string;
  institution_name: string | null;
  created_at?: string | null;
}

export interface CreditDetailLike {
  account_id: string;
  last_statement_balance: number | null;
  last_payment_amount: number | null;
  minimum_payment_amount: number | null;
  next_payment_due_date: string | null;
  is_overdue: boolean | null;
  last_payment_date: string | null;
  last_statement_issue_date?: string | null;
}

export interface LoanDetailLike {
  account_id: string;
  kind?: string | null;
  next_payment_due_date: string | null;
  next_monthly_payment: number | null;
  interest_rate?: number | null;
}
