import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PLAID_CLIENT_ID = Deno.env.get("PLAID_CLIENT_ID")!;
const PLAID_SECRET = Deno.env.get("PLAID_SECRET")!;
const PLAID_ENV = Deno.env.get("PLAID_ENV") ?? "sandbox";
const PLAID_BASE = `https://${PLAID_ENV}.plaid.com`;

// Finishes a Plaid Link "update mode" session that requested additional consent
// (e.g. Liabilities) on an item that was linked before that product existed.
// The item's access_token does not change — this just confirms the new consent
// and immediately backfills plaid_credit_details so the UI updates right away.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing auth" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { public_token, itemId } = await req.json();
    if (!public_token || !itemId) return json({ error: "public_token and itemId required" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: item, error: itemErr } = await admin
      .from("plaid_items")
      .select("id, access_token")
      .eq("id", itemId)
      .eq("user_id", user.id)
      .single();
    if (itemErr || !item) return json({ error: "Item not found" }, 404);

    // Confirm the update-mode session (Plaid returns the same access_token/item).
    const exRes = await fetch(`${PLAID_BASE}/item/public_token/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: PLAID_CLIENT_ID,
        secret: PLAID_SECRET,
        public_token,
      }),
    });
    const exData = await exRes.json();
    if (!exRes.ok) return json({ error: exData.error_message ?? "exchange failed", detail: exData }, 400);

    await admin.from("plaid_items").update({ updated_at: new Date().toISOString() }).eq("id", itemId);

    // Backfill credit details immediately so the UI doesn't have to wait for the next sync.
    const credRes = await fetch(`${PLAID_BASE}/liabilities/get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: PLAID_CLIENT_ID,
        secret: PLAID_SECRET,
        access_token: item.access_token,
      }),
    });
    const credData = await credRes.json();
    if (credRes.ok) {
      const creditCards = credData.liabilities?.credit ?? [];
      if (creditCards.length) {
        const rows = creditCards.map((c: any) => ({
          user_id: user.id,
          account_id: c.account_id,
          last_statement_balance: c.last_statement_balance,
          last_payment_amount: c.last_payment_amount,
          last_payment_date: c.last_payment_date,
          minimum_payment_amount: c.minimum_payment_amount,
          next_payment_due_date: c.next_payment_due_date,
          is_overdue: c.is_overdue ?? false,
          apr: c.aprs?.find((a: any) => a.apr_type === "purchase_apr")?.apr_percentage ?? c.aprs?.[0]?.apr_percentage ?? null,
          updated_at: new Date().toISOString(),
        }));
        await admin.from("plaid_credit_details").upsert(rows, { onConflict: "user_id,account_id" });
      }
    }

    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
