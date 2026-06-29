import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PLAID_CLIENT_ID = Deno.env.get("PLAID_CLIENT_ID")!;
const PLAID_SECRET = Deno.env.get("PLAID_SECRET")!;
const PLAID_ENV = Deno.env.get("PLAID_ENV") ?? "sandbox";
const PLAID_BASE = `https://${PLAID_ENV}.plaid.com`;

// Calls Plaid's /item/remove BEFORE deleting our local row. Without this, deleting
// only the local plaid_items row leaks the Item on Plaid's side forever — it stays
// alive and counted against the account's Item limit even though it's invisible to
// us (we no longer hold the access_token needed to remove it after the row is gone).
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
      .select("id, access_token")
      .eq("id", itemId)
      .eq("user_id", user.id)
      .single();
    if (itemErr || !item) return json({ error: "Item not found" }, 404);

    const rmRes = await fetch(`${PLAID_BASE}/item/remove`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: PLAID_CLIENT_ID,
        secret: PLAID_SECRET,
        access_token: item.access_token,
      }),
    });
    const rmData = await rmRes.json();
    // ITEM_NOT_FOUND means Plaid already considers it gone (e.g. previously leaked
    // and since cleaned up on their end) — safe to proceed with local cleanup either way.
    if (!rmRes.ok && rmData.error_code !== "ITEM_NOT_FOUND") {
      return json({ error: rmData.error_message ?? "Plaid item/remove failed", detail: rmData }, 502);
    }

    await admin.from("plaid_items").delete().eq("id", itemId).eq("user_id", user.id);

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
