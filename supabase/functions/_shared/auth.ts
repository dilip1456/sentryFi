// Shared caller checks for edge functions (security audit M1).
//
// verify_jwt (on by default, see supabase/config.toml) only proves the request
// carries *a* valid project JWT, and the public anon key is one. Functions that
// spend money or act on other users' data must also check *who* is calling.
import { createClient, type User } from "npm:@supabase/supabase-js@2.106.2";

/**
 * Resolve the signed-in user from the Authorization header.
 * Returns null for a missing header, the anon key, or an invalid/expired token.
 */
export async function getCallerUser(req: Request): Promise<User | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return null;
  return user;
}

async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}

/** Constant-time string comparison (hash first so lengths never leak). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha[i] ^ hb[i];
  return diff === 0;
}

/**
 * True only for trusted server-side callers:
 *   - pg_cron, sending `x-cron-secret: <CRON_SECRET>`, or
 *   - anything holding the service_role key (Authorization: Bearer or apikey).
 * The anon key and user JWTs are rejected.
 */
export async function isTrustedServerCaller(req: Request): Promise<boolean> {
  const cronSecret = Deno.env.get("CRON_SECRET");
  const sentSecret = req.headers.get("x-cron-secret");
  if (cronSecret && cronSecret.length >= 16 && sentSecret && await safeEqual(sentSecret, cronSecret)) {
    return true;
  }

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) return false;
  const bearer = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const apikey = req.headers.get("apikey") ?? "";
  return (bearer !== "" && await safeEqual(bearer, serviceKey)) ||
    (apikey !== "" && await safeEqual(apikey, serviceKey));
}
