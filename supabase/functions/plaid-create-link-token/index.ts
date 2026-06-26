import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
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
      client_name: "SentryFi",
      user: { client_user_id: user.id },
      country_codes: ["US"],
      language: "en",
    };

    if (itemId) {
      const { data: item, error: itemErr } = await supabase
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
    } else {
      params.products = ["transactions"];
      params.optional_products = ["investments", "liabilities"];
    }

    const res = await fetch(`${plaidBase}/link/token/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error("Plaid link token error", data);
      return new Response(JSON.stringify({ error: data.error_message || data }), {
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
