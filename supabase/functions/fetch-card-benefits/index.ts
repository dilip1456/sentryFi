const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const GROQ_KEY = Deno.env.get("GROQ_API_KEY");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!GROQ_KEY) return json({ error: "GROQ_API_KEY not set" }, 500);
    const { cards } = await req.json() as { cards: { account_id: string; name: string; official_name: string }[] };
    if (!cards?.length) return json({ benefits: {} });

    const prompt = `You are a credit card benefits expert. For each card, list its KEY annual benefits that provide real dollar value. Focus on credits, travel perks, statement credits, lounge access, insurance — not basic things like fraud protection.

Cards:
${cards.map(c => `- account_id: ${c.account_id} | Card: ${c.official_name || c.name}`).join("\n")}

Return JSON only, no markdown:
{"benefits":{"ACCOUNT_ID":[{"key":"unique_key","title":"Benefit name","description":"What it covers and how to use it","value":"$X/year","period":"annual"}]}}

Period options: annual, monthly, per_stay, per_flight, per_purchase
Return [] for any card you don't have info on.`;

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({
        model: "llama3-70b-8192",
        temperature: 0.1,
        max_tokens: 3000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) { const e = await res.text(); return json({ error: `Groq ${res.status}: ${e.slice(0,200)}` }, 500); }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return json({ benefits: {} });
    const parsed = JSON.parse(match[0]);
    return json({ benefits: parsed.benefits ?? {} });
  } catch (e) {
    console.error("[fetch-card-benefits]", e);
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
