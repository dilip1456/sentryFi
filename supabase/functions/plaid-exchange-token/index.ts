import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { syncItemTransactions } from '../_shared/plaid-sync.ts';

const PLAID_ENV = Deno.env.get('PLAID_ENV') || 'sandbox';
const PLAID_BASE = `https://${PLAID_ENV}.plaid.com`;

// Category mapping (detailed personal_finance_category) and the cursor-safe
// sync loop live in ../_shared so both Plaid functions behave identically.
const SYNC_CFG = {
  plaidBase: PLAID_BASE,
  clientId: Deno.env.get('PLAID_CLIENT_ID'),
  secret: Deno.env.get('PLAID_SECRET'),
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing auth' }, 401);

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const { public_token, institution } = await req.json();
    if (!public_token) return json({ error: 'public_token required' }, 400);

    // Exchange public_token for access_token
    const exRes = await fetch(`${PLAID_BASE}/item/public_token/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: Deno.env.get('PLAID_CLIENT_ID'),
        secret: Deno.env.get('PLAID_SECRET'),
        public_token,
      }),
    });
    const exData = await exRes.json();
    if (!exRes.ok) return json({ error: exData.error_message || 'exchange failed', detail: exData }, 400);

    const access_token = exData.access_token as string;
    const item_id = exData.item_id as string;

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: itemRow, error: itemErr } = await admin
      .from('plaid_items')
      .insert({
        user_id: user.id,
        item_id,
        access_token,
        institution_id: institution?.institution_id ?? null,
        institution_name: institution?.name ?? null,
      })
      .select()
      .single();
    if (itemErr) {
      console.error('insert item err', itemErr);
      return json({ error: itemErr.message }, 500);
    }

    // Fetch accounts
    const accRes = await fetch(`${PLAID_BASE}/accounts/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: Deno.env.get('PLAID_CLIENT_ID'),
        secret: Deno.env.get('PLAID_SECRET'),
        access_token,
      }),
    });
    const accData = await accRes.json();
    if (!accRes.ok) {
      console.error('accounts/get error', accData);
    } else if (accData.accounts) {
      const rows = accData.accounts.map((a: any) => ({
        user_id: user.id,
        item_id: itemRow.id,
        account_id: a.account_id,
        name: a.name,
        official_name: a.official_name,
        mask: a.mask,
        type: a.type,
        subtype: a.subtype,
        current_balance: a.balances?.current,
        available_balance: a.balances?.available,
        iso_currency_code: a.balances?.iso_currency_code,
      }));
      await admin.from('plaid_accounts').upsert(rows, { onConflict: 'account_id' });
    }

    // Kick off initial transactions sync
    await syncItemTransactions(admin, SYNC_CFG, { itemRowId: itemRow.id, userId: user.id, accessToken: access_token, cursor: null });

    // Fetch credit card details (statement balance, due date, APR, etc.)
    await syncLiabilities(admin, user.id, access_token);

    return json({ ok: true, item_id: itemRow.id });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});

async function syncLiabilities(admin: any, userId: string, accessToken: string) {
  try {
    const res = await fetch(`${PLAID_BASE}/liabilities/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: Deno.env.get('PLAID_CLIENT_ID'),
        secret: Deno.env.get('PLAID_SECRET'),
        access_token: accessToken,
      }),
    });
    const data = await res.json();
    if (!res.ok) { console.warn('liabilities/get error (product may be unsupported for this institution):', data); return; }

    try {
      await upsertLoanDetails(admin, userId, data.liabilities);
    } catch (e) {
      console.warn('upsertLoanDetails failed:', e);
    }

    const creditCards = data.liabilities?.credit ?? [];
    if (!creditCards.length) return;

    const rows = creditCards.map((c: any) => ({
      user_id: userId,
      account_id: c.account_id,
      last_statement_balance: c.last_statement_balance,
      last_payment_amount: c.last_payment_amount,
      last_payment_date: c.last_payment_date,
      minimum_payment_amount: c.minimum_payment_amount,
      next_payment_due_date: c.next_payment_due_date,
      is_overdue: c.is_overdue ?? false,
      apr: c.aprs?.find((a: any) => a.apr_type === 'purchase_apr')?.apr_percentage ?? c.aprs?.[0]?.apr_percentage ?? null,
      updated_at: new Date().toISOString(),
    }));
    await admin.from('plaid_credit_details').upsert(rows, { onConflict: 'user_id,account_id' });
  } catch (e) {
    console.warn('syncLiabilities failed:', e);
  }
}

// Mortgage + student loans from /liabilities/get → plaid_loan_details
// (migration 20261020130200_plaid_loan_details.sql). Feeds the loan recurring
// streams' next due date / amount. Isolated so a missing table (migration not
// yet applied) can never break the credit-card upsert.
interface PlaidMortgageLiability {
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
interface PlaidStudentLiability {
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
interface UpsertClient {
  from(table: string): {
    upsert(rows: unknown[], opts: { onConflict: string }): PromiseLike<{ error: { message?: string } | null }>;
  };
}

async function upsertLoanDetails(
  admin: UpsertClient,
  userId: string,
  liabilities: { mortgage?: PlaidMortgageLiability[] | null; student?: PlaidStudentLiability[] | null } | null | undefined,
) {
  const now = new Date().toISOString();
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
  const rows = [...mortgages, ...students].filter(r => r.account_id);
  if (!rows.length) return;
  const { error } = await admin.from('plaid_loan_details').upsert(rows, { onConflict: 'user_id,account_id' });
  if (error) console.warn('plaid_loan_details upsert failed (migration applied?):', error.message ?? error);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
