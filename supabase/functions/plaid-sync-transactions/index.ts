import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const PLAID_ENV = Deno.env.get('PLAID_ENV') || 'sandbox';
const PLAID_BASE = `https://${PLAID_ENV}.plaid.com`;

// Plaid's modern /transactions/sync responses often leave the legacy `category`
// field empty and populate `personal_finance_category` instead. Map that into
// the app's own category labels so transactions don't all fall back to "Other".
const PFC_PRIMARY_MAP: Record<string, string> = {
  INCOME: "Salary",
  TRANSFER_IN: "Transfer In",
  TRANSFER_OUT: "Transfer Out",
  LOAN_PAYMENTS: "Bills & Utilities",
  BANK_FEES: "Bills & Utilities",
  ENTERTAINMENT: "Entertainment",
  FOOD_AND_DRINK: "Food & Drink",
  GROCERIES: "Groceries",
  GROCERY_AND_SPECIALTY_FOOD_STORES: "Groceries",
  GENERAL_MERCHANDISE: "Shopping",
  HOME_IMPROVEMENT: "Home",
  MEDICAL: "Healthcare",
  PERSONAL_CARE: "Personal Care",
  GENERAL_SERVICES: "Bills & Utilities",
  GOVERNMENT_AND_NON_PROFIT: "Charitable Giving",
  TRANSPORTATION: "Transportation",
  GAS_STATIONS: "Transportation",
  AUTOMOTIVE: "Transportation",
  TRAVEL: "Travel",
  RENT_AND_UTILITIES: "Bills & Utilities",
  SUBSCRIPTION: "Subscriptions",
  FINANCIAL: "Bills & Utilities",
};

function resolveCategory(t: any): string[] | null {
  if (Array.isArray(t.category) && t.category.length > 0) return t.category;
  const primary = t.personal_finance_category?.primary;
  if (primary) {
    const mapped = PFC_PRIMARY_MAP[primary] ?? "Other";
    return [mapped];
  }
  return null;
}

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

    let total = 0;
    for (const item of items ?? []) {
      await syncAccounts(admin, item.id, user.id, item.access_token);
      total += await syncOne(admin, item.id, user.id, item.access_token, item.cursor);
      await syncLiabilities(admin, user.id, item.access_token);
    }
    return json({ ok: true, items: items?.length ?? 0, synced: total });
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

async function syncOne(admin: any, itemRowId: string, userId: string, accessToken: string, cursor: string | null) {
  let hasMore = true;
  let nextCursor = cursor;
  let count = 0;
  while (hasMore) {
    const res = await fetch(`${PLAID_BASE}/transactions/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: Deno.env.get('PLAID_CLIENT_ID'),
        secret: Deno.env.get('PLAID_SECRET'),
        access_token: accessToken,
        cursor: nextCursor ?? undefined,
        options: { include_personal_finance_category: true },
      }),
    });
    const data = await res.json();
    if (!res.ok) { console.error('sync err', data); break; }

    const added = (data.added ?? []).concat(data.modified ?? []);
    if (added.length) {
      const rows = added.map((t: any) => ({
        user_id: userId,
        item_id: itemRowId,
        account_id: t.account_id,
        transaction_id: t.transaction_id,
        amount: t.amount,
        iso_currency_code: t.iso_currency_code,
        date: t.date,
        authorized_date: t.authorized_date,
        name: t.name,
        merchant_name: t.merchant_name,
        category: resolveCategory(t),
        pending: t.pending,
        payment_channel: t.payment_channel,
      }));
      await admin.from('plaid_transactions').upsert(rows, { onConflict: 'transaction_id' });
      count += rows.length;
    }
    if (data.removed?.length) {
      const ids = data.removed.map((r: any) => r.transaction_id);
      await admin.from('plaid_transactions').delete().in('transaction_id', ids);
    }
    nextCursor = data.next_cursor;
    hasMore = data.has_more;
  }
  await admin.from('plaid_items').update({ cursor: nextCursor }).eq('id', itemRowId);
  return count;
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
