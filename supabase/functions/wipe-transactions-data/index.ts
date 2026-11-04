import { createClient } from "npm:@supabase/supabase-js@2.106.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Wipes the calling user's own transaction data and every classification
// override/rule keyed off it, WITHOUT touching their linked bank connections
// (plaid_items / plaid_accounts stay put) or unrelated preferences (budgets,
// savings goals, panel layout, custom categories, etc). The client calls
// plaid-sync-transactions with { full_resync: true } right after this
// succeeds, to re-walk each item's full history from Plaid with a clean
// slate and nothing left to reapply on top of it.
//
// Scoped to auth.uid() only -- there is no way to pass another user's id in,
// so this can never be used to wipe anyone else's data.
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
    const uid = user.id;

    // Deleting plaid_transactions cascades to txn_overrides (FK ON DELETE
    // CASCADE, keyed by transaction_id) -- no need to touch that table directly.
    const { error: txnErr, count } = await admin
      .from("plaid_transactions")
      .delete({ count: "exact" })
      .eq("user_id", uid);
    if (txnErr) return json({ error: `Deleting transactions failed: ${txnErr.message}` }, 500);

    // Reset every user_settings column that represents a per-transaction
    // classification override, tag, note, or auto-apply rule. Deliberately
    // leaves budgets, savings_goals, account_roles, account_meta, panel_order,
    // custom_cats, benefits_used, money_map_feedback, overage_funding_prefs,
    // planned_transfers, card_autopay_from, dismissed_insights and
    // dismissed_actions untouched -- those are app preferences/layout, not
    // rules that would re-apply to freshly-pulled transactions.
    const { error: settingsErr } = await admin.from("user_settings").update({
      cat_overrides: {},
      cat_rules: [],
      smart_rules: [],
      name_overrides: {},
      name_rules: {},
      txn_tags: {},
      txn_notes: {},
      recurring_overrides: {},
      txn_splits: {},
      recurring_groups: [],
      dismissed_recurring: [],
      recurring_dismissals: [],
      manual_income: [],
      manual_internal: [],
      manual_external: [],
    }).eq("user_id", uid);
    if (settingsErr) return json({ error: `Clearing rules/overrides failed: ${settingsErr.message}` }, 500);

    return json({ ok: true, transactionsDeleted: count ?? 0 });
  } catch (e) {
    console.error("[wipe-transactions-data]", e);
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
