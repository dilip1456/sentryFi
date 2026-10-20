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
const PER_CARD_TIMEOUT_MS = 20_000;

type CardIn = { account_id: string; name: string; official_name: string };

const ACTION_TYPES = ["register", "activate", "use_credit", "subscribe", "link", "none"];
const CATEGORIES = ["dining", "groceries", "travel", "gas", "streaming", "online_shopping", "everything", "portal_travel"];

// One small prompt per distinct card product, run in parallel. The previous
// version sent every card in one prompt keyed by Plaid account_id: the model
// routinely mangled/omitted the long ids (so only one card — e.g. Venture X —
// came back matched), a 3000-token cap truncated the JSON for 5+ cards, and
// the whole page waited on the single slow call.
const promptFor = (cardName: string) => `You are a credit card benefits expert. List the KEY benefits of the "${cardName}" credit card that provide real value: statement credits, travel perks, lounge access, elite status, insurance, and its earning rates. Skip basics like fraud protection. If this is a store card or you are not confident about this exact card, return an empty list.

Return JSON only, no markdown, in exactly this shape:
{"benefits":[{"key":"snake_case_unique_key","title":"Benefit name","description":"What it covers and how to use it","value":"$X/year or null if no fixed dollar value","period":"annual","action_type":"none","action_label":null,"cashback_category":null,"cashback_rate":null,"priority":3}]}

Rules:
- One entry per distinct benefit. Never list the same benefit twice under different wording.
- period: one of annual, monthly, per_stay, per_flight, per_purchase, ongoing.
- action_type: one of ${ACTION_TYPES.join(", ")}. Use "none" when nothing needs to be done.
- action_label: short button text (e.g. "Activate Priority Pass") or null when action_type is none.
- For earning-rate entries set cashback_category to one of ${CATEGORIES.join(", ")} and cashback_rate to the number (2 for 2x or 2%). Rates only available when booking through the issuer's travel portal must use portal_travel.
- priority: 1 (most valuable/urgent) to 5.
- value must be a string like "$300/year" or null. Never "$0".
- Never use em dashes or double hyphens.`;

const NULLISH = new Set(["", "null", "undefined", "none", "n/a", "na"]);
const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return NULLISH.has(s.toLowerCase()) ? null : s;
};

const sanitize = (b: Record<string, unknown>, i: number) => {
  const title = str(b.title);
  if (!title) return null;
  const actionType = str(b.action_type)?.toLowerCase() ?? "none";
  let value = str(b.value);
  if (value && /^\$?\s*0+(\.0+)?(\s*(\/|per)\s*\w+)?$/i.test(value)) value = null;
  const rate = Number(b.cashback_rate);
  const key = (str(b.key) ?? title).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `benefit_${i}`;
  return {
    key,
    title,
    description: str(b.description) ?? "",
    value,
    period: str(b.period) ?? "annual",
    action_type: ACTION_TYPES.includes(actionType) ? actionType : "none",
    action_label: str(b.action_label),
    cashback_category: str(b.cashback_category),
    cashback_rate: Number.isFinite(rate) && rate > 0 ? rate : null,
    priority: Number.isFinite(Number(b.priority)) ? Math.min(5, Math.max(1, Math.round(Number(b.priority)))) : 5,
  };
};

async function fetchForCard(cardName: string) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PER_CARD_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.1,
        max_tokens: 2500,
        reasoning_effort: "low",
        messages: [{ role: "user", content: promptFor(cardName) }],
      }),
    });
    if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    const list: unknown[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.benefits) ? parsed.benefits : [];
    const seen = new Set<string>();
    return list
      .map((b, i) => (b && typeof b === "object" ? sanitize(b as Record<string, unknown>, i) : null))
      .filter((b): b is NonNullable<ReturnType<typeof sanitize>> => {
        if (!b) return false;
        const k = b.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        if (seen.has(b.key) || seen.has(k)) return false;
        seen.add(b.key); seen.add(k);
        return true;
      });
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    // Security audit M1: only signed-in users may spend the Groq quota.
    const user = await getCallerUser(req);
    if (!user) return json({ error: "Unauthorized" }, 401);
    if (!GROQ_KEY) return json({ error: "Card benefits lookup is not configured" }, 500);
    const { cards: rawCards } = await req.json() as { cards: CardIn[] };
    if (!Array.isArray(rawCards) || !rawCards.length) return json({ benefits: {} });
    // Bound the work per request: a user has a handful of cards, each distinct
    // product is one Groq call, and these strings go into the prompt.
    const clip = (v: unknown, n: number) => String(v ?? "").replace(/[\r\n|]+/g, " ").slice(0, n);
    const cards: CardIn[] = rawCards.slice(0, 20).map(c => ({
      account_id: clip(c?.account_id, 100),
      name: clip(c?.name, 120),
      official_name: clip(c?.official_name, 120),
    }));

    // Two accounts of the same product share one lookup.
    const byProduct = new Map<string, string[]>();
    for (const c of cards) {
      const name = (c.official_name || c.name || "").trim();
      if (!name) continue;
      byProduct.set(name, [...(byProduct.get(name) ?? []), c.account_id]);
    }

    const benefits: Record<string, unknown[]> = {};
    const failed: string[] = [];
    await Promise.all([...byProduct.entries()].map(async ([name, ids]) => {
      try {
        const list = await fetchForCard(name);
        for (const id of ids) benefits[id] = list;
      } catch (e) {
        console.error("[fetch-card-benefits]", name, e);
        failed.push(...ids);
      }
    }));
    // Keys are always the caller's account_ids, never model output.
    return json({ benefits, failed });
  } catch (e) {
    console.error("[fetch-card-benefits]", e);
    return json({ error: "Card benefits lookup failed" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
