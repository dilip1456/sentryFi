import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RESEND_KEY = Deno.env.get("RESEND_API_KEY");
const FCM_SA = Deno.env.get("FCM_SERVICE_ACCOUNT");
const GROQ_KEY = Deno.env.get("GROQ_API_KEY");
const FCM_PROJECT = "sentryfiapp";

async function getFCMToken(): Promise<string | null> {
  if (!FCM_SA) return null;
  try {
    const sa = JSON.parse(FCM_SA);
    const now = Math.floor(Date.now() / 1000);
    const toB64 = (s: string) => btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"");
    const header = toB64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claimSet = toB64(JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600, iat: now,
    }));
    const pemKey = sa.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\\n|\n/g, "");
    const binaryKey = Uint8Array.from(atob(pemKey), (c) => c.charCodeAt(0));
    const cryptoKey = await crypto.subtle.importKey(
      "pkcs8", binaryKey,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false, ["sign"]
    );
    const sigInput = `${header}.${claimSet}`;
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(sigInput));
    const sigB64 = toB64(String.fromCharCode(...new Uint8Array(sig)));
    const jwt = `${sigInput}.${sigB64}`;
    const grantType = "urn:ietf:params:oauth:grant-type:jwt-bearer";
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=${encodeURIComponent(grantType)}&assertion=${jwt}`,
    });
    const data = await res.json();
    return data.access_token ?? null;
  } catch (e) { console.error("[fcm token]", e); return null; }
}

async function sendPush(tokens: string[], title: string, body: string) {
  const token = await getFCMToken();
  if (!token || !tokens.length) return;
  await Promise.allSettled(tokens.map((t) =>
    fetch(`https://fcm.googleapis.com/v1/projects/${FCM_PROJECT}/messages:send`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { token: t, notification: { title, body }, android: { priority: "high" } } }),
    })
  ));
}

