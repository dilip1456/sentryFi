import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');

const ALL_CATEGORIES = [
  // Expense
  "Food & Drink", "Groceries", "Travel", "Transportation", "Shopping",
  "Entertainment", "Healthcare", "Bills & Utilities", "Education",
  "Personal Care", "Charitable Giving", "Transfer Out",
  // Income
  "Salary", "Freelance Income", "Interest & Dividends",
  "Refund / Reimbursement", "Transfer In",
  // Fallback
  "Other",
];

type Txn = { id: string; name: string | null; merchant_name: string | null; amount: number; category: string[] | null };
type Rule = { merchantPattern: string; category: string };

// ── Heuristic fallback ──────────────────────────────────────────
function heuristicCategory(merchantName: string, amount: number): string {
  const n = (merchantName || "").toLowerCase();
  if (amount < 0) {
    if (/payroll|salary|direct.dep|employer|wages/.test(n)) return "Salary";
    if (/freelance|contract|invoice|consulting/.test(n)) return "Freelance Income";
    if (/interest|dividend|yield|return on/.test(n)) return "Interest & Dividends";
    if (/refund|reimburse|reversal|return/.test(n)) return "Refund / Reimbursement";
    if (/transfer|zelle|venmo|cashapp|paypal/.test(n)) return "Transfer In";
    return "Other";
  }
  if (/restaurant|cafe|diner|kitchen|food|pizza|burger|sushi|ramen|taco|bbq|grill|mcdonald|starbuck|dunkin|subway|chipotle|domino|panera|wendy|chick.fil|doordash|ubereats|grubhub|seamless/.test(n)) return "Food & Drink";
  if (/grocery|supermarket|whole.foods|trader.joe|safeway|kroger|publix|albertson|sprouts|market|wegman|costco|sams.club|walmart|target.*(food|grocery)|aldi|h-mart/.test(n)) return "Groceries";
  if (/airline|delta|united|southwest|american.air|jetblue|spirit.air|frontier|hotel|marriott|hilton|hyatt|sheraton|westin|airbnb|booking|expedia|kayak|tripadvisor|vrbo/.test(n)) return "Travel";
  if (/uber(?!eat)|lyft|taxi|metro|bus|transit|mta|bart|caltrain|gasoline|shell|exxon|chevron|bp|sunoco|speedway|kwiktrip|murphy/.test(n)) return "Transportation";
  if (/amazon|walmart|target|best.buy|apple.com|ikea|home.depot|lowes|costco|ebay|etsy|shopify|gap|old.navy|h&m|zara|nordstrom|macy|tj.maxx|ross|tjx|marshalls/.test(n)) return "Shopping";
  if (/netflix|hulu|disney|hbo|max|peacock|paramount|spotify|apple.music|pandora|ticket|amc|regal|cinema|concert|theater|twitch|xbox|playstation|steam|gaming/.test(n)) return "Entertainment";
  if (/doctor|physician|hospital|urgent.care|clinic|dental|pharmacy|cvs|walgreen|rite.aid|optometry|vision|health|medical|lab|quest|labcorp/.test(n)) return "Healthcare";
  if (/electric|gas.company|water|utility|internet|comcast|xfinity|spectrum|att|verizon|tmobile|sprint|phone|cable|pg&e|con.ed|duke.energy|national.grid/.test(n)) return "Bills & Utilities";
  if (/tuition|university|college|school|udemy|coursera|lynda|skillshare|pluralsight|book.store|textbook|education/.test(n)) return "Education";
  if (/salon|barber|spa|nail|beauty|ulta|sephora|massage|gym|fitness|planet.fitness|equinox|peloton|crossfit/.test(n)) return "Personal Care";
  if (/charity|donate|donation|goodwill|red.cross|salvation|nonprofit|foundation/.test(n)) return "Charitable Giving";
  if (/transfer|wire|zelle|venmo|paypal|cashapp|pay.pal/.test(n)) return "Transfer Out";
  return "Other";
}

// ── AI categorization via Claude ────────────────────────────────
async function aiCategorize(txns: Txn[], rules: Rule[], userExamples: { name: string; category: string }[]): Promise<{ id: string; category: string; confidence: "high" | "medium" | "low" }[]> {
  const rulesCtx = rules.length > 0
    ? `User's saved rules (always apply these):\n${rules.map(r => `  "${r.merchantPattern}" → ${r.category}`).join("\n")}\n\n`
    : "";

  const examplesCtx = userExamples.length > 0
    ? `User's past categorizations (learn from these):\n${userExamples.map(e => `  "${e.name}" → ${e.category}`).join("\n")}\n\n`
    : "";

  const list = txns.map((t, i) => {
    const name = t.merchant_name || t.name || "Unknown";
    const dir = t.amount < 0 ? "CREDIT" : "DEBIT";
    const plaid = t.category?.[0] ?? "";
    return `${i + 1}. name="${name}" | ${dir} $${Math.abs(t.amount).toFixed(2)}${plaid ? ` | plaid_hint="${plaid}"` : ""}`;
  }).join("\n");

  const prompt = `You are a personal finance categorization assistant. Categorize each transaction into EXACTLY ONE category from this list:
${ALL_CATEGORIES.join(", ")}

${rulesCtx}${examplesCtx}Transactions to categorize:
${list}

Rules:
- Negative amounts (CREDIT) are income/transfers in
- Positive amounts (DEBIT) are expenses/transfers out
- Use plaid_hint as a clue but trust the merchant name more
- Return confidence: "high" if very sure, "medium" if likely, "low" if guessing

Respond with ONLY a JSON array, no explanation:
[{"index":1,"category":"Food & Drink","confidence":"high"},...]`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
  const data = await res.json();
  const text: string = data.content[0].text;

  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("No JSON array in AI response");

  const parsed: { index: number; category: string; confidence: "high"|"medium"|"low" }[] = JSON.parse(match[0]);
  return parsed.map(p => ({
    id: txns[p.index - 1]?.id ?? "",
    category: ALL_CATEGORIES.includes(p.category) ? p.category : heuristicCategory(txns[p.index - 1]?.merchant_name || txns[p.index - 1]?.name || "", txns[p.index - 1]?.amount ?? 0),
    confidence: p.confidence ?? "medium",
  })).filter(p => p.id);
}

// ── Handler ────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing auth" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const txns: Txn[] = body.transactions ?? [];
    const rules: Rule[] = body.rules ?? [];
    const userExamples: { name: string; category: string }[] = body.userExamples ?? [];

    if (txns.length === 0) return json({ results: [] });

    let results: { id: string; category: string; confidence: "high"|"medium"|"low" }[];

    if (ANTHROPIC_KEY) {
      // Use Claude for accurate AI categorization — batch in chunks of 50
      const chunks: Txn[][] = [];
      for (let i = 0; i < txns.length; i += 50) chunks.push(txns.slice(i, i + 50));
      const all = await Promise.all(chunks.map(chunk => aiCategorize(chunk, rules, userExamples)));
      results = all.flat();
    } else {
      // Fallback: apply rules first, then heuristics
      results = txns.map(t => {
        const merchant = t.merchant_name ?? t.name ?? "";
        // Check rules
        const ruleMatch = rules.find(r => merchant.toLowerCase().includes(r.merchantPattern.toLowerCase()));
        if (ruleMatch) return { id: t.id, category: ruleMatch.category, confidence: "high" as const };
        // Heuristic
        return { id: t.id, category: heuristicCategory(merchant, t.amount), confidence: "medium" as const };
      });
    }

    return json({ results });
  } catch (e) {
    console.error("[ai-categorize]", e);
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
