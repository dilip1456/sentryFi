import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PLAID_CLIENT_ID = Deno.env.get("PLAID_CLIENT_ID")!;
const PLAID_SECRET = Deno.env.get("PLAID_SECRET")!;
const PLAID_ENV = Deno.env.get("PLAID_ENV") ?? "sandbox";
const PLAID_BASE = `https://${PLAID_ENV}.plaid.com`;

// Properly disconnects a linked bank: calls Plaid's /item/remove to actually
// revoke the access_token (freeing up the Item slot on Plaid's side, which is
// capped in Sandbox/Development), then deletes all local rows for that item.
// Without the Plaid-side call, removing the item only locally leaves the
// access_token alive forever and the slot never frees up.
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

    const { itemId } = await req.json();
    if (!itemId) return json({ error: "itemId required" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: item, error: itemErr } = await admin
      .from("plaid_items")
      .select("id, access_token, user_id")
      .eq("id", itemId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (itemErr) return json({ error: itemErr.message }, 500);
    if (!item) return json({ error: "Item not found" }, 404);

    // Best-effort: revoke with Plaid. If it's already gone on Plaid's side
    // (e.g. previously removed locally without this step), don't block the
    // local cleanup on that.
    try {
      const res = await fetch(`${PLAID_BASE}/item/remove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: PLAID_CLIENT_ID,
          secret: PLAID_SECRET,
          access_token: item.access_token,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.warn("[plaid-remove-item] Plaid item/remove returned non-OK:", body);
      }
    } catch (e) {
      console.warn("[plaid-remove-item] Plaid item/remove request failed:", e);
    }

    const { data: accounts } = await admin
      .from("plaid_accounts")
      .select("account_id")
      .eq("item_id", item.id);
    const accountIds = (accounts ?? []).map((a: { account_id: string }) => a.account_id);

    await admin.from("plaid_transactions").delete().eq("item_id", item.id);
    if (accountIds.length > 0) {
      await admin.from("plaid_credit_details").delete().eq("user_id", user.id).in("account_id", accountIds);
    }
    await admin.from("plaid_accounts").delete().eq("item_id", item.id);
    await admin.from("plaid_items").delete().eq("id", item.id);

    return json({ ok: true });
  } catch (e) {
    console.error("[plaid-remove-item]", e);
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
