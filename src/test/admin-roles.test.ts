import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  decideRoleChange, parseRoleRequest, isLastAdminError, type RoleFacts, type RoleRequest,
} from "../../supabase/functions/_shared/admin-roles.ts";
import { setAdminRole } from "@/lib/admin-roles";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const req = (p: Partial<RoleRequest> = {}): RoleRequest => ({ userId: OTHER, role: "admin", action: "grant", ...p });
const facts = (p: Partial<RoleFacts> = {}): RoleFacts => ({
  callerId: ME, callerIsAdmin: true, targetExists: true, targetDisabled: false, targetHasRole: false, adminCount: 1, ...p,
});

describe("parseRoleRequest", () => {
  it("accepts a valid grant / revoke (role defaults to admin)", () => {
    expect(parseRoleRequest({ userId: OTHER, action: "grant" })).toEqual({ ok: true, value: { userId: OTHER, role: "admin", action: "grant" } });
    expect(parseRoleRequest({ userId: OTHER.toUpperCase(), role: "admin", action: "revoke" })).toMatchObject({ ok: true, value: { userId: OTHER } });
  });
  it.each([
    [null], ["str"], [{}], [{ userId: "not-a-uuid", action: "grant" }], [{ userId: `${OTHER}' or 1=1`, action: "grant" }],
    [{ userId: OTHER, action: "promote" }], [{ userId: OTHER, action: "grant", role: "superuser" }],
    [{ userId: OTHER, action: "grant", role: "user" }], [{ userId: 42, action: "grant" }],
  ])("rejects %j with 400", (body) => {
    expect(parseRoleRequest(body)).toMatchObject({ ok: false, status: 400 });
  });
});

describe("decideRoleChange", () => {
  it("requires a verified caller", () => {
    expect(decideRoleChange(req(), facts({ callerId: null }))).toMatchObject({ allow: false, status: 401 });
  });
  it("a non-admin can't grant anyone, including themselves (no self-escalation)", () => {
    expect(decideRoleChange(req({ userId: ME }), facts({ callerIsAdmin: false }))).toMatchObject({ allow: false, status: 403 });
    expect(decideRoleChange(req(), facts({ callerIsAdmin: false }))).toMatchObject({ allow: false, status: 403 });
    expect(decideRoleChange(req({ action: "revoke" }), facts({ callerIsAdmin: false, targetHasRole: true, adminCount: 3 }))).toMatchObject({ allow: false, status: 403 });
  });
  it("checks authorization before revealing whether the target exists", () => {
    expect(decideRoleChange(req(), facts({ callerIsAdmin: false, targetExists: false }))).toMatchObject({ status: 403 });
    expect(decideRoleChange(req(), facts({ targetExists: false }))).toMatchObject({ allow: false, status: 404 });
  });
  it("an admin can grant admin to an existing, enabled user", () => {
    expect(decideRoleChange(req(), facts())).toEqual({ allow: true, noop: false });
  });
  it("won't make a disabled account an admin", () => {
    expect(decideRoleChange(req(), facts({ targetDisabled: true }))).toMatchObject({ allow: false, status: 409 });
  });
  it("granting an existing role or revoking a missing one is a no-op", () => {
    expect(decideRoleChange(req(), facts({ targetHasRole: true }))).toEqual({ allow: true, noop: true });
    expect(decideRoleChange(req({ action: "revoke" }), facts({ targetHasRole: false }))).toEqual({ allow: true, noop: true });
  });
  it("never removes the last admin, including the caller revoking themselves", () => {
    expect(decideRoleChange(req({ action: "revoke", userId: ME }), facts({ targetHasRole: true, adminCount: 1 })))
      .toMatchObject({ allow: false, status: 409, error: expect.stringMatching(/only admin/) });
    expect(decideRoleChange(req({ action: "revoke" }), facts({ targetHasRole: true, adminCount: 1 }))).toMatchObject({ allow: false, status: 409 });
    expect(decideRoleChange(req({ action: "revoke" }), facts({ targetHasRole: true, adminCount: 0 }))).toMatchObject({ allow: false, status: 409 });
  });
  it("revoking is allowed while another admin remains", () => {
    expect(decideRoleChange(req({ action: "revoke" }), facts({ targetHasRole: true, adminCount: 2 }))).toEqual({ allow: true, noop: false });
    expect(decideRoleChange(req({ action: "revoke", userId: ME }), facts({ targetHasRole: true, adminCount: 2 }))).toEqual({ allow: true, noop: false });
  });
  it("recognizes the DB last-admin guard error", () => {
    expect(isLastAdminError({ code: "P0001", message: "cannot remove the last admin" })).toBe(true);
    expect(isLastAdminError({ code: "23505", message: "duplicate" })).toBe(false);
    expect(isLastAdminError(null)).toBe(false);
  });
});

