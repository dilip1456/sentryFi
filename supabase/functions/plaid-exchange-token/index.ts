import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const PLAID_ENV = Deno.env.get('PLAID_ENV') || 'sandbox';
const PLAID_BASE = `https://${PLAID_ENV}.plaid.com`;

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
    if (accRes.ok && accData.accounts) {
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
    await syncTransactions(admin, itemRow.id, user.id, access_token, null);

    return json({ ok: true, item_id: itemRow.id });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});

async function syncTransactions(admin: any, itemRowId: string, userId: string, accessToken: string, cursor: string | null) {
  let hasMore = true;
  let nextCursor = cursor;
  while (hasMore) {
    const res = await fetch(`${PLAID_BASE}/transactions/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: Deno.env.get('PLAID_CLIENT_ID'),
        secret: Deno.env.get('PLAID_SECRET'),
        access_token: accessToken,
        cursor: nextCursor ?? undefined,
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
        category: t.category,
        pending: t.pending,
        payment_channel: t.payment_channel,
      }));
      await admin.from('plaid_transactions').upsert(rows, { onConflict: 'transaction_id' });
    }
    if (data.removed?.length) {
      const ids = data.removed.map((r: any) => r.transaction_id);
      await admin.from('plaid_transactions').delete().in('transaction_id', ids);
    }
    nextCursor = data.next_cursor;
    hasMore = data.has_more;
  }
  await admin.from('plaid_items').update({ cursor: nextCursor }).eq('id', itemRowId);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
