import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Grant or revoke the admin role through the admin-set-user-role edge
 * function. Clients have SELECT-only on user_roles; the function checks that
 * the caller is an admin, validates the target and refuses to remove the last
 * admin. Returns the server's error message when it says no.
 */
export async function setAdminRole(
  client: Pick<SupabaseClient, "functions">,
  userId: string,
  makeAdmin: boolean,
): Promise<{ ok: true; changed: boolean } | { ok: false; error: string }> {
  const { data, error } = await client.functions.invoke("admin-set-user-role", {
    body: { userId, role: "admin", action: makeAdmin ? "grant" : "revoke" },
  });
  if (error) {
    // Non-2xx: the body is on error.context (a Response) for FunctionsHttpError.
    let msg: string | undefined;
    const ctx = (error as { context?: unknown }).context;
    if (ctx && typeof (ctx as Response).json === "function") {
      try { msg = (await (ctx as Response).clone().json())?.error; } catch { /* not JSON */ }
    }
    return { ok: false, error: msg ?? error.message ?? "Could not update the role" };
  }
  if (data?.error) return { ok: false, error: String(data.error) };
  return { ok: true, changed: data?.changed !== false };
}
