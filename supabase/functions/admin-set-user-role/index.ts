// Admin-only: grant or revoke the admin role.
//
// Authenticated users only have SELECT on user_roles (and that's deliberate:
// no client may write roles), so the Admin panel's Make/Revoke admin goes
// through this service-role function. It:
//   1. verifies the caller's JWT (auth.getUser, never a user id from the body),
//   2. requires the caller to hold "admin" in user_roles,
//   3. validates the target (uuid, existing auth user, not disabled for grants),
//   4. refuses to remove the last admin (including revoking yourself),
// with the rules in ../_shared/admin-roles.ts (unit-tested). The DB trigger
// from 20261020190000_user_roles_admin_guard.sql backs up step 4 atomically.
import { createClient } from "npm:@supabase/supabase-js@2.106.2";
import { getCallerUser } from "../_shared/auth.ts";
import { decideRoleChange, isLastAdminError, parseRoleRequest } from "../_shared/admin-roles.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const TAG = "[admin-set-user-role]";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const caller = await getCallerUser(req);
    if (!caller) return json({ error: "Unauthorized" }, 401);

    const parsed = parseRoleRequest(await req.json().catch(() => null));
    if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
    const { userId, role, action } = parsed.value;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const [callerRole, targetRole, admins] = await Promise.all([
      admin.from("user_roles").select("role").eq("user_id", caller.id).eq("role", "admin").maybeSingle(),
      admin.from("user_roles").select("role").eq("user_id", userId).eq("role", role).maybeSingle(),
      admin.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role", "admin"),
    ]);
    const lookupErr = callerRole.error ?? targetRole.error ?? admins.error;
    if (lookupErr) {
      console.error(TAG, "role lookup failed", { code: lookupErr.code });
      return json({ error: "Could not verify permissions" }, 500);
    }

    // Only look the target up once the caller is known to be an admin.
    let targetExists = false;
    let targetDisabled = false;
    if (callerRole.data) {
      const { data: target, error: targetErr } = await admin.auth.admin.getUserById(userId);
      targetExists = !targetErr && !!target?.user;
      if (targetExists) {
        const { data: prof } = await admin.from("profiles").select("disabled").eq("user_id", userId).maybeSingle();
        targetDisabled = !!prof?.disabled;
      }
    }

    const decision = decideRoleChange(parsed.value, {
      callerId: caller.id,
      callerIsAdmin: !!callerRole.data,
      targetExists,
      targetDisabled,
      targetHasRole: !!targetRole.data,
      adminCount: admins.count ?? 0,
    });
    if (!decision.allow) return json({ error: decision.error }, decision.status);
    if (decision.noop) return json({ ok: true, userId, role, action, changed: false });

    if (action === "grant") {
      const { error } = await admin.from("user_roles")
        .upsert({ user_id: userId, role }, { onConflict: "user_id,role", ignoreDuplicates: true });
      if (error) {
        console.error(TAG, "grant failed", { code: error.code });
        return json({ error: "Could not grant the role" }, 500);
      }
    } else {
      const { error } = await admin.from("user_roles").delete().eq("user_id", userId).eq("role", role);
      if (isLastAdminError(error)) return json({ error: "This is the last admin; make someone else an admin first." }, 409);
      if (error) {
        console.error(TAG, "revoke failed", { code: error.code });
        return json({ error: "Could not revoke the role" }, 500);
      }
    }
    console.log(TAG, `${action} ${role}`, { by: caller.id, target: userId });
    return json({ ok: true, userId, role, action, changed: true });
  } catch (e) {
    console.error(TAG, e instanceof Error ? e.message : "unexpected error");
    return json({ error: "Could not update the role" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