async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_KEY) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "Sentry Finance <alerts@sentryfi.app>", to, subject, html }),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const today = new Date().toISOString().slice(0, 10);
    const monthKey = today.slice(0, 7);
    const monthStart = `${monthKey}-01`;

    const { data: prefs } = await admin.from("alert_preferences").select("*");
    if (!prefs?.length) return json({ ok: true, processed: 0 });

    let sent = 0;
    for (const pref of prefs) {
      const userId = pref.user_id;
      const notifications: { title: string; body: string }[] = [];

      const { data: { user } } = await admin.auth.admin.getUserById(userId);
      const toEmail = pref.email || user?.email;
      const { data: pushTokenRows } = await admin.from("push_tokens").select("token").eq("user_id", userId);
      const pushTokens = (pushTokenRows ?? []).map((r: any) => r.token);

      // 1. Budget thresholds
      const { data: settingsRow } = await admin.from("user_settings").select("budgets").eq("user_id", userId).maybeSingle();
      const budgets: Record<string, number> = settingsRow?.budgets ?? {};
      const { data: txns } = await admin.from("plaid_transactions").select("amount,category").eq("user_id", userId).gte("date", monthStart).gt("amount", 0);
      const catTotals: Record<string, number> = {};
      for (const t of txns ?? []) {
        const cat = t.category?.[0] ?? "Other";
        catTotals[cat] = (catTotals[cat] ?? 0) + Number(t.amount);
      }
      for (const [cat, budget] of Object.entries(budgets)) {
        const spent = catTotals[cat] ?? 0;
        if ((spent / budget) * 100 < (pref.budget_pct ?? 90)) continue;
        const alertKey = `budget:${cat}:${monthKey}`;
        const { data: ex } = await admin.from("alert_log").select("id").eq("user_id", userId).eq("alert_key", alertKey).maybeSingle();
        if (ex) continue;
        const over = spent > budget;
        notifications.push({
          title: over ? `\uD83D\uDD34 ${cat} over budget` : `\uD83D\uDFE1 ${cat} at ${Math.round((spent / budget) * 100)}%`,
          body: over ? `$${spent.toFixed(0)} vs $${budget}` : `$${(budget - spent).toFixed(0)} remaining`,
        });
        await admin.from("alert_log").insert({ user_id: userId, alert_type: "budget_threshold", alert_key: alertKey });
      }

      // 2. Low balance
      const { data: accounts } = await admin.from("plaid_accounts").select("account_id,name,current_balance,subtype").eq("user_id", userId);
      for (const acc of (accounts ?? []).filter((a: any) => a.subtype === "checking")) {
        const bal = Number(acc.current_balance ?? 0);
        if (bal >= (pref.low_balance ?? 100)) continue;
        const alertKey = `low_balance:${acc.account_id}:${today}`;
        const { data: ex } = await admin.from("alert_log").select("id").eq("user_id", userId).eq("alert_key", alertKey).maybeSingle();
        if (ex) continue;
        notifications.push({ title: `\u26A0\uFE0F Low balance: ${acc.name}`, body: `$${bal.toFixed(2)} remaining` });
        await admin.from("alert_log").insert({ user_id: userId, alert_type: "low_balance", alert_key: alertKey });
      }

      // 3. Payment due
      const { data: creditDetails } = await admin.from("plaid_credit_details").select("*").eq("user_id", userId);
      for (const cd of creditDetails ?? []) {
        if (!cd.next_payment_due_date) continue;
        const daysUntil = Math.round((new Date(cd.next_payment_due_date).getTime() - Date.now()) / 86400000);
        if (daysUntil < 0 || daysUntil > (pref.payment_days ?? 3)) continue;
        const alertKey = `payment_due:${cd.account_id}:${cd.next_payment_due_date}`;
        const { data: ex } = await admin.from("alert_log").select("id").eq("user_id", userId).eq("alert_key", alertKey).maybeSingle();
        if (ex) continue;
        const acc = (accounts ?? []).find((a: any) => a.account_id === cd.account_id);
        notifications.push({
          title: `\uD83D\uDCB3 Payment due ${daysUntil === 0 ? "today" : `in ${daysUntil}d`}`,
          body: `${acc?.name ?? "Card"}: min $${cd.minimum_payment_amount?.toFixed(2) ?? "-"}`,
        });
        await admin.from("alert_log").insert({ user_id: userId, alert_type: "payment_due", alert_key: alertKey });
      }

      // 4. New high-severity AI insights
      const { data: lastInsight } = await admin.from("ai_insights").select("created_at,insights").eq("user_id", userId).maybeSingle();
      if (lastInsight?.insights) {
        const insights = Array.isArray(lastInsight.insights) ? lastInsight.insights as any[] : [];
        const highSeverity = insights.filter((i: any) => i.severity === "high");
        if (highSeverity.length > 0) {
          const insightHash = highSeverity.map((i: any) => i.id).sort().join(",");
          const alertKey = `insights:${insightHash.slice(0, 40)}`;
          const { data: ex } = await admin.from("alert_log").select("id").eq("user_id", userId).eq("alert_key", alertKey).maybeSingle();
          if (!ex) {
            notifications.push({
              title: "\uD83D\uDCA1 New financial insight",
              body: highSeverity[0].title ?? "Check your Sentry Finance dashboard",
            });
            await admin.from("alert_log").insert({ user_id: userId, alert_type: "insight", alert_key: alertKey });
          }
        }
      }

      if (!notifications.length) continue;

      // Push each notification
      if (pref.push_enabled !== false && pushTokens.length) {
        for (const n of notifications) {
          await sendPush(pushTokens, n.title, n.body);
        }
      }

      // Summary email
      if (pref.email_enabled !== false && toEmail) {
        const subject = notifications.length === 1 ? notifications[0].title : `${notifications.length} alerts — Sentry Finance`;
        const html = `<!DOCTYPE html><html><body style="background:#111827;font-family:system-ui;padding:24px">
<h2 style="color:#F9F6EF;margin-bottom:16px">Sentry Finance</h2>
${notifications.map((n) => `<div style="background:#1E2A40;border-radius:8px;padding:12px;margin-bottom:8px"><b style="color:#F9F6EF">${n.title}</b><br><span style="color:#8FA3BA;font-size:13px">${n.body}</span></div>`).join("")}
<p style="color:#4B5C70;font-size:11px;margin-top:16px"><a href="https://sentryfiapp.vercel.app" style="color:#D4920E">Open Sentry Finance</a></p>
</body></html>`;
        await sendEmail(toEmail, subject, html);
      }

      sent++;
    }
    return json({ ok: true, processed: prefs.length, sent, ts: new Date().toISOString() });
  } catch (e) { console.error(e); return json({ error: String(e) }, 500); }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
