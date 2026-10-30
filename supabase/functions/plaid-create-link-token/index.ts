import { createClient } from "npm:@supabase/supabase-js@2.106.2";
import { getCallerUser } from "../_shared/auth.ts";
import { plaidErrorSummary } from "../_shared/plaid-errors.ts";
import { newItemLinkProducts } from "../_shared/plaid-link.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PLAID_CLIENT_ID = Deno.env.get("PLAID_CLIENT_ID")!;
const PLAID_SECRET = Deno.env.get("PLAID_SECRET")!;
const PLAID_ENV = Deno.env.get("PLAID_ENV") ?? "sandbox";
const plaidBase = `https://${PLAID_ENV}.plaid.com`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    // Verify the caller from their own JWT (anon-key client + their
    // Authorization header). Returns null for a missing/anon/expired token.
    const user = await getCallerUser(req);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Optional body: { itemId } — when present, this is an "update mode" request to
    // grant additional consent (e.g. Liabilities) on an item that's already linked,
    // rather than a brand-new Link session.
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const itemId = body?.itemId as string | undefined;

    const params: Record<string, unknown> = {
      client_id: PLAID_CLIENT_ID,
      secret: PLAID_SECRET,
      client_name: "Sentry Finance",
      user: { client_user_id: user.id },
      country_codes: ["US"],
      language: "en",
    };

    if (itemId) {
      // plaid_items.access_token is not selectable by `authenticated`
      // (migration 20261020170000), so read it with a pure service_role
      // client: no user Authorization header, so PostgREST runs as
      // service_role. Ownership is enforced by the user_id filter below.
      const admin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const { data: item, error: itemErr } = await admin
        .from("plaid_items")
        .select("access_token")
        .eq("id", itemId)
        .eq("user_id", user.id)
        .single();
      if (itemErr || !item) {
        return new Response(JSON.stringify({ error: "Item not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      params.access_token = item.access_token;
      params.products = ["liabilities"];
      // No transactions.days_requested here: Transactions is already
      // initialised on this Item, so Plaid ignores it (history depth is fixed
      // at the original Link). Raising it needs a new Item: docs/PLAID_HISTORY.md.
    } else {
      // New Item: 730 days of history (Plaid default is 90).
      Object.assign(params, newItemLinkProducts());
    }

    const res = await fetch(`${plaidBase}/link/token/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error("Plaid link token error", plaidErrorSummary(data, res.status));
      return new Response(JSON.stringify({ error: data.error_message || "Plaid error", error_code: data.error_code ?? null }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ link_token: data.link_token }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
