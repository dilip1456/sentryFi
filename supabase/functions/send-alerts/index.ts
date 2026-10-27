import { createClient } from "npm:@supabase/supabase-js@2.106.2";
import { cleanBankText, merchantKey } from "../_shared/merchant-name.ts";
import { classifyAll, isBudgetableType, normalisePlaidCategory, type Classification, type ClassifierAccount, type ClassifierTxn, type TxnType } from "../_shared/classify/index.ts";
import { isTrustedServerCaller } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Values in the alert email come from bank data (merchant names, account
// names) and AI output, so escape them before putting them into HTML (audit L3).
function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const RESEND_KEY = Deno.env.get("RESEND_API_KEY");
const FCM_SA = Deno.env.get("FCM_SERVICE_ACCOUNT");
const FCM_PROJECT = "sentryfiapp";

async function getFCMToken(): Promise<string | null> {
  if (!FCM_SA) return null;
  try {
    const sa = JSON.parse(FCM_SA);
    const now = Math.floor(Date.now() / 1000);
    const toB64 = (s: string) => btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"");
    const header = toB64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claim = toB64(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", exp: now + 3600, iat: now }));
    const pem = sa.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\\n|\n/g, "");
    const key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), c => c.charCodeAt(0)), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claim}`));
    const jwt = `${header}.${claim}.${toB64(String.fromCharCode(...new Uint8Array(sig)))}`;
    const grantType = "urn:ietf:params:oauth:grant-type:jwt-bearer";
    const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `grant_type=${encodeURIComponent(grantType)}&assertion=${jwt}` });
    return (await r.json()).access_token ?? null;
  } catch (e) { console.error("[fcm]", e); return null; }
}

async function sendPush(tokens: string[], title: string, body: string) {
  const token = await getFCMToken();
  if (!token || !tokens.length) return;
  await Promise.allSettled(tokens.map(t =>
    fetch(`https://fcm.googleapis.com/v1/projects/${FCM_PROJECT}/messages:send`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { token: t, notification: { title, body }, android: { priority: "high" } } }),
    })
  ));
}

// Atomic "insert if new" against a unique (user_id, alert_key) constraint —
// this replaces a prior check-then-insert (SELECT, then INSERT if nothing
// found) which was NOT atomic: overlapping cron runs could both pass the
// SELECT before either INSERT landed, sending the same alert dozens of times
// a day. ignoreDuplicates makes the upsert a no-op (empty `data`) when the
// key already exists, so `saveAlert` only ever returns true once per key.
async function saveAlert(admin: any, userId: string, alertType: string, alertKey: string, title: string, body: string, payload: Record<string, any> = {}) {
  const { data, error } = await admin.from("alert_log")
    .upsert(
      { user_id: userId, alert_type: alertType, alert_key: alertKey, title, body, payload, created_at: new Date().toISOString() },
      { onConflict: "user_id,alert_key", ignoreDuplicates: true }
    )
    .select("id");
  if (error) { console.error("[alert_log]", alertKey, error); return false; }
  return (data?.length ?? 0) > 0;
}

// "$1,234.56" — the old `$${n.toFixed(2)}` had no thousands separators.
const usd = (n: number, cents = true) =>
  Number(n ?? 0).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
// "Oct 24" for a YYYY-MM-DD date.
const shortDate = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};
// Pending and posted copies of one charge get different transaction_ids, so
// key "per transaction" alerts on what doesn't change between them.
const txnAlertKey = (kind: string, t: { account_id: string; amount: number | string; authorized_date?: string | null; date: string; merchant_name?: string | null; name?: string | null }) =>
  `${kind}:${t.account_id}:${Math.round(Math.abs(Number(t.amount)) * 100)}:${t.authorized_date ?? t.date}:${merchantKey(t.merchant_name ?? t.name ?? "").slice(0, 32)}`;

// Per-category opt-out — defaults to enabled (`!== false`) so existing users
// keep getting every alert type they already get today unless they've
// explicitly turned one off in Notification Preferences.
function categoryEnabled(pref: any, key: string): boolean {
  return pref[key] !== false;
}

// Keywords that indicate a credit card payment / transfer (NOT a real deposit)
const CC_PAYMENT_PATTERNS = [
  /autopay/i, /auto.?pay/i,
  /payment.{0,20}thank/i, /thank.{0,20}payment/i,
  /online payment/i, /mobile payment/i,
  /payment received/i, /payment posted/i,
  /credit card payment/i, /card payment/i,
  /e-payment/i, /epayment/i,
  /transfer from/i, /xfer from/i,
  /ach credit/i,
  /citi payment/i, /chase payment/i, /amex payment/i,
  /discover payment/i, /capital one payment/i,
  /bank of america payment/i,
];

