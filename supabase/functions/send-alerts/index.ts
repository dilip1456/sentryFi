import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RESEND_KEY = Deno.env.get("RESEND_API_KEY");

async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_KEY) { console.warn("No RESEND_API_KEY set"); return false; }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Sentry Finance <alerts@sentryfi.app>",
      to, subject, html,
    }),
  });
  return res.ok;
}

const emailHtml = (title: string, items: { icon: string; heading: string; body: string }[]) => `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#111827;font-family:system-ui,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
    <div style="font-size:20px;font-weight:700;color:#F9F6EF">Sentry Finance</div>
  </div>
  <h1 style="font-size:22px;font-weight:800;color:#F9F6EF;margin:0 0 20px">${title}</h1>
  ${items.map(item => `
  <div style="background:#1E2A40;border-radius:12px;padding:16px;margin-bottom:12px">
    <div style="display:flex;align-items:flex-start;gap:12px">
      <div style="font-size:24px;flex-shrink:0">${item.icon}</div>
      <div>
        <div style="font-size:15px;font-weight:600;color:#F9F6EF;margin-bottom:4px">${item.heading}</div>
        <div style="font-size:13px;color:#8FA3BA;line-height:1.5">${item.body}</div>
      </div>
    </div>
  </div>`).join("")}
  <div style="margin-top:24px;padding-top:16px;border-top:1px solid #1E2A40;font-size:11px;color:#4B5C70">
    Open Sentry Finance to take action. 
    <a href="https://sentryfiapp.vercel.app" style="color:#D4920E">Open app →</a>
  </div>
</div>
</body>
</html>
`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const today = new Date().toISOString().slice(0, 10);
    const monthKey = today.slice(0, 7);

    // Get all users with alerts enabled
    const { data: prefs } = await admin
      .from("alert_preferences")
      .select("*")
      .eq("email_enabled", true);

    if (!prefs?.length) return json({ ok: true, processed: 0 });

    let sent = 0;

    for (const pref of prefs) {
      const userId = pref.user_id;
      const alerts: { icon: string; heading: string; body: string }[] = [];

      // Get user's auth email if no override
      const { data: { user } } = await admin.auth.admin.getUserById(userId);
      const toEmail = pref.email || user?.email;
      if (!toEmail) continue;

      // Get user settings (budgets, account roles)
      const { data: settingsRow } = await admin
        .from("user_settings")
        .select("budgets, account_roles, cat_overrides")
        .eq("user_id", userId)
        .maybeSingle();

      const budgets: Record<string, number> = settingsRow?.budgets ?? {};

      // Get this month's transactions
      const monthStart = `${monthKey}-01`;
      const { data: txns } = await admin
        .from("plaid_transactions")
        .select("amount, category, merchant_name, name")
        .eq("user_id", userId)
        .gte("date", monthStart)
        .gt("amount", 0);

      // Get accounts
      const { data: accounts } = await admin
        .from("plaid_accounts")
        .select("account_id, name, current_balance, type, subtype")
        .eq("user_id", userId);

      // Get credit details for payment due alerts
      const { data: creditDetails } = await admin
        .from("plaid_credit_details")
        .select("*")
        .eq("user_id", userId);

      // ── 1. Budget threshold alerts ──
      const catTotals: Record<string, number> = {};
      for (const t of txns ?? []) {
        const cat = (t.category?.[0]) ?? "Other";
        catTotals[cat] = (catTotals[cat] ?? 0) + Number(t.amount);
      }

      for (const [cat, budget] of Object.entries(budgets)) {
        const spent = catTotals[cat] ?? 0;
        const pct = (spent / budget) * 100;
        if (pct < pref.budget_pct) continue;

        const alertKey = `budget:${cat}:${monthKey}`;
        const { data: existing } = await admin.from("alert_log")
          .select("id").eq("user_id", userId).eq("alert_key", alertKey).maybeSingle();
        if (existing) continue;

        const over = spent > budget;
        alerts.push({
          icon: over ? "🔴" : "🟡",
          heading: over ? `${cat} is over budget` : `${cat} at ${Math.round(pct)}% of budget`,
          body: over
            ? `You've spent $${spent.toFixed(0)} against a $${budget} budget — $${(spent - budget).toFixed(0)} over.`
            : `$${spent.toFixed(0)} of $${budget} budget used. $${(budget - spent).toFixed(0)} left.`,
        });

        await admin.from("alert_log").insert({ user_id: userId, alert_type: "budget_threshold", alert_key: alertKey });
      }

      // ── 2. Low balance alerts ──
      const spendingAccounts = (accounts ?? []).filter(a => a.subtype === "checking" || a.type === "depository");
      for (const acc of spendingAccounts) {
        const bal = Number(acc.current_balance ?? 0);
        if (bal >= pref.low_balance) continue;

        const alertKey = `low_balance:${acc.account_id}:${today}`;
        const { data: existing } = await admin.from("alert_log")
          .select("id").eq("user_id", userId).eq("alert_key", alertKey).maybeSingle();
        if (existing) continue;

        alerts.push({
          icon: "⚠️",
          heading: `Low balance: ${acc.name}`,
          body: `Balance is $${bal.toFixed(2)} — below your $${pref.low_balance} threshold.`,
        });

        await admin.from("alert_log").insert({ user_id: userId, alert_type: "low_balance", alert_key: alertKey });
      }

      // ── 3. Payment due alerts ──
      for (const cd of creditDetails ?? []) {
        if (!cd.next_payment_due_date) continue;
        const dueDate = new Date(cd.next_payment_due_date);
        const daysUntil = Math.round((dueDate.getTime() - Date.now()) / 86400000);
        if (daysUntil < 0 || daysUntil > pref.payment_days) continue;

        const alertKey = `payment_due:${cd.account_id}:${cd.next_payment_due_date}`;
        const { data: existing } = await admin.from("alert_log")
          .select("id").eq("user_id", userId).eq("alert_key", alertKey).maybeSingle();
        if (existing) continue;

        const acc = (accounts ?? []).find(a => a.account_id === cd.account_id);
        alerts.push({
          icon: "💳",
          heading: `Payment due in ${daysUntil === 0 ? "today" : `${daysUntil} day${daysUntil === 1 ? "" : "s"}`}`,
          body: `${acc?.name ?? "Credit card"}: minimum payment $${cd.minimum_payment_amount?.toFixed(2) ?? "—"} due ${cd.next_payment_due_date}.${cd.is_overdue ? " ⚠️ OVERDUE" : ""}`,
        });

        await admin.from("alert_log").insert({ user_id: userId, alert_type: "payment_due", alert_key: alertKey });
      }

      // Send if anything to report
      if (alerts.length > 0) {
        const ok = await sendEmail(
          toEmail,
          `${alerts.length} thing${alerts.length === 1 ? "" : "s"} need your attention — Sentry Finance`,
          emailHtml("Your money needs attention", alerts),
        );
        if (ok) sent++;
      }
    }

    return json({ ok: true, processed: prefs.length, sent });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
