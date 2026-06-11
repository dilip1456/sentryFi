import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');

type Account = {
  id: string; name: string | null; official_name: string | null;
  type: string | null; subtype: string | null;
  current_balance: number | null; available_balance: number | null;
};
type Txn = {
  amount: number; date: string; name: string | null;
  merchant_name: string | null; category: string[] | null; pending: boolean | null;
};
type CreditDetail = {
  account_id: string; last_statement_balance: number | null;
  minimum_payment_amount: number | null; next_payment_due_date: string | null;
  is_overdue: boolean | null; last_payment_amount: number | null;
};

function isDebt(type: string | null) { return type === 'credit' || type === 'loan'; }

function buildSummary(accounts: Account[], txns: Txn[], credit: CreditDetail[]) {
  const now = new Date();

  // Account snapshot
  const accountSnap = accounts.map(a => {
    const bal = Number(a.current_balance) || 0;
    const cd = credit.find(c => c.account_id === a.id);
    const limit = a.type === 'credit' && a.available_balance != null
      ? Math.abs(bal) + Number(a.available_balance) : null;
    return {
      name: a.name ?? a.official_name ?? 'Account',
      type: `${a.type}/${a.subtype}`,
      balance: isDebt(a.type) ? -Math.abs(bal) : bal,
      ...(limit ? { creditLimit: limit, utilization: `${((Math.abs(bal) / limit) * 100).toFixed(0)}%` } : {}),
      ...(cd?.last_statement_balance != null ? { statementBalance: cd.last_statement_balance } : {}),
      ...(cd?.next_payment_due_date ? { dueDate: cd.next_payment_due_date, isOverdue: cd.is_overdue } : {}),
    };
  });

  // Monthly spend/income by category — last 4 months
  const monthlyData: Record<string, { income: number; expenses: number; categories: Record<string, number> }> = {};
  for (const t of txns) {
    if (t.pending) continue;
    const d = new Date(t.date + 'T00:00:00');
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!monthlyData[key]) monthlyData[key] = { income: 0, expenses: 0, categories: {} };
    const amt = Number(t.amount);
    if (amt < 0) {
      monthlyData[key].income += Math.abs(amt);
    } else {
      monthlyData[key].expenses += amt;
      const cat = t.category?.[0] ?? 'Other';
      monthlyData[key].categories[cat] = (monthlyData[key].categories[cat] ?? 0) + amt;
    }
  }

  // Top merchants last 90 days
  const ninetyAgo = new Date(now.getTime() - 90 * 86400000);
  const merchantTotals: Record<string, number> = {};
  for (const t of txns) {
    if (Number(t.amount) <= 0 || new Date(t.date + 'T00:00:00') < ninetyAgo) continue;
    const m = t.merchant_name ?? t.name ?? 'Unknown';
    merchantTotals[m] = (merchantTotals[m] ?? 0) + Number(t.amount);
  }
  const topMerchants = Object.entries(merchantTotals)
    .sort((a, b) => b[1] - a[1]).slice(0, 15)
    .map(([name, total]) => ({ name, total: Math.round(total) }));

  // Recurring subscriptions (simple detection)
  const subCandidates: Record<string, { count: number; avg: number; months: Set<string> }> = {};
  for (const t of txns) {
    const amt = Number(t.amount);
    if (amt <= 0 || amt > 200) continue;
    const d = new Date(t.date + 'T00:00:00');
    const monthKey = `${d.getFullYear()}-${d.getMonth()}`;
    const merchant = (t.merchant_name ?? t.name ?? '').trim().toLowerCase().slice(0, 40);
    if (!merchant) continue;
    if (!subCandidates[merchant]) subCandidates[merchant] = { count: 0, avg: 0, months: new Set() };
    subCandidates[merchant].count++;
    subCandidates[merchant].avg = ((subCandidates[merchant].avg * (subCandidates[merchant].count - 1)) + amt) / subCandidates[merchant].count;
    subCandidates[merchant].months.add(monthKey);
  }
  const subscriptions = Object.entries(subCandidates)
    .filter(([, v]) => v.months.size >= 2)
    .map(([name, v]) => ({ name, monthlyAvg: Math.round(v.avg), monthsDetected: v.months.size }))
    .sort((a, b) => b.monthlyAvg - a.monthlyAvg).slice(0, 20);

  const totalMonthlySubscriptions = subscriptions.reduce((s, x) => s + x.monthlyAvg, 0);

  return { accountSnap, monthlyData, topMerchants, subscriptions, totalMonthlySubscriptions };
}

