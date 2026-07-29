import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

async function saveAlert(admin: any, userId: string, alertType: string, alertKey: string, title: string, body: string, payload: Record<string, any> = {}) {
  const { data: ex } = await admin.from("alert_log").select("id").eq("user_id", userId).eq("alert_key", alertKey).maybeSingle();
  if (ex) return false;
  await admin.from("alert_log").insert({ user_id: userId, alert_type: alertType, alert_key: alertKey, title, body, payload, created_at: new Date().toISOString() });
  return true;
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

// Classify what a negative-amount transaction (credit) actually is
function classifyCredit(t: { name: string | null; merchant_name: string | null; category: string[] | null }): "cc_payment" | "transfer" | "refund" | "deposit" {
  const name = (t.merchant_name ?? t.name ?? "").toLowerCase();
  const cats = (t.category ?? []).map((c: string) => c.toLowerCase());

  // Plaid category hints
  if (cats.some(c => c.includes("credit card") || c.includes("loan payment") || c.includes("transfer"))) return "cc_payment";

  // Name pattern matching
  if (CC_PAYMENT_PATTERNS.some(rx => rx.test(name))) return "cc_payment";
  if (TRANSFER_PATTERNS.some(rx => rx.test(name))) return "transfer";

  return "deposit";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
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
        .select("account_id,name,current_balance,available_balance,type,subtype")
        .eq("user_id", userId);

      // ── 1. Budget threshold ──────────────────────────────────────────
      const { data: settingsRow } = await admin.from("user_settings").select("budgets").eq("user_id", userId).maybeSingle();
      const budgets: Record<string, number> = settingsRow?.budgets ?? {};
      const { data: monthTxns } = await admin.from("plaid_transactions")
        .select("amount,category").eq("user_id", userId).gte("date", monthStart).gt("amount", 0);
      const catTotals: Record<string, number> = {};
      for (const t of monthTxns ?? []) { const cat = t.category?.[0] ?? "Other"; catTotals[cat] = (catTotals[cat] ?? 0) + Number(t.amount); }
      for (const [cat, budget] of Object.entries(budgets)) {
        const spent = catTotals[cat] ?? 0;
        if ((spent / budget) * 100 < (pref.budget_pct ?? 90)) continue;
        const over = spent > budget;
        const title = over ? `🔴 ${cat} over budget` : `🟡 ${cat} at ${Math.round((spent/budget)*100)}%`;
        const body = over ? `$${spent.toFixed(0)} spent vs $${budget} budget` : `$${(budget-spent).toFixed(0)} remaining`;
        const added = await saveAlert(admin, userId, "budget_threshold", `budget:${cat}:${monthKey}`, title, body, { category: cat, spent, budget });
        if (added) notifications.push({ title, body });
      }

      // ── 2. Low balance ───────────────────────────────────────────────
      for (const acc of (accounts ?? []).filter((a: any) => a.subtype === "checking" || a.subtype === "savings")) {
        const bal = Number(acc.current_balance ?? 0);
        const threshold = pref.low_balance ?? 100;
        if (bal >= threshold) continue;
        const title = `⚠️ Low balance: ${acc.name}`;
        const body = `$${bal.toFixed(2)} remaining`;
        const added = await saveAlert(admin, userId, "low_balance", `low_balance:${acc.account_id}:${today}`, title, body, { account_id: acc.account_id, balance: bal });
        if (added) notifications.push({ title, body });
      }

      // ── 3. Payment due ───────────────────────────────────────────────
      const { data: creditDetails } = await admin.from("plaid_credit_details").select("*").eq("user_id", userId);
      for (const cd of creditDetails ?? []) {
        if (!cd.next_payment_due_date) continue;
        const daysUntil = Math.round((new Date(cd.next_payment_due_date).getTime() - now) / 86400000);
        if (daysUntil < 0 || daysUntil > (pref.payment_days ?? 3)) continue;
        const acc = (accounts ?? []).find((a: any) => a.account_id === cd.account_id);
        const title = `💳 Payment due ${daysUntil === 0 ? "today" : `in ${daysUntil}d`}`;
        const body = `${acc?.name ?? "Card"}: min $${cd.minimum_payment_amount?.toFixed(2) ?? "-"}`;
        const added = await saveAlert(admin, userId, "payment_due", `payment_due:${cd.account_id}:${cd.next_payment_due_date}`, title, body,
          { account_id: cd.account_id, due_date: cd.next_payment_due_date, min_payment: cd.minimum_payment_amount, days_until: daysUntil });
        if (added) notifications.push({ title, body });
      }

      // ── 4. Large / unusual transactions ─────────────────────────────
      const yesterday = new Date(now - 86400000).toISOString().slice(0, 10);
      const { data: recentTxns } = await admin.from("plaid_transactions")
        .select("transaction_id,name,merchant_name,amount,date,category,account_id")
        .eq("user_id", userId).gte("date", yesterday).gt("amount", 0).order("amount", { ascending: false }).limit(50);

      const threeMonthsAgo = new Date(now - 90 * 86400000).toISOString().slice(0, 10);
      const { data: histTxns } = await admin.from("plaid_transactions")
        .select("amount").eq("user_id", userId).gte("date", threeMonthsAgo).lt("date", yesterday).gt("amount", 0);
      const avgMonthly = (histTxns ?? []).reduce((s: number, t: any) => s + Number(t.amount), 0) / 3;
      const largeThreshold = Math.max(avgMonthly * 0.15, 150);

      for (const t of recentTxns ?? []) {
        const amt = Number(t.amount);
        if (amt < largeThreshold) break;
        const merchant = t.merchant_name ?? t.name;
        const title = `💰 Large charge: ${merchant}`;
        const body = `$${amt.toFixed(2)} — ${t.category?.[0] ?? ""}`;
        const added = await saveAlert(admin, userId, "large_txn", `large_txn:${t.transaction_id}`, title, body,
          { transaction_id: t.transaction_id, amount: amt, merchant, category: t.category?.[0], account_id: t.account_id, date: t.date });
        if (added) notifications.push({ title, body });
      }

      // ── 5. Credits: classify before alerting ─────────────────────────
      // Negative amount = money coming in (deposit, refund, CC payment, transfer)
      // We split into buckets and message accordingly. CC payments and internal
      // transfers are silently skipped — they are NOT deposits.
      const { data: credits } = await admin.from("plaid_transactions")
        .select("transaction_id,name,merchant_name,amount,date,account_id,category")
        .eq("user_id", userId).gte("date", yesterday).lt("amount", 0);

      for (const t of credits ?? []) {
        const amt = Math.abs(Number(t.amount));
        if (amt < 1) continue;
        const merchant = t.merchant_name ?? t.name ?? "Unknown";
        const kind = classifyCredit(t);

        if (kind === "cc_payment") {
          // This is a credit card payment being received by the card — not a deposit
          // Notify as a payment confirmation, not deposit
          const acct = (accounts ?? []).find((a: any) => a.account_id === t.account_id);
          const title = `✅ Payment posted: ${acct?.name ?? merchant}`;
          const body = `$${amt.toFixed(2)} payment applied to your account`;
          const added = await saveAlert(admin, userId, "cc_payment_posted", `cc_payment:${t.transaction_id}`, title, body,
            { transaction_id: t.transaction_id, amount: amt, merchant, account_id: t.account_id, date: t.date });
          if (added) notifications.push({ title, body });
          continue;
        }

        if (kind === "transfer") {
          // Transfer between accounts — only alert if > $200 to avoid noise
          if (amt < 200) continue;
          const title = `↔️ Transfer: $${amt.toFixed(2)}`;
          const body = `From ${merchant}`;
          const added = await saveAlert(admin, userId, "transfer", `transfer:${t.transaction_id}`, title, body,
            { transaction_id: t.transaction_id, amount: amt, merchant, account_id: t.account_id, date: t.date });
          if (added) notifications.push({ title, body });
          continue;
        }

        if (kind === "refund") {
          // Refunds under $5 are noise
          if (amt < 5) continue;
          const title = `↩️ Refund: $${amt.toFixed(2)} from ${merchant}`;
          const body = `Credit applied to your account`;
          const added = await saveAlert(admin, userId, "refund", `refund:${t.transaction_id}`, title, body,
            { transaction_id: t.transaction_id, amount: amt, merchant, account_id: t.account_id, date: t.date });
          if (added) notifications.push({ title, body });
          continue;
        }

        // True deposit (paycheck, ACH income, etc.)
        if (kind === "deposit" && amt >= 50) {
          const title = `📥 Deposit: $${amt.toFixed(2)}`;
          const body = `From ${merchant}`;
          const added = await saveAlert(admin, userId, "deposit", `deposit:${t.transaction_id}`, title, body,
            { transaction_id: t.transaction_id, amount: amt, merchant, account_id: t.account_id, date: t.date });
          if (added) notifications.push({ title, body });
        }
      }

      // ── 6. High-severity AI insights ─────────────────────────────────
      const { data: lastInsight } = await admin.from("ai_insights").select("created_at,insights").eq("user_id", userId).maybeSingle();
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
        const subject = notifications.length === 1 ? notifications[0].title : `${notifications.length} alerts — Sentry Finance`;
        const html = `<!DOCTYPE html><html><body style="background:#111827;font-family:system-ui;padding:24px">
<h2 style="color:#F9F6EF;margin-bottom:16px">Sentry Finance</h2>
${notifications.map(n => `<div style="background:#1E2A40;border-radius:8px;padding:12px;margin-bottom:8px"><b style="color:#F9F6EF">${n.title}</b><br><span style="color:#8FA3BA;font-size:13px">${n.body}</span></div>`).join("")}
<p style="color:#4B5C70;font-size:11px;margin-top:16px"><a href="https://sentryfiapp.vercel.app" style="color:#D4920E">Open Sentry Finance</a></p>
</body></html>`;
        if (RESEND_KEY) {
          await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: "Sentry Finance <alerts@sentryfi.app>", to: toEmail, subject, html }) });
        }
      }

      totalSent++;
    }

    return json({ ok: true, processed: prefs.length, sent: totalSent, ts: new Date().toISOString() });
  } catch (e) { console.error(e); return json({ error: String(e) }, 500); }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
