// Admin-only: disable or re-enable a user account (security audit M2).
//
// profiles.disabled used to be a flag nothing enforced. This function makes it
// real: it bans the auth user (sign-in and token refresh fail; existing access
// tokens stop working when they expire, by default within an hour), and only
// then mirrors the state into profiles.disabled. The profiles trigger added in
// 20261020170200_profiles_protect_disabled.sql rejects changes to that column
// from anon/authenticated, so this function (service_role) is the only path.
import { createClient } from "npm:@supabase/supabase-js@2.106.2";
import { getCallerUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// ~100 years: GoTrue's way of saying "until an admin lifts it".
const BAN_FOREVER = "876000h";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const caller = await getCallerUser(req);
    if (!caller) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const { data: roleRow, error: roleErr } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .eq("role", "admin")
      .maybeSingle();
    if (roleErr) {
      console.error("[admin-set-user-disabled] role lookup", roleErr);
      return json({ error: "Could not verify permissions" }, 500);
    }
    if (!roleRow) return json({ error: "Forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const userId = body?.userId;
    const disabled = body?.disabled;
    if (typeof userId !== "string" || !UUID_RE.test(userId) || typeof disabled !== "boolean") {
      return json({ error: "userId (uuid) and disabled (boolean) are required" }, 400);
    }
    if (userId === caller.id && disabled) {
      return json({ error: "You cannot disable your own account" }, 400);
    }

    const { error: banErr } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: disabled ? BAN_FOREVER : "none",
    });
    if (banErr) {
      console.error("[admin-set-user-disabled] ban update", banErr);
      return json({ error: "Could not update the user's sign-in status" }, 500);
    }

    const { error: profErr } = await admin
      .from("profiles")
      .update({ disabled })
      .eq("user_id", userId);
    if (profErr) {
      console.error("[admin-set-user-disabled] profile update", profErr);
      return json({ error: "Sign-in status changed, but the profile flag could not be saved" }, 500);
    }

    return json({ ok: true, userId, disabled });
  } catch (e) {
    console.error("[admin-set-user-disabled]", e);
    return json({ error: "Could not update the user" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
