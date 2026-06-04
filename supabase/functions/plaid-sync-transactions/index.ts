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
      total += await syncOne(admin, item.id, user.id, item.access_token, item.cursor);
    }
    return json({ ok: true, items: items?.length ?? 0, synced: total });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});

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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
