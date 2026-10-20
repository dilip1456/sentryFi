/**
 * Plaid /liabilities/get helpers shared by plaid-sync-transactions and
 * plaid-exchange-token. Imported via relative path ("../_shared/…"), like
 * ./plaid-sync.ts, which `supabase functions deploy` bundles with each
 * function. Pure TS, no Deno globals, so vitest can import it too.
 */

export interface PlaidMortgageLiability {
  account_id?: string;
  next_payment_due_date?: string | null;
  next_monthly_payment?: number | null;
  last_payment_amount?: number | null;
  last_payment_date?: string | null;
  interest_rate?: { percentage?: number | null } | null;
  origination_principal_amount?: number | null;
  escrow_balance?: number | null;
  ytd_interest_paid?: number | null;
  ytd_principal_paid?: number | null;
  past_due_amount?: number | null;
}

export interface PlaidStudentLiability {
  account_id?: string;
  next_payment_due_date?: string | null;
  minimum_payment_amount?: number | null;
  last_payment_amount?: number | null;
  last_payment_date?: string | null;
  interest_rate_percentage?: number | null;
  origination_principal_amount?: number | null;
  ytd_interest_paid?: number | null;
  ytd_principal_paid?: number | null;
  is_overdue?: boolean | null;
}

export interface PlaidLiabilities {
  mortgage?: PlaidMortgageLiability[] | null;
  student?: PlaidStudentLiability[] | null;
}

export interface UpsertClient {
  from(table: string): {
    upsert(rows: unknown[], opts: { onConflict: string }): PromiseLike<{ error: { message?: string; code?: string } | null }>;
  };
}

/** Rows for `plaid_loan_details` (migration 20261020130200_plaid_loan_details.sql). */
export function loanDetailRows(userId: string, liabilities: PlaidLiabilities | null | undefined, now = new Date().toISOString()) {
  const mortgages = (liabilities?.mortgage ?? []).map(m => ({
    user_id: userId,
    account_id: m.account_id,
    kind: 'mortgage',
    next_payment_due_date: m.next_payment_due_date ?? null,
    next_monthly_payment: m.next_monthly_payment ?? null,
    minimum_payment_amount: null,
    last_payment_amount: m.last_payment_amount ?? null,
    last_payment_date: m.last_payment_date ?? null,
    interest_rate: m.interest_rate?.percentage ?? null,
    origination_principal: m.origination_principal_amount ?? null,
    outstanding_principal: null,
    escrow_balance: m.escrow_balance ?? null,
    ytd_interest_paid: m.ytd_interest_paid ?? null,
    ytd_principal_paid: m.ytd_principal_paid ?? null,
    is_overdue: (m.past_due_amount ?? 0) > 0,
    updated_at: now,
  }));
  const students = (liabilities?.student ?? []).map(st => ({
    user_id: userId,
    account_id: st.account_id,
    kind: 'student',
    next_payment_due_date: st.next_payment_due_date ?? null,
    next_monthly_payment: st.minimum_payment_amount ?? null,
    minimum_payment_amount: st.minimum_payment_amount ?? null,
    last_payment_amount: st.last_payment_amount ?? null,
    last_payment_date: st.last_payment_date ?? null,
    interest_rate: st.interest_rate_percentage ?? null,
    origination_principal: st.origination_principal_amount ?? null,
    outstanding_principal: null,
    escrow_balance: null,
    ytd_interest_paid: st.ytd_interest_paid ?? null,
    ytd_principal_paid: st.ytd_principal_paid ?? null,
    is_overdue: st.is_overdue ?? false,
    updated_at: now,
  }));
  return [...mortgages, ...students].filter(r => r.account_id);
}

/**
 * Mortgage + student loans → plaid_loan_details. Never throws and never
 * breaks the caller's credit-card upsert. If the table is missing (migration
 * not applied), it logs a warning. Logs only the DB error code/message, never
 * row data.
 */
export async function upsertLoanDetails(admin: UpsertClient, userId: string, liabilities: PlaidLiabilities | null | undefined): Promise<number> {
  try {
    const rows = loanDetailRows(userId, liabilities);
    if (!rows.length) return 0;
    const { error } = await admin.from('plaid_loan_details').upsert(rows, { onConflict: 'user_id,account_id' });
    if (error) {
      console.warn('plaid_loan_details upsert failed (migration applied?):', error.code ?? '', error.message ?? '');
      return 0;
    }
    return rows.length;
  } catch (e) {
    console.warn('upsertLoanDetails failed:', e instanceof Error ? e.message : String(e));
    return 0;
  }
}

// Re-exported so existing imports keep working; the helper lives in plaid-errors.ts.
export { plaidErrorSummary } from './plaid-errors.ts';
