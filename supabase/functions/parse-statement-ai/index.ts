// AI-assisted fallback for the PDF statement importer. The deterministic
// parsers in src/lib/statement-import.ts only understand the handful of
// bank layouts they were built and tested against (Bank of America,
// Citibank) — anything else, or a layout change those banks make later,
// falls back to a blind "date, then words, then a dollar figure" scan with
// no idea whether a document actually contains more than one account.
// Rather than hand-writing one more bank-specific parser every time this
// comes up, this hands the extracted page text to an LLM and asks for the
// same structured shape every deterministic parser produces: one block per
// account found, each with its own label/last-4 and transaction rows.
//
// This is explicitly a fallback/escape hatch, not the primary path — the
// deterministic parsers are free, instant, and exactly reproducible, so
// they still run first for layouts they already know. An LLM can misread a
// figure or merge two rows, so nothing here is trusted sight-unseen: every
// row returned still goes through the same include/exclude review
// checklist as every other import path before anything reaches the
// database.
import { getCallerUser } from "../_shared/auth.ts";
import { summarizeFailedResponse } from "../_shared/http-errors.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GROQ_KEY = Deno.env.get("GROQ_API_KEY");
const GROQ_MODEL = "openai/gpt-oss-120b";
const MAX_LINES = 1400;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const user = await getCallerUser(req);
    if (!user) return json({ error: "Unauthorized" }, 401);
    if (!GROQ_KEY) return json({ error: "AI-assisted import is not configured" }, 500);

    const body = await req.json();
    const lines: string[] = Array.isArray(body?.lines) ? body.lines.slice(0, MAX_LINES) : [];
    if (lines.length === 0) return json({ accounts: [] });

    const numbered = lines.map((l, i) => `${i}: ${l}`).join("\n");

    const prompt = `You are extracting transactions from a bank or financial statement that has been converted to plain text (one reconstructed line per row, numbered). The statement may cover ONE account or SEVERAL accounts (e.g. a checking account plus more than one savings or HSA sub-account) — do not assume there is only one.

Rules:
- Group transactions by the account they actually belong to. Give each account a short label (its printed nickname, e.g. "Health Savings Account", "Regular Checking") and its last 4 digits if a full account number is printed nearby.
- Only include real transactions: a specific date, a description, and a dollar amount that was deposited or withdrawn. Never include a "Beginning balance", "Ending balance", "New balance", "Balance forward", running balance column, interest rate (APY), or any subtotal/total line.
- amount sign convention: negative = money IN to the account (a deposit, credit, paycheck, refund); positive = money OUT of the account (a purchase, withdrawal, payment, fee). Determine the correct sign from context (which section/column the row is in, or words like "deposit" vs "withdrawal" vs "debit" vs "credit") — do not just copy a minus sign that may or may not be printed.
- date must be ISO format YYYY-MM-DD. If only a year is given once for the whole statement and rows print MM/DD, infer the year from statement context.
- description: the merchant/payee text as printed, cleaned of reference/trace/confirmation numbers.
- Do not invent transactions that aren't in the text. Do not invent amounts — if a row's amount is unclear or ambiguous, skip that row rather than guess.

Statement text (line number: content):
${numbered}

Respond with JSON only, no markdown fences, in exactly this shape:
{"accounts":[{"label":"","last4":"","txns":[{"date":"YYYY-MM-DD","description":"","amount":0}]}]}`;

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0,
        max_tokens: 8000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      console.error("[parse-statement-ai] Groq error:", await summarizeFailedResponse(res));
      return json({ error: "AI-assisted import is temporarily unavailable" }, 502);
    }
    const rawText = await res.text();
    const data = JSON.parse(rawText);
    const text = data.choices?.[0]?.message?.content ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return json({ accounts: [], error: "AI couldn't parse this file" });
    const parsed = JSON.parse(match[0]);
    return json({ accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [] });
  } catch (e) {
    console.error("[parse-statement-ai]", e);
    return json({ error: "AI-assisted import failed", accounts: [] }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
