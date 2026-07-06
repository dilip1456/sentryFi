import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RESEND_KEY = Deno.env.get("RESEND_API_KEY");
const FCM_KEY = Deno.env.get("FCM_SERVER_KEY");

async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_KEY) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "Sentry Finance <alerts@sentryfi.app>", to, subject, html }),
  });
  return res.ok;
}

async function sendPush(tokens: string[], title: string, body: string) {
  if (!FCM_KEY || !tokens.length) return;
  await fetch("https://fcm.googleapis.com/fcm/send", {
    method: "POST",
    headers: { "Authorization": `key=${FCM_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      registration_ids: tokens,
      notification: { title, body, icon: "ic_launcher", sound: "default" },
      priority: "high",
    }),
  });
}

const emailHtml = (items: { icon: string; heading: string; body: string }[]) => `
<!DOCTYPE html><html><body style="background:#111827;font-family:system-ui,sans-serif;margin:0;padding:0">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <div style="font-size:20px;font-weight:700;color:#F9F6EF;margin-bottom:20px">Sentry Finance</div>
  <h1 style="font-size:22px;font-weight:800;color:#F9F6EF;margin:0 0 20px">Your money needs attention</h1>
  ${items.map(i => `<div style="background:#1E2A40;border-radius:12px;padding:16px;margin-bottom:12px">
    <div style="display:flex;align-items:flex-start;gap:12px">
      <div style="font-size:24px">${i.icon}</div>
      <div><div style="font-size:15px;font-weight:600;color:#F9F6EF">${i.heading}</div>
      <div style="font-size:13px;color:#8FA3BA;margin-top:4px">${i.body}</div></div>
    </div></div>`).join("")}
  <div style="margin-top:24px;font-size:11px;color:#4B5C70">
    <a href="https://sentryfiapp.vercel.app" style="color:#D4920E">Open Sentry Finance</a>
  </div>
</div></body></html>`;

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
      const alerts: { icon: string; heading: string; body: string }[] = [];

      const { data: { user } } = await admin.auth.admin.getUserById(userId);
      const toEmail = pref.email || user?.email;

      const { data: settingsRow } = await admin.from("user_settings").select("budgets").eq("user_id", userId).maybeSingle();
      const budgets: Record<string, number> = settingsRow?.budgets ?? {};
      const { data: txns } = await admin.from("plaid_transactions").select("amount,category").eq("user_id", userId).gte("date", monthStart).gt("amount", 0);
      const { data: accounts } = await admin.from("plaid_accounts").select("account_id,name,current_balance,type,subtype").eq("user_id", userId);
      const { data: creditDetails } = await admin.from("plaid_credit_details").select("*").eq("user_id", userId);
      const { data: pushTokenRows } = await admin.from("push_tokens").select("token").eq("user_id", userId);
      const pushTokens = (pushTokenRows ?? []).map((r: any) => r.token);

      // Budget threshold alerts
      const catTotals: Record<string, number> = {};
      for (const t of txns ?? []) { const cat = t.category?.[0] ?? "Other"; catTotals[cat] = (catTotals[cat] ?? 0) + Number(t.amount); }
      for (const [cat, budget] of Object.entries(budgets)) {
        const spent = catTotals[cat] ?? 0;
        if ((spent / budget) * 100 < (pref.budget_pct ?? 90)) continue;
        const alertKey = `budget:${cat}:${monthKey}`;
        const { data: ex } = await admin.from("alert_log").select("id").eq("user_id", userId).eq("alert_key", alertKey).maybeSingle();
        if (ex) continue;
        const over = spent > budget;
        alerts.push({ icon: over ? "🔴" : "🟡", heading: over ? `${cat} over budget` : `${cat} at ${Math.round((spent/budget)*100)}%`, body: over ? `$${spent.toFixed(0)} spent vs $${budget} budget` : `$${(budget-spent).toFixed(0)} remaining` });
        await admin.from("alert_log").insert({ user_id: userId, alert_type: "budget_threshold", alert_key: alertKey });
      }

      // Low balance alerts
      for (const acc of (accounts ?? []).filter((a: any) => a.subtype === "checking")) {
        const bal = Number(acc.current_balance ?? 0);
        if (bal >= (pref.low_balance ?? 100)) continue;
        const alertKey = `low_balance:${acc.account_id}:${today}`;
        const { data: ex } = await admin.from("alert_log").select("id").eq("user_id", userId).eq("alert_key", alertKey).maybeSingle();
        if (ex) continue;
        alerts.push({ icon: "⚠️", heading: `Low balance: ${acc.name}`, body: `$${bal.toFixed(2)} remaining` });
        await admin.from("alert_log").insert({ user_id: userId, alert_type: "low_balance", alert_key: alertKey });
      }

      // Payment due alerts
      for (const cd of creditDetails ?? []) {
        if (!cd.next_payment_due_date) continue;
        const daysUntil = Math.round((new Date(cd.next_payment_due_date).getTime() - Date.now()) / 86400000);
        if (daysUntil < 0 || daysUntil > (pref.payment_days ?? 3)) continue;
        const alertKey = `payment_due:${cd.account_id}:${cd.next_payment_due_date}`;
        const { data: ex } = await admin.from("alert_log").select("id").eq("user_id", userId).eq("alert_key", alertKey).maybeSingle();
        if (ex) continue;
        const acc = (accounts ?? []).find((a: any) => a.account_id === cd.account_id);
        alerts.push({ icon: "💳", heading: `Payment due ${daysUntil === 0 ? "today" : `in ${daysUntil}d`}`, body: `${acc?.name ?? "Card"}: min $${cd.minimum_payment_amount?.toFixed(2) ?? "—"}` });
        await admin.from("alert_log").insert({ user_id: userId, alert_type: "payment_due", alert_key: alertKey });
      }

      if (!alerts.length) continue;

      const summary = alerts.length === 1 ? alerts[0].heading : `${alerts.length} items need attention`;

      // Send email
      if (pref.email_enabled !== false && toEmail) {
        await sendEmail(toEmail, summary + " — Sentry Finance", emailHtml(alerts));
      }

      // Send push
      if (pref.push_enabled !== false && pushTokens.length) {
        await sendPush(pushTokens, "Sentry Finance", summary);
      }

      sent++;
    }
    return json({ ok: true, processed: prefs.length, sent });
  } catch (e) { console.error(e); return json({ error: String(e) }, 500); }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
