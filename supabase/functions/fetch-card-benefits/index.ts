import { getCallerUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const GROQ_KEY = Deno.env.get("GROQ_API_KEY");
// llama3-70b-8192 is a decommissioned Groq model — same issue as
// ai-categorize and analyze-finances. openai/gpt-oss-120b is Groq's current
// recommended replacement; see https://console.groq.com/docs/deprecations.
const GROQ_MODEL = "openai/gpt-oss-120b";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    // Security audit M1: only signed-in users may spend the Groq quota.
    const user = await getCallerUser(req);
    if (!user) return json({ error: "Unauthorized" }, 401);
    if (!GROQ_KEY) return json({ error: "Card benefits lookup is not configured" }, 500);
    const { cards: rawCards } = await req.json() as { cards: { account_id: string; name: string; official_name: string }[] };
    if (!Array.isArray(rawCards) || !rawCards.length) return json({ benefits: {} });
    // Bound the prompt size: a user has a handful of cards, and these strings
    // are interpolated into the prompt.
    const clip = (v: unknown, n: number) => String(v ?? "").replace(/[\r\n|]+/g, " ").slice(0, n);
    const cards = rawCards.slice(0, 20).map(c => ({
      account_id: clip(c?.account_id, 100),
      name: clip(c?.name, 120),
      official_name: clip(c?.official_name, 120),
    }));

    const prompt = `You are a credit card benefits expert. For each card, list its KEY annual benefits that provide real dollar value. Focus on credits, travel perks, statement credits, lounge access, insurance, not basic things like fraud protection.

Cards:
${cards.map(c => `- account_id: ${c.account_id} | Card: ${c.official_name || c.name}`).join("\n")}

Return JSON only, no markdown:
{"benefits":{"ACCOUNT_ID":[{"key":"unique_key","title":"Benefit name","description":"What it covers and how to use it","value":"$X/year","period":"annual"}]}}

Period options: annual, monthly, per_stay, per_flight, per_purchase
Return [] for any card you don't have info on.
Never use em dashes (—) or double hyphens (--) in any title or description. Use a period, comma, or colon instead.`;

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.1,
        max_tokens: 3000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const e = await res.text();
      console.error("[fetch-card-benefits] Groq error:", res.status, e.slice(0, 300));
      return json({ error: "Card benefits lookup is temporarily unavailable" }, 502);
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return json({ benefits: {} });
    const parsed = JSON.parse(match[0]);
    return json({ benefits: parsed.benefits ?? {} });
  } catch (e) {
    console.error("[fetch-card-benefits]", e);
    return json({ error: "Card benefits lookup failed" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
