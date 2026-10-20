import { getCallerUser } from "../_shared/auth.ts";
import { summarizeFailedResponse } from "../_shared/http-errors.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GROQ_KEY = Deno.env.get("GROQ_API_KEY");
// llama3-70b-8192 is a decommissioned Groq model (superseded by the 3.1/3.3
// generations, which were themselves later retired too) — every request was
// failing. openai/gpt-oss-120b is Groq's current recommended replacement for
// this capability tier; see https://console.groq.com/docs/deprecations.
const GROQ_MODEL = "openai/gpt-oss-120b";

const CATEGORIES = [
  "Food & Drink", "Groceries", "Transportation", "Travel", "Shopping",
  "Entertainment", "Healthcare", "Bills & Utilities", "Education",
  "Personal Care", "Mortgage Payment", "Rent", "Credit Card Payment",
  "Insurance", "Salary", "Bank Fees", "Business", "Other",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    // Security audit M1: only signed-in users may spend the Groq quota.
    const user = await getCallerUser(req);
    if (!user) return json({ error: "Unauthorized" }, 401);
    if (!GROQ_KEY) return json({ error: "AI categorization is not configured" }, 500);

    const body = await req.json();
    const transactions = (body.transactions ?? []).slice(0, 20);
    if (!transactions.length) return json({ suggestions: [] });

    const lines = transactions.map((t: any) =>
      `${t.id}|"${t.merchant_name || t.name}"|$${Math.abs(t.amount)}|${t.plaid_category}`
    ).join("\n");

    const prompt = `Review these bank transactions. Flag only ones where the category is clearly wrong based on the merchant name. Skip transfers and salary.

Categories: ${CATEGORIES.join(", ")}

id|name|amount|bank_category
${lines}

JSON only, no markdown: {"suggestions":[{"id":"","name":"","current_category":"","suggested_category":"","reason":""}]}
If nothing is wrong return: {"suggestions":[]}`;

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.1,
        max_tokens: 800,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      console.error("[ai-categorize] Groq error:", await summarizeFailedResponse(res));
      return json({ error: "AI categorization is temporarily unavailable" }, 502);
    }
    const rawText = await res.text();

    const data = JSON.parse(rawText);
    const text = data.choices?.[0]?.message?.content ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return json({ suggestions: [] });
    const parsed = JSON.parse(match[0]);
    return json({ suggestions: parsed.suggestions ?? [] });
  } catch (e) {
    console.error("[ai-categorize]", e);
    return json({ error: "AI categorization failed" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
