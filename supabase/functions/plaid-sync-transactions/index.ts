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

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: items, error } = await admin
      .from('plaid_items')
      .select('id, access_token, cursor')
      .eq('user_id', user.id)
      .eq('status', 'active');
    if (error) return json({ error: error.message }, 500);

    // { full_resync: true } re-walks history from the beginning (no cursor) —
    // used once after the pfc_* columns migration to backfill them, or to
    // recover rows a previous failed sync skipped.
    let fullResync = false;
    try { fullResync = !!(await req.json())?.full_resync; } catch { /* no body */ }

    let total = 0;
    const failures: { item: string; error: string }[] = [];
    for (const item of items ?? []) {
      await syncAccounts(admin, item.id, user.id, item.access_token);
      const r = await syncItemTransactions(admin, SYNC_CFG, {
        itemRowId: item.id, userId: user.id, accessToken: item.access_token,
        cursor: fullResync ? null : item.cursor,
      });
      total += r.count;
      if (!r.ok) failures.push({ item: item.id, error: r.error ?? 'sync failed' });
      await syncLiabilities(admin, user.id, item.access_token);
    }
    return json({ ok: failures.length === 0, items: items?.length ?? 0, synced: total, failures });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});

async function syncAccounts(admin: any, itemRowId: string, userId: string, accessToken: string) {
  try {
    const res = await fetch(`${PLAID_BASE}/accounts/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: Deno.env.get('PLAID_CLIENT_ID'),
        secret: Deno.env.get('PLAID_SECRET'),
        access_token: accessToken,
      }),
    });
    const data = await res.json();
    if (!res.ok) { console.warn('accounts/get error:', data); return; }
    const rows = (data.accounts ?? []).map((a: any) => ({
      user_id: userId,
      item_id: itemRowId,
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
    if (rows.length) {
      await admin.from('plaid_accounts').upsert(rows, { onConflict: 'account_id' });
    }
  } catch (e) {
    console.warn('syncAccounts failed:', e);
  }
}

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
    if (!res.ok) {
      // ADDITIONAL_CONSENT_REQUIRED means this item was linked before liabilities was
      // requested in Link — needs re-auth via update mode to grant that consent.
      if (data.error_code !== 'ADDITIONAL_CONSENT_REQUIRED') console.warn('liabilities/get error:', data);
      return;
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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