function buildPrompt(summary: ReturnType<typeof buildSummary>): string {
  return `You are an expert personal finance advisor analyzing a user's real banking data. Your job is to generate actionable, specific financial insights.

## Financial Data

### Accounts
${JSON.stringify(summary.accountSnap, null, 2)}

### Monthly Income & Spending (last 4 months)
${JSON.stringify(summary.monthlyData, null, 2)}

### Top Merchants (last 90 days)
${JSON.stringify(summary.topMerchants, null, 2)}

### Detected Recurring Subscriptions
${JSON.stringify(summary.subscriptions, null, 2)}
Total monthly subscription cost: $${summary.totalMonthlySubscriptions}

## Your Task

Generate 4-7 high-value insights. Focus on:
- Spending spikes or unusual patterns (compare months)
- Subscription overload (are there too many? duplicates?)
- Credit card optimization (high utilization, upcoming due dates)
- Savings rate (income vs expenses — is the user saving enough?)
- Emergency fund health (checking balance vs monthly expenses)
- Cashback/rewards optimization (based on top spending categories)
- Any overdue payments or urgent financial risks

Each insight must be specific and actionable — reference actual dollar amounts and merchant names from the data. DO NOT generate generic advice.

Return ONLY a JSON array with this exact structure (no markdown, no explanation):
[
  {
    "id": "unique-slug",
    "severity": "high|medium|low",
    "category": "Spending|Savings|Credit|Cash Flow|Subscriptions|Rewards|Risk",
    "title": "Short headline (max 8 words)",
    "what": "What is happening — specific numbers and merchants",
    "why": "Why this matters financially",
    "action": "Specific actionable next step",
    "impact": "Estimated annual dollar impact description",
    "impactValue": 1200
  }
]

severity: high = urgent/risky, medium = opportunity, low = minor tip
impactValue: realistic annual dollar savings/gain (0 if not applicable)`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing auth' }, 401);

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    if (!ANTHROPIC_KEY) return json({ error: 'ANTHROPIC_API_KEY not set' }, 500);

    // Fetch 6 months of data
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const since = sixMonthsAgo.toISOString().split('T')[0];

    const [
      { data: accounts },
      { data: transactions },
      { data: creditDetails },
    ] = await Promise.all([
      admin.from('plaid_accounts').select('id,name,official_name,type,subtype,current_balance,available_balance').eq('user_id', user.id),
      admin.from('plaid_transactions').select('amount,date,name,merchant_name,category,pending').eq('user_id', user.id).gte('date', since).order('date', { ascending: false }).limit(600),
      admin.from('plaid_credit_details').select('*').eq('user_id', user.id),
    ]);

    if (!accounts?.length) return json({ insights: [] });

    const summary = buildSummary(accounts as Account[], (transactions ?? []) as Txn[], (creditDetails ?? []) as CreditDetail[]);
    const prompt = buildPrompt(summary);

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[analyze-finances] Claude error:', errText);
      return json({ error: 'Claude API error' }, 500);
    }

    const aiResponse = await res.json();
    const text: string = aiResponse.content[0].text;

    const match = text.match(/\[[\s\S]*\]/);
    if (!match) {
      console.error('[analyze-finances] No JSON array in response:', text.slice(0, 500));
      return json({ error: 'Invalid AI response format' }, 500);
    }

    let insights: unknown[];
    try {
      insights = JSON.parse(match[0]);
    } catch (e) {
      console.error('[analyze-finances] JSON parse error:', e);
      return json({ error: 'Could not parse AI response' }, 500);
    }

    // Persist to ai_insights table (upsert by user_id)
    await admin.from('ai_insights').upsert(
      { user_id: user.id, insights, created_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );

    return json({ insights });
  } catch (e) {
    console.error('[analyze-finances]', e);
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