describe("admin-set-user-role edge function wiring", () => {
  const src = readFileSync(join(__dirname, "../../supabase/functions/admin-set-user-role/index.ts"), "utf8");
  it("verifies the JWT, reads roles with the service role and uses the shared rules", () => {
    expect(src).toMatch(/getCallerUser\(req\)/);
    expect(src).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(src).toMatch(/\.eq\("user_id", caller\.id\)\.eq\("role", "admin"\)/);
    expect(src).toMatch(/decideRoleChange\(/);
    expect(src).toMatch(/parseRoleRequest\(/);
    // the caller's identity comes from the JWT only
    expect(src).not.toMatch(/body\??\.callerId|callerId:\s*body/);
  });
});

describe("no client write access to user_roles", () => {
  const dir = join(__dirname, "../../supabase/migrations");
  const sql = readdirSync(dir).filter(f => f.endsWith(".sql")).map(f => readFileSync(join(dir, f), "utf8")).join("\n");
  it("no migration grants INSERT/UPDATE/DELETE/ALL on user_roles to anon or authenticated", () => {
    const grants = sql.match(/grant\s+[^;]*\s+on\s+(table\s+)?public\.user_roles\s+to\s+[^;]*;/gi) ?? [];
    for (const g of grants) {
      if (/\b(anon|authenticated|public)\b/i.test(g.replace(/on\s+(table\s+)?public\.user_roles/i, ""))) {
        expect(g).toMatch(/^grant\s+select\s+on/i);
      }
    }
  });
  it("the admin UI no longer writes user_roles directly", () => {
    const ui = readFileSync(join(__dirname, "../components/finance/AdminUsersSection.tsx"), "utf8");
    expect(ui).not.toMatch(/from\("user_roles"\)\.(insert|delete|update|upsert)/);
    expect(ui).toMatch(/setAdminRole\(/);
  });
});

describe("setAdminRole (client)", () => {
  it("invokes the edge function with grant / revoke", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { ok: true, changed: true }, error: null });
    await expect(setAdminRole({ functions: { invoke } } as never, OTHER, true)).resolves.toEqual({ ok: true, changed: true });
    expect(invoke).toHaveBeenCalledWith("admin-set-user-role", { body: { userId: OTHER, role: "admin", action: "grant" } });
    await setAdminRole({ functions: { invoke } } as never, OTHER, false);
    expect(invoke).toHaveBeenLastCalledWith("admin-set-user-role", { body: { userId: OTHER, role: "admin", action: "revoke" } });
  });
  it("surfaces the server's refusal message from a non-2xx response", async () => {
    const context = new Response(JSON.stringify({ error: "This is the last admin; make someone else an admin first." }), { status: 409 });
    const invoke = vi.fn().mockResolvedValue({ data: null, error: Object.assign(new Error("Edge Function returned a non-2xx status code"), { context }) });
    await expect(setAdminRole({ functions: { invoke } } as never, OTHER, false))
      .resolves.toEqual({ ok: false, error: "This is the last admin; make someone else an admin first." });
  });
});
