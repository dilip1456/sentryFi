// Authorization rules for granting / revoking the admin role (admin-set-user-role).
//
// Pure (no Deno / network imports) so vitest can exercise every branch.
// The edge function gathers the facts (who is calling, is the caller an admin
// in user_roles, does the target exist, how many admins are there) and this
// module decides. The database adds a last-admin guard trigger
// (20261020190000_user_roles_admin_guard.sql) so two concurrent revokes can't
// both pass this check and leave the project with no admin.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only the admin role is managed here; every user already has "user". */
export const MANAGED_ROLES = ["admin"] as const;
export type ManagedRole = (typeof MANAGED_ROLES)[number];
export type RoleAction = "grant" | "revoke";

export interface RoleRequest {
  userId: string;
  role: ManagedRole;
  action: RoleAction;
}

export type ParseResult = { ok: true; value: RoleRequest } | { ok: false; status: 400; error: string };

/** Validate the request body: { userId: uuid, role: "admin", action: "grant" | "revoke" }. */
export function parseRoleRequest(body: unknown): ParseResult {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const userId = b.userId;
  const role = b.role ?? "admin";
  const action = b.action;
  if (typeof userId !== "string" || !UUID_RE.test(userId)) return { ok: false, status: 400, error: "userId must be a uuid" };
  if (typeof role !== "string" || !(MANAGED_ROLES as readonly string[]).includes(role)) return { ok: false, status: 400, error: "role must be \"admin\"" };
  if (action !== "grant" && action !== "revoke") return { ok: false, status: 400, error: "action must be \"grant\" or \"revoke\"" };
  return { ok: true, value: { userId: userId.toLowerCase(), role: role as ManagedRole, action } };
}

export interface RoleFacts {
  /** Verified from the JWT (auth.getUser), never from the request body. */
  callerId: string | null;
  /** From user_roles, read with the service role. */
  callerIsAdmin: boolean;
  /** The target exists in auth.users. */
  targetExists: boolean;
  /** profiles.disabled for the target (banned). */
  targetDisabled: boolean;
  /** The target currently has the role being changed. */
  targetHasRole: boolean;
  /** Number of users that currently hold the admin role. */
  adminCount: number;
}

export type Decision =
  | { allow: true; noop: boolean }
  | { allow: false; status: 401 | 403 | 404 | 409; error: string };

/**
 * Decide whether a role change may happen.
 *  - unauthenticated → 401; caller not an admin → 403 (so nobody can make
 *    themselves admin: a non-admin is refused before the target is considered)
 *  - target must exist → 404
 *  - granting admin to a disabled account → 409
 *  - revoking the last admin (including yourself) → 409
 *  - granting an existing / revoking a missing role → allowed no-op
 */
export function decideRoleChange(req: RoleRequest, f: RoleFacts): Decision {
  if (!f.callerId) return { allow: false, status: 401, error: "Unauthorized" };
  if (!f.callerIsAdmin) return { allow: false, status: 403, error: "Forbidden" };
  if (!f.targetExists) return { allow: false, status: 404, error: "User not found" };
  if (req.action === "grant") {
    if (f.targetHasRole) return { allow: true, noop: true };
    if (f.targetDisabled) return { allow: false, status: 409, error: "Re-enable this account before making it an admin" };
    return { allow: true, noop: false };
  }
  if (!f.targetHasRole) return { allow: true, noop: true };
  if (f.adminCount <= 1) {
    return {
      allow: false, status: 409,
      error: req.userId === f.callerId.toLowerCase()
        ? "You're the only admin. Make someone else an admin before removing your own access."
        : "This is the last admin; make someone else an admin first.",
    };
  }
  return { allow: true, noop: false };
}

/** Postgres error raised by the last-admin guard trigger. */
export const LAST_ADMIN_SQLSTATE = "P0001";
export const LAST_ADMIN_MESSAGE = "cannot remove the last admin";
export function isLastAdminError(e: { code?: string; message?: string } | null | undefined): boolean {
  return !!e && e.code === LAST_ADMIN_SQLSTATE && (e.message ?? "").includes(LAST_ADMIN_MESSAGE);
}