const TRANSFER_PATTERNS = [
  /transfer/i, /zelle/i, /venmo/i, /cash app/i, /paypal/i,
  /square cash/i, /google pay/i, /apple pay send/i,
];

function creditKind(type: TxnType): "cc_payment" | "transfer" | "refund" | "deposit" {
  if (type === "credit_card_payment") return "cc_payment";
  if (type === "refund") return "refund";
  if (type === "transfer_internal" || type === "savings_contribution" || type === "transfer_in" || type === "transfer_out") return "transfer";
  return "deposit";
}

// Fallback: classify what a negative-amount transaction (credit) actually is
function classifyCredit(t: { name: string | null; merchant_name: string | null; category: string[] | null }): "cc_payment" | "transfer" | "refund" | "deposit" {
  const name = (t.merchant_name ?? t.name ?? "").toLowerCase();
  const cats = (t.category ?? []).map((c: string) => c.toLowerCase());

  // Plaid category hints
  if (cats.some(c => c.includes("credit card") || c.includes("loan payment"))) return "cc_payment";
  if (cats.some(c => c.includes("transfer"))) return "transfer";

  // Name pattern matching
  if (CC_PAYMENT_PATTERNS.some(rx => rx.test(name))) return "cc_payment";
  if (TRANSFER_PATTERNS.some(rx => rx.test(name))) return "transfer";

  return "deposit";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  // Security audit M1: this function uses service_role and loops over every
  // user, so only pg_cron (x-cron-secret) or a service_role caller may run it.
  // The public anon key and normal user sessions are rejected.
  if (!(await isTrustedServerCaller(req))) return json({ error: "Forbidden" }, 403);
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const today = new Date().toISOString().slice(0, 10);
    const monthKey = today.slice(0, 7);
    const monthStart = `${monthKey}-01`;
    const now = Date.now();

    const { data: prefs } = await admin.from("alert_preferences").select("*");
    if (!prefs?.length) return json({ ok: true, processed: 0 });

    let totalSent = 0;

    for (const pref of prefs) {
      const userId = pref.user_id;
      const notifications: { title: string; body: string }[] = [];

      const { data: { user } } = await admin.auth.admin.getUserById(userId);
      const toEmail = pref.email || user?.email;
      const { data: pushTokenRows } = await admin.from("push_tokens").select("token").eq("user_id", userId);
      const pushTokens = (pushTokenRows ?? []).map((r: any) => r.token);

      const { data: accounts } = await admin.from("plaid_accounts")
        .select("account_id,item_id,name,mask,current_balance,available_balance,type,subtype")
        .eq("user_id", userId);

      // ── 1. Budget threshold ──────────────────────────────────────────
      // Uses the SAME classifier as the app (../_shared/classify): the user's
      // per-transaction types and categories, their merchant rules, linked-
      // account transfer pairs, card payments and savings moves are all
      // applied, and only spend categories count toward a budget. (The old
      // version summed raw Plaid category[0] for every positive amount, so
      // card payments, savings sweeps and transfers tripped budget alerts.)
      const { data: settingsRow } = await admin.from("user_settings")
        .select("budgets,cat_overrides,cat_rules,manual_internal,manual_external,account_roles")
        .eq("user_id", userId).maybeSingle();
      const budgets: Record<string, number> = settingsRow?.budgets ?? {};
      const catOverrides: Record<string, string> = settingsRow?.cat_overrides ?? {};
      const catRules: { pattern: string; category: string; matchType?: string; enabled?: boolean; source?: string }[] = settingsRow?.cat_rules ?? [];
      const manualInternal = new Set<string>(settingsRow?.manual_internal ?? []);
      const manualExternal = new Set<string>(settingsRow?.manual_external ?? []);
      const roles: Record<string, { role: string }> = settingsRow?.account_roles ?? {};
      const ruleCategory = (t: ClassifierTxn): string | null => {
        const m = (t.merchant_name ?? t.name ?? "").toLowerCase();
        if (!m) return null;
        const ordered = [...catRules.filter(r => r.source === "user"), ...catRules.filter(r => r.source !== "user")];
        const hit = ordered.find(r => {
          if (r.enabled === false) return false;
          const p = (r.pattern ?? "").toLowerCase();
          if (p.length < 2) return false;
          return r.matchType === "exact" ? m === p : r.matchType === "starts_with" ? m.startsWith(p) : m.includes(p);
        });
        return hit?.category ?? null;
      };
      // Look back a few extra days so transfer legs that straddle the 1st still pair.
      const classifyFrom = new Date(Math.min(Date.parse(monthStart), now - 2 * 86400000) - 6 * 86400000).toISOString().slice(0, 10);
      const { data: recentAll } = await admin.from("plaid_transactions")
        .select("*").eq("user_id", userId).gte("date", classifyFrom);
      const { data: typeRows, error: typeErr } = await admin.from("txn_overrides").select("transaction_id,txn_type").eq("user_id", userId);
      if (typeErr) console.warn("txn_overrides unavailable (migration not applied?)", typeErr.message);
      const typeByPlaidId: Record<string, TxnType> = {};
      for (const r of typeRows ?? []) typeByPlaidId[r.transaction_id] = r.txn_type;
      const ctxTxns = (recentAll ?? []) as ClassifierTxn[];
      const typeOverrides: Record<string, TxnType> = {};
      for (const t of ctxTxns) {
        const ov = t.transaction_id ? typeByPlaidId[t.transaction_id] : undefined;
        if (ov) typeOverrides[t.id] = ov;
        else if (manualInternal.has(t.id) && !manualExternal.has(t.id)) typeOverrides[t.id] = "transfer_internal";
      }
      type AcctRow = { account_id: string; item_id?: string | null; name?: string | null; mask?: string | null; type: string | null; subtype: string | null };
      const roleOf = (a: AcctRow) => roles[a.account_id]?.role ??
        (a.type === "credit" || a.type === "loan" ? "debt" : a.type === "investment" ? "investment" : a.subtype === "checking" ? "spending" : "unassigned");
      const classes: Map<string, Classification> = classifyAll(ctxTxns, {
        accounts: ((accounts ?? []) as AcctRow[]).map(a => ({ ...a, role: roleOf(a) as ClassifierAccount["role"] })),
        typeOverrides,
        categoryOverrides: catOverrides,
        ruleCategory,
        notInternalIds: manualExternal,
        plaidCategory: t => normalisePlaidCategory(t.category, t.merchant_name, t.name),
      });
      const categoryOf = (t: ClassifierTxn) =>
        catOverrides[t.id] ?? ruleCategory(t) ?? normalisePlaidCategory(t.category, t.merchant_name, t.name) ?? "Other";
      const catTotals: Record<string, number> = {};
      for (const t of ctxTxns) {
        if (t.date < monthStart) continue;
        const c = classes.get(t.id);
        if (!c || !isBudgetableType(c.type)) continue;
        const cat = categoryOf(t);
        catTotals[cat] = (catTotals[cat] ?? 0) + Number(t.amount); // refunds net out
      }
      if (categoryEnabled(pref, "alert_budget_threshold")) {
        for (const [cat, budget] of Object.entries(budgets)) {
          const spent = catTotals[cat] ?? 0;
          if ((spent / budget) * 100 < (pref.budget_pct ?? 90)) continue;
          const over = spent > budget;
          const title = over ? `🔴 ${cat} over budget` : `🟡 ${cat} at ${Math.round((spent/budget)*100)}%`;
          const body = over ? `${usd(spent, false)} spent of your ${usd(budget, false)} budget` : `${usd(budget - spent, false)} left of ${usd(budget, false)}`;
          const added = await saveAlert(admin, userId, "budget_threshold", `budget:${cat}:${monthKey}`, title, body, { category: cat, spent, budget });
          if (added) notifications.push({ title, body });
        }
      }

      // ── 2. Low balance ───────────────────────────────────────────────
      if (categoryEnabled(pref, "alert_low_balance")) {
        for (const acc of (accounts ?? []).filter((a: any) => a.subtype === "checking" || a.subtype === "savings")) {
          const bal = Number(acc.current_balance ?? 0);
          const threshold = pref.low_balance ?? 100;
          if (bal >= threshold) continue;
          const title = `⚠️ Low balance: ${acc.name}`;
          const body = `${usd(bal)} available`;
          // One alert per account per month (was one per day while the
          // balance stayed low, which flooded the inbox with copies).
          const added = await saveAlert(admin, userId, "low_balance", `low_balance:${acc.account_id}:${monthKey}`, title, body, { account_id: acc.account_id, balance: bal });
          if (added) notifications.push({ title, body });
        }
      }

      // ── 3. Payment due ───────────────────────────────────────────────
      if (categoryEnabled(pref, "alert_payment_due")) {
        const { data: creditDetails } = await admin.from("plaid_credit_details").select("*").eq("user_id", userId);
        for (const cd of creditDetails ?? []) {
          if (!cd.next_payment_due_date) continue;
          const daysUntil = Math.round((new Date(cd.next_payment_due_date).getTime() - now) / 86400000);
          if (daysUntil < 0 || daysUntil > (pref.payment_days ?? 3)) continue;
          // Already paid this cycle (a payment at least the minimum posted in
          // the 25 days before the due date) — don't nag.
          const dueMs = new Date(cd.next_payment_due_date).getTime();
          const paidMs = cd.last_payment_date ? new Date(cd.last_payment_date).getTime() : NaN;
          if (Number.isFinite(paidMs) && paidMs >= dueMs - 25 * 86400000 &&
              Number(cd.last_payment_amount ?? 0) >= Number(cd.minimum_payment_amount ?? 0)) continue;
          const acc = (accounts ?? []).find((a: any) => a.account_id === cd.account_id);
          const title = `💳 ${acc?.name ?? "Card"} payment due ${daysUntil === 0 ? "today" : daysUntil === 1 ? "tomorrow" : shortDate(cd.next_payment_due_date)}`;
          const body = cd.minimum_payment_amount != null ? `Minimum ${usd(cd.minimum_payment_amount)} due ${shortDate(cd.next_payment_due_date)}` : `Due ${shortDate(cd.next_payment_due_date)}`;
          const added = await saveAlert(admin, userId, "payment_due", `payment_due:${cd.account_id}:${cd.next_payment_due_date}`, title, body,
            { account_id: cd.account_id, due_date: cd.next_payment_due_date, min_payment: cd.minimum_payment_amount, days_until: daysUntil });
          if (added) notifications.push({ title, body });
        }
      }

      // ── 4. Large / unusual transactions ─────────────────────────────
      const yesterday = new Date(now - 86400000).toISOString().slice(0, 10);
      if (categoryEnabled(pref, "alert_large_txn")) {
        const { data: recentTxns } = await admin.from("plaid_transactions")
          .select("transaction_id,name,merchant_name,amount,date,authorized_date,category,account_id")
          .eq("user_id", userId).gte("date", yesterday).gt("amount", 0).order("amount", { ascending: false }).limit(50);

        const threeMonthsAgo = new Date(now - 90 * 86400000).toISOString().slice(0, 10);
        const { data: histTxns } = await admin.from("plaid_transactions")
          .select("amount").eq("user_id", userId).gte("date", threeMonthsAgo).lt("date", yesterday).gt("amount", 0);
        const avgMonthly = (histTxns ?? []).reduce((s: number, t: any) => s + Number(t.amount), 0) / 3;
        const largeThreshold = Math.max(avgMonthly * 0.15, 150);

        for (const t of recentTxns ?? []) {
          const amt = Number(t.amount);
          if (amt < largeThreshold) break;
          const merchant = cleanBankText(t.merchant_name ?? t.name) || "Unknown";
          const title = `💰 Large charge: ${merchant}`;
          const body = t.category?.[0] ? `${usd(amt)} · ${t.category[0]}` : usd(amt);
          const added = await saveAlert(admin, userId, "large_txn", txnAlertKey("large_txn", t), title, body,
            { transaction_id: t.transaction_id, amount: amt, merchant, category: t.category?.[0], account_id: t.account_id, date: t.date });
          if (added) notifications.push({ title, body });
        }
      }

      // ── 5. Credits: classify before alerting ─────────────────────────
      // Negative amount = money coming in (deposit, refund, CC payment, transfer)
      // We split into buckets and message accordingly. CC payments and internal
      // transfers are silently skipped — they are NOT deposits.
      const { data: credits } = await admin.from("plaid_transactions")
        .select("transaction_id,name,merchant_name,amount,date,authorized_date,account_id,category")
        .eq("user_id", userId).gte("date", yesterday).lt("amount", 0);

      for (const t of credits ?? []) {
        const amt = Math.abs(Number(t.amount));
        if (amt < 1) continue;
        const merchant = cleanBankText(t.merchant_name ?? t.name) || "Unknown";
        // Shared classifier first (pairs, card payments, overrides); the old
        // name/category heuristic is only a fallback for rows outside the window.
        const cls = classes.get((ctxTxns.find(x => x.transaction_id === t.transaction_id)?.id) ?? "");
        const kind = cls ? creditKind(cls.type) : classifyCredit(t);

        if (kind === "cc_payment") {
          if (!categoryEnabled(pref, "alert_cc_payment")) continue;
          // This is a credit card payment being received by the card — not a deposit
          // Notify as a payment confirmation, not deposit
          const acct = (accounts ?? []).find((a: any) => a.account_id === t.account_id);
          const title = `✅ Payment posted: ${acct?.name ?? merchant}`;
          const body = `${usd(amt)} payment applied to your account`;
          const added = await saveAlert(admin, userId, "cc_payment_posted", txnAlertKey("cc_payment", t), title, body,
            { transaction_id: t.transaction_id, amount: amt, merchant, account_id: t.account_id, date: t.date });
          if (added) notifications.push({ title, body });
          continue;
        }

        if (kind === "transfer") {
          if (!categoryEnabled(pref, "alert_transfer")) continue;
          // Transfer between accounts — only alert if > $200 to avoid noise
          if (amt < 200) continue;
          const title = `↔️ Transfer: ${usd(amt)}`;
          const body = `From ${merchant}`;
          const added = await saveAlert(admin, userId, "transfer", txnAlertKey("transfer", t), title, body,
            { transaction_id: t.transaction_id, amount: amt, merchant, account_id: t.account_id, date: t.date });
          if (added) notifications.push({ title, body });
          continue;
        }

        if (kind === "refund") {
          if (!categoryEnabled(pref, "alert_refund")) continue;
          // Refunds under $5 are noise
          if (amt < 5) continue;
          const title = `↩️ Refund: ${usd(amt)} from ${merchant}`;
          const body = `Credit applied to your account`;
          const added = await saveAlert(admin, userId, "refund", txnAlertKey("refund", t), title, body,
            { transaction_id: t.transaction_id, amount: amt, merchant, account_id: t.account_id, date: t.date });
          if (added) notifications.push({ title, body });
          continue;
        }

        // True deposit (paycheck, ACH income, etc.)
        if (kind === "deposit" && amt >= 50 && categoryEnabled(pref, "alert_deposit")) {
          const title = `📥 Deposit: ${usd(amt)}`;
          const body = `From ${merchant}`;
          const added = await saveAlert(admin, userId, "deposit", txnAlertKey("deposit", t), title, body,
            { transaction_id: t.transaction_id, amount: amt, merchant, account_id: t.account_id, date: t.date });
          if (added) notifications.push({ title, body });
        }
      }

      // ── 6. High-severity AI insights ─────────────────────────────────
      const { data: lastInsight } = categoryEnabled(pref, "alert_insight")
        ? await admin.from("ai_insights").select("created_at,insights").eq("user_id", userId).maybeSingle()
        : { data: null };
      if (lastInsight?.insights) {
        const insights = Array.isArray(lastInsight.insights) ? lastInsight.insights as any[] : [];
        const highSeverity = insights.filter((i: any) => i.severity === "high");
        if (highSeverity.length > 0) {
          const hash = highSeverity.map((i: any) => i.id).sort().join(",").slice(0, 60);
          const title = `💡 ${highSeverity[0].title}`;
          const body = highSeverity[0].what?.slice(0, 100) ?? "Check your Sentry Finance dashboard";
          const added = await saveAlert(admin, userId, "insight", `insights:${hash}`, title, body,
            { insights: highSeverity.slice(0, 3) });
          if (added) notifications.push({ title, body });
        }
      }

      if (!notifications.length) continue;

      // Push
      if (pref.push_enabled !== false && pushTokens.length) {
        for (const n of notifications) await sendPush(pushTokens, n.title, n.body);
      }

      // Email summary
      if (pref.email_enabled !== false && toEmail) {
        const subject = notifications.length === 1 ? notifications[0].title : `${notifications.length} alerts - Sentry Finance`;
        const html = `<!DOCTYPE html><html><body style="background:#111827;font-family:system-ui;padding:24px">
<h2 style="color:#F9F6EF;margin-bottom:16px">Sentry Finance</h2>
${notifications.map(n => `<div style="background:#1E2A40;border-radius:8px;padding:12px;margin-bottom:8px"><b style="color:#F9F6EF">${escapeHtml(n.title)}</b><br><span style="color:#8FA3BA;font-size:13px">${escapeHtml(n.body)}</span></div>`).join("")}
<p style="color:#4B5C70;font-size:11px;margin-top:16px"><a href="https://sentryfiapp.vercel.app" style="color:#D4920E">Open Sentry Finance</a></p>
</body></html>`;
        if (RESEND_KEY) {
          await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: "Sentry Finance <alerts@sentryfi.app>", to: toEmail, subject, html }) });
        }
      }

      totalSent++;
    }

    return json({ ok: true, processed: prefs.length, sent: totalSent, ts: new Date().toISOString() });
  } catch (e) { console.error(e); return json({ error: "send-alerts failed" }, 500); }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
