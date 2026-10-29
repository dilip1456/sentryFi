// "Extend history" carry-over, server half. Called right after the same bank
// was linked again as a new Item (730 days of history) and BEFORE the old
// Item is removed. Matches the two Items' accounts (persistent_account_id,
// else mask + type + subtype), stores persistent ids, moves the service-only
// statement history, and returns the account map so the app can move the
// user's own settings and edits (src/lib/relink/carryover.ts).
//
// Body: { oldItemId, newItemId } (plaid_items.id of both; both must be the caller's).
// Logs and responses never include Plaid bodies or account data beyond the
// caller's own account ids / names / masks.
import { createClient } from "npm:@supabase/supabase-js@2.106.2";
import { getCallerUser } from "../_shared/auth.ts";
import { plaidErrorSummary } from "../_shared/plaid-errors.ts";
import { plaidAccountRows, upsertPlaidAccounts } from "../_shared/plaid-accounts.ts";
import { rekeyCreditStatements, relinkMatch, withPersistentIds, type StoredAccount } from "../_shared/plaid-relink.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PLAID_ENV = Deno.env.get("PLAID_ENV") ?? "sandbox";
const PLAID_BASE = `https://${PLAID_ENV}.plaid.com`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const user = await getCallerUser(req);
    if (!user) return json({ error: "Unauthorized" }, 401);
    const body = await req.json().catch(() => ({}));
    const oldItemId = typeof body?.oldItemId === "string" ? body.oldItemId : "";
    const newItemId = typeof body?.newItemId === "string" ? body.newItemId : "";
    if (!oldItemId || !newItemId || oldItemId === newItemId) return json({ error: "oldItemId and newItemId required" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: items, error: itemsErr } = await admin
      .from("plaid_items").select("id, access_token, institution_id").eq("user_id", user.id).in("id", [oldItemId, newItemId]);
    if (itemsErr) return json({ error: "Couldn't load banks", code: itemsErr.code ?? null }, 500);
    const oldItem = items?.find((i: { id: string }) => i.id === oldItemId);
    const newItem = items?.find((i: { id: string }) => i.id === newItemId);
    if (!oldItem || !newItem) return json({ error: "Item not found" }, 404);
    if (oldItem.institution_id && newItem.institution_id && oldItem.institution_id !== newItem.institution_id) {
      return json({ error: "Those are different banks" }, 400);
    }

    const accountsFor = async (item: { id: string; access_token: string }): Promise<StoredAccount[]> => {
      const { data: stored } = await admin
        .from("plaid_accounts").select("*").eq("user_id", user.id).eq("item_id", item.id);
      let live: { account_id: string; persistent_account_id?: string | null }[] | null = null;
      try {
        const res = await fetch(`${PLAID_BASE}/accounts/get`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: Deno.env.get("PLAID_CLIENT_ID"), secret: Deno.env.get("PLAID_SECRET"), access_token: item.access_token }),
        });
        const data = await res.json();
        if (!res.ok) console.warn("accounts/get error:", plaidErrorSummary(data, res.status));
        else {
          live = data.accounts ?? [];
          await upsertPlaidAccounts(admin, plaidAccountRows(user.id, item.id, data.accounts)); // never throws
        }
      } catch (e) {
        console.warn("accounts/get failed:", e instanceof Error ? e.message : String(e));
      }
      return withPersistentIds((stored ?? []) as StoredAccount[], live);
    };

    const [oldAccounts, newAccounts] = await Promise.all([accountsFor(oldItem), accountsFor(newItem)]);
    const result = relinkMatch(oldAccounts, newAccounts);
    const statementsMoved = await rekeyCreditStatements(admin, user.id, result.accountMap);
    return json({ ok: true, ...result, statementsMoved });
  } catch (e) {
    console.warn("plaid-relink failed:", e instanceof Error ? e.message : String(e));
    return json({ error: "Carry-over failed" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
