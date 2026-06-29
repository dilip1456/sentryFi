import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PLAID_CLIENT_ID = Deno.env.get("PLAID_CLIENT_ID")!;
const PLAID_SECRET = Deno.env.get("PLAID_SECRET")!;
const PLAID_ENV = Deno.env.get("PLAID_ENV") ?? "sandbox";
const PLAID_BASE = `https://${PLAID_ENV}.plaid.com`;

// Full account deletion: revokes every linked bank with Plaid (so Item slots
// actually free up), wipes every row of the user's data, then deletes the
// auth user itself. Irreversible -- the client should make sure the person
// has explicitly confirmed before calling this.
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

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Revoke every linked Plaid item first (best-effort per item -- one failure
    // shouldn't block deleting the rest of the account).
    const { data: items } = await admin
      .from("plaid_items")
      .select("id, access_token")
      .eq("user_id", user.id);

    for (const item of items ?? []) {
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
          console.warn("[delete-account] Plaid item/remove non-OK for item", item.id, body);
        }
      } catch (e) {
        console.warn("[delete-account] Plaid item/remove failed for item", item.id, e);
      }
    }

    // Wipe all user data. Order doesn't strictly matter (deleting by user_id
    // throughout, not relying on cascade), but children-first is tidy.
    const uid = user.id;
    await admin.from("plaid_transactions").delete().eq("user_id", uid);
    await admin.from("plaid_credit_details").delete().eq("user_id", uid);
    await admin.from("plaid_accounts").delete().eq("user_id", uid);
    await admin.from("plaid_items").delete().eq("user_id", uid);
    await admin.from("gift_cards").delete().eq("user_id", uid);
    await admin.from("ai_insights").delete().eq("user_id", uid);
    await admin.from("subscribers").delete().eq("user_id", uid);
    await admin.from("user_roles").delete().eq("user_id", uid);
    await admin.from("profiles").delete().eq("user_id", uid);

    // Finally, delete the auth user itself.
    const { error: delErr } = await admin.auth.admin.deleteUser(uid);
    if (delErr) return json({ error: delErr.message }, 500);

    return json({ ok: true });
  } catch (e) {
    console.error("[delete-account]", e);
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
