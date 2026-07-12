import Anthropic from "npm:@anthropic-ai/sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CATEGORIES = [
  "Food & Drink", "Groceries", "Transportation", "Travel", "Shopping",
  "Entertainment", "Healthcare", "Bills & Utilities", "Education",
  "Personal Care", "Charitable Giving", "Mortgage Payment", "Rent",
  "Auto Loan", "Student Loan", "Credit Card Payment", "Bill Payment",
  "Insurance", "Salary", "Interest & Dividends", "Bank Fees",
  "Financial Services", "Business", "Home", "Transfer In", "Transfer Out",
  "Internal Transfer", "Savings", "Other",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { transactions } = await req.json() as {
      transactions: { id: string; name: string; merchant_name: string | null; plaid_category: string; amount: number }[];
    };

    if (!transactions?.length) return json({ suggestions: [] });

    const client = new Anthropic();

    const prompt = `You are a personal finance categorization assistant. Review these transactions and identify ones where the bank's category seems WRONG based on the merchant/transaction name.

Only flag transactions where you are confident the category is incorrect. Do NOT flag transfers, salary, or transactions where the category is ambiguous.

Available categories: ${CATEGORIES.join(", ")}

Transactions to review:
${transactions.map(t => `- ID: ${t.id} | Name: "${t.name}"${t.merchant_name ? ` | Merchant: "${t.merchant_name}"` : ""} | Amount: $${Math.abs(t.amount)} | Bank category: "${t.plaid_category}"`).join("\n")}

Respond with JSON only, no other text:
{
  "suggestions": [
    {
      "id": "transaction_id",
      "name": "merchant name for display",
      "current_category": "what bank says",
      "suggested_category": "what it should be",
      "reason": "one short sentence why",
      "confidence": "high|medium"
    }
  ]
}

Only include HIGH confidence suggestions. If unsure, skip it. Return empty array if nothing is clearly wrong.`;

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    return json({ suggestions: parsed.suggestions ?? [] });
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
