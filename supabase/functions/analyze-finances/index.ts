import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const GROQ_KEY = Deno.env.get('GROQ_API_KEY');

// ── Types ───────────────────────────────────────────────────────
type Account = {
  id: string; name: string | null; official_name: string | null;
  type: string | null; subtype: string | null;
  current_balance: number | null; available_balance: number | null;
  mask: string | null;
};
type Txn = {
  account_id: string; amount: number; date: string; name: string | null;
  merchant_name: string | null; category: string[] | null; pending: boolean | null;
};
type CreditDetail = {
  account_id: string; last_statement_balance: number | null;
  minimum_payment_amount: number | null; next_payment_due_date: string | null;
  is_overdue: boolean | null; last_payment_amount: number | null;
};
type CatalogCard = {
  id: string; card_key: string; display_name: string; match_keywords: string[];
  dining_rate: number; grocery_rate: number; travel_rate: number;
  gas_rate: number; streaming_rate: number; amazon_rate: number; default_rate: number;
  rewards_summary: string | null; best_for: string | null; perks: string | null;
};
type CardMatch = CatalogCard & { accountName: string; mask: string | null; accountId: string };

// ── Helpers ─────────────────────────────────────────────────────
function isDebt(type: string | null) { return type === 'credit' || type === 'loan'; }

function matchCard(account: Account, catalog: CatalogCard[]): CatalogCard | null {
  const haystack = `${account.name ?? ''} ${account.official_name ?? ''}`.toLowerCase();
  for (const card of catalog) {
    if (card.match_keywords.some(kw => haystack.includes(kw))) return card;
  }
  return null;
}

// Plaid category → reward tier key
function categToTier(category: string[] | null, merchant: string | null): keyof Pick<CatalogCard, 'dining_rate'|'grocery_rate'|'travel_rate'|'gas_rate'|'streaming_rate'|'amazon_rate'|'default_rate'> {
  const cat = (category?.[0] ?? '').toLowerCase();
  const cat1 = (category?.[1] ?? '').toLowerCase();
  const m = (merchant ?? '').toLowerCase();

  if (/food|dining|restaurant/i.test(cat) || /food|dining|restaurant/i.test(cat1)) return 'dining_rate';
  if (/grocer|supermarket|wholesale/i.test(cat) || /grocer|supermarket/i.test(cat1)) return 'grocery_rate';
  if (/travel|airline|hotel|lodging|car rental/i.test(cat)) return 'travel_rate';
  if (/gas station|fuel/i.test(cat) || /gas station/i.test(cat1)) return 'gas_rate';
  if (/subscription|streaming/i.test(cat) || /netflix|hulu|spotify|disney|apple music|youtube premium|peacock|hbo|max|paramount/i.test(m)) return 'streaming_rate';
  if (/amazon/i.test(m)) return 'amazon_rate';
  return 'default_rate';
}

// ── Card lookup: DB first, Groq fallback ────────────────────────
async function resolveUnknownCard(
  admin: ReturnType<typeof createClient>,
  account: Account,
): Promise<CatalogCard | null> {
  if (!GROQ_KEY) return null;
  const cardName = `${account.name ?? ''} ${account.official_name ?? ''}`.trim();
  if (!cardName) return null;

  try {
    const prompt = `You are a credit card rewards expert. Given the card name below, return ONLY a JSON object (no markdown) with this exact structure:
{
  "card_key": "issuer-card-name-slug",
  "display_name": "Full Card Name",
  "match_keywords": ["keyword1", "keyword2"],
  "dining_rate": 1,
  "grocery_rate": 1,
  "travel_rate": 1,
  "gas_rate": 1,
  "streaming_rate": 1,
  "amazon_rate": 1,
  "default_rate": 1,
  "rewards_summary": "Short rewards description",
  "best_for": "Best use case",
  "perks": "Notable perks or null"
}

Rules:
- Rates are cashback % or points multiplier (e.g. 3 for 3x, 2 for 2%)
- match_keywords: 1-3 lowercase strings that uniquely identify this card
- If the card is unknown or a generic debit/checking card, return null

Card name: "${cardName}"`;

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        temperature: 0.1,
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content ?? '';
    if (text.trim() === 'null') return null;

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const card = JSON.parse(match[0]) as CatalogCard;
    if (!card.card_key || !card.display_name) return null;

    // Insert into catalog for future users
    const { data: inserted } = await admin.from('card_catalog').insert({
      ...card,
      ai_generated: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).select().maybeSingle();

    return inserted as CatalogCard | null;
  } catch (e) {
    console.warn('[resolve-card] Groq lookup failed:', e);
    return null;
  }
}

// ── Build financial summary ──────────────────────────────────────
function buildSummary(
  accounts: Account[],
  txns: Txn[],
  credit: CreditDetail[],
  cardMatches: CardMatch[],
) {
  const now = new Date();
  // Filter out internal transfers for all analysis. A transaction only counts as an
  // internal transfer if Plaid's own category says so, or if there's a matching
  // opposite-signed transaction in a different account within 3 days — mirrors the
  // frontend's detectInternalTransfers() so backend and frontend totals agree. A naive
  // name/keyword match alone (e.g. "payment") would wrongly exclude real income/expenses.
  const TRANSFER_NAME = /\btransfer\b|zelle|venmo|cashapp|pay yourself|from checking|to savings|to checking|from savings|online payment|autopay|bill pay/i;
  const isTransferCandidate = (t: Txn) =>
    (t.category?.[0] ?? '').toLowerCase().includes('transfer') ||
    TRANSFER_NAME.test(t.merchant_name ?? t.name ?? '');
  const internalIdx = new Set<number>();
  {
    const candidates = txns
      .map((t, idx) => ({ t, idx }))
      .filter(({ t }) => isTransferCandidate(t));
    const claimed = new Set<number>();
    for (const { t, idx } of candidates) {
      if (claimed.has(idx)) continue;
      const tAmt = Number(t.amount);
      const tDate = new Date(t.date + 'T00:00:00');
      const match = candidates.find(({ t: o, idx: oIdx }) => {
        if (oIdx === idx || claimed.has(oIdx)) return false;
        if (o.account_id === t.account_id) return false;
        const oAmt = Number(o.amount);
        if (Math.abs(Math.abs(oAmt) - Math.abs(tAmt)) > 0.01) return false;
        if (Math.sign(oAmt) === Math.sign(tAmt)) return false;
        const oDate = new Date(o.date + 'T00:00:00');
        return Math.abs(tDate.getTime() - oDate.getTime()) <= 3 * 86400000;
      });
      if (match) {
        internalIdx.add(idx); internalIdx.add(match.idx);
        claimed.add(idx); claimed.add(match.idx);
      } else if ((t.category?.[0] ?? '').toLowerCase().includes('transfer')) {
        internalIdx.add(idx);
        claimed.add(idx);
      }
    }
  }
  const realTxns = txns.filter((t, idx) => !internalIdx.has(idx));

  // Account snapshot
  const accountSnap = accounts.map(a => {
    const bal = Number(a.current_balance) || 0;
    const cd = credit.find(c => c.account_id === a.id);
    const limit = a.type === 'credit' && a.available_balance != null
      ? Math.abs(bal) + Number(a.available_balance) : null;
    return {
      name: a.name ?? a.official_name ?? 'Account',
      ...(a.mask ? { mask: a.mask } : {}),
      type: `${a.type}/${a.subtype}`,
      balance: isDebt(a.type) ? -Math.abs(bal) : bal,
      ...(limit ? { creditLimit: limit, utilization: `${((Math.abs(bal) / limit) * 100).toFixed(0)}%` } : {}),
      ...(cd?.last_statement_balance != null ? { statementBalance: cd.last_statement_balance } : {}),
      ...(cd?.next_payment_due_date ? { dueDate: cd.next_payment_due_date, isOverdue: cd.is_overdue } : {}),
    };
  });

  // Credit card summaries for prompt
  const creditCards = cardMatches.map(cm => ({
    name: `${cm.display_name}${cm.mask ? ` ··${cm.mask}` : ''}`,
    rewards: cm.rewards_summary,
    bestFor: cm.best_for,
    ...(cm.perks ? { perks: cm.perks } : {}),
  }));

  // Monthly spend/income by category — last 4 months (internal transfers excluded).
  // Pending transactions are included — the frontend dashboard counts them too, and
  // excluding them here would make this month's total silently diverge from what the
  // user sees on screen.
  const monthlyDataUnordered: Record<string, { income: number; expenses: number; categories: Record<string, number> }> = {};
  for (const t of realTxns) {
    const d = new Date(t.date + 'T00:00:00');
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!monthlyDataUnordered[key]) monthlyDataUnordered[key] = { income: 0, expenses: 0, categories: {} };
    const amt = Number(t.amount);
    if (amt < 0) {
      monthlyDataUnordered[key].income += Math.abs(amt);
    } else {
      monthlyDataUnordered[key].expenses += amt;
      const cat = t.category?.[0] ?? 'Other';
      monthlyDataUnordered[key].categories[cat] = (monthlyDataUnordered[key].categories[cat] ?? 0) + amt;
    }
  }
  // Transactions arrive newest-first, so object keys would otherwise be inserted
  // newest-first too — re-build in chronological order so the prompt reads top-to-bottom
  // the same way a human would, and the model doesn't mistake an older month for "current."
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthlyData: Record<string, { income: number; expenses: number; categories: Record<string, number>; inProgress?: true }> = {};
  for (const key of Object.keys(monthlyDataUnordered).sort()) {
    monthlyData[key] = { ...monthlyDataUnordered[key], ...(key === currentMonthKey ? { inProgress: true } : {}) };
  }

  // Top merchants last 90 days
  const ninetyAgo = new Date(now.getTime() - 90 * 86400000);
  const merchantTotals: Record<string, number> = {};
  for (const t of realTxns) {
    if (Number(t.amount) <= 0 || new Date(t.date + 'T00:00:00') < ninetyAgo) continue;
    const m = t.merchant_name ?? t.name ?? 'Unknown';
    merchantTotals[m] = (merchantTotals[m] ?? 0) + Number(t.amount);
  }
  const topMerchants = Object.entries(merchantTotals)
    .sort((a, b) => b[1] - a[1]).slice(0, 15)
    .map(([name, total]) => ({ name, total: Math.round(total) }));

  // Recurring subscriptions
  const NON_SUB_KEYWORDS = [
    'pizza','burger','sushi','taco','grill','diner','cafe','coffee',
    'restaurant','kitchen','bistro','bbq','brewery','bar ','pub ',
    'grocery','supermarket','market','walmart','target','costco',
    'gas','fuel','shell','exxon','chevron','bp ',
    'transfer','payment','atm ','withdrawal','zelle','venmo',
    'uber','lyft','taxi','doordash','grubhub','instacart',
  ];
  const isNonSub = (t: Txn) => {
    const cat = (t.category?.[0] ?? '').toLowerCase();
    const name = (t.merchant_name ?? t.name ?? '').toLowerCase();
    if (/food|dining|restaurant|grocery|transfer|gas station/i.test(cat)) return true;
    return NON_SUB_KEYWORDS.some(k => name.includes(k));
  };
  const normMerchant = (raw: string) =>
    raw.toLowerCase().replace(/\s+(and|&|llc|inc|co\.?|corp\.?)[\s,]*$/i, '').replace(/\s+/g, ' ').trim().slice(0, 35);

  const subMap: Record<string, { displayName: string; amounts: number[]; months: Set<string> }> = {};
  for (const t of realTxns) {
    const amt = Number(t.amount);
    if (amt <= 0 || amt > 300 || t.pending || isNonSub(t)) continue;
    const d = new Date(t.date + 'T00:00:00');
    const mk = `${d.getFullYear()}-${d.getMonth()}`;
    const raw = (t.merchant_name ?? t.name ?? '').trim();
    if (!raw) continue;
    const key = normMerchant(raw);
    if (!subMap[key]) subMap[key] = { displayName: t.merchant_name ?? t.name ?? raw, amounts: [], months: new Set() };
    subMap[key].amounts.push(amt);
    subMap[key].months.add(mk);
  }
  const subscriptions = Object.entries(subMap)
    .filter(([, v]) => {
      if (v.months.size < 2) return false;
      const avg = v.amounts.reduce((s, a) => s + a, 0) / v.amounts.length;
      const maxDev = Math.max(...v.amounts.map(a => Math.abs(a - avg)));
      return avg > 0 && maxDev / avg < 0.15;
    })
    .map(([, v]) => ({
      name: v.displayName,
      monthlyAvg: Math.round(v.amounts.reduce((s, a) => s + a, 0) / v.amounts.length),
      monthsDetected: v.months.size,
    }))
    .sort((a, b) => b.monthlyAvg - a.monthlyAvg).slice(0, 15);

  // Card optimization: per-category missed rewards
  const cardOpt: {
    category: string; totalSpent: number;
    cardUsed: string; rateEarned: number;
    bestCard: string; bestRate: number;
    missedMonthly: number; missedAnnual: number;
  }[] = [];

  if (cardMatches.length >= 2) {
    // Group spending by (tier × account) for last 90 days
    type TierKey = 'dining_rate'|'grocery_rate'|'travel_rate'|'gas_rate'|'streaming_rate'|'amazon_rate'|'default_rate';
    const tierSpend: Record<string, Record<string, number>> = {}; // tier → accountId → amount
    for (const t of realTxns) {
      const amt = Number(t.amount);
      if (amt <= 0 || t.pending || new Date(t.date + 'T00:00:00') < ninetyAgo) continue;
      const tier = categToTier(t.category, t.merchant_name);
      if (!tierSpend[tier]) tierSpend[tier] = {};
      tierSpend[tier][t.account_id] = (tierSpend[tier][t.account_id] ?? 0) + amt;
    }

    const TIER_LABELS: Record<string, string> = {
      dining_rate: 'Dining', grocery_rate: 'Groceries', travel_rate: 'Travel',
      gas_rate: 'Gas', streaming_rate: 'Streaming', amazon_rate: 'Amazon', default_rate: 'General',
    };

    for (const [tier, accSpend] of Object.entries(tierSpend)) {
      const tKey = tier as TierKey;
      // Find which card was used most for this tier
      const sorted = Object.entries(accSpend).sort((a, b) => b[1] - a[1]);
      if (sorted.length === 0) continue;
      const [topAccId, total90] = sorted[0];
      const monthlySpend = Math.round(total90 / 3);
      if (monthlySpend < 30) continue; // skip tiny categories

      const usedCard = cardMatches.find(c => c.accountId === topAccId);
      if (!usedCard) continue;
      const rateEarned = usedCard[tKey] as number;

      // Find best card for this tier among all the user's cards
      const bestCard = cardMatches.reduce((best, c) =>
        (c[tKey] as number) > (best[tKey] as number) ? c : best
      );
      const bestRate = bestCard[tKey] as number;

      if (bestRate <= rateEarned) continue; // already using the best card

      const missedMonthly = monthlySpend * (bestRate - rateEarned) / 100;
      if (missedMonthly < 2) continue; // skip noise

      cardOpt.push({
        category: TIER_LABELS[tier],
        totalSpent: monthlySpend,
        cardUsed: `${usedCard.display_name}${usedCard.mask ? ` ··${usedCard.mask}` : ''}`,
        rateEarned,
        bestCard: `${bestCard.display_name}${bestCard.mask ? ` ··${bestCard.mask}` : ''}`,
        bestRate,
        missedMonthly: Math.round(missedMonthly),
        missedAnnual: Math.round(missedMonthly * 12),
      });
    }
    cardOpt.sort((a, b) => b.missedAnnual - a.missedAnnual);
  }

  const totalMonthlySubscriptions = subscriptions.reduce((s, x) => s + x.monthlyAvg, 0);

  // Net savings rate — current month (pending included, matching the dashboard's own stat cards)
  const curMo = now.getMonth(); const curYr = now.getFullYear();
  const curMonthReal = realTxns.filter(t => {
    const d = new Date(t.date + 'T00:00:00');
    return d.getMonth() === curMo && d.getFullYear() === curYr;
  });
  const curIncome = curMonthReal.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  const curExpenses = curMonthReal.filter(t => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
  const savingsRate = curIncome > 0 ? Math.round(((curIncome - curExpenses) / curIncome) * 100) : null;

  return { accountSnap, creditCards, monthlyData, topMerchants, subscriptions, totalMonthlySubscriptions, cardOpt, curIncome: Math.round(curIncome), curExpenses: Math.round(curExpenses), savingsRate };
}

// ── Prompt ───────────────────────────────────────────────────────
function buildPrompt(summary: ReturnType<typeof buildSummary>): string {
  return `You are an expert personal finance advisor analyzing a user's real banking data. Generate actionable, specific financial insights.

## Accounts
${JSON.stringify(summary.accountSnap, null, 2)}

## User's Credit Cards & Their Rewards
${summary.creditCards.length > 0 ? JSON.stringify(summary.creditCards, null, 2) : 'No credit cards linked.'}

## Card Usage Optimization (pre-calculated missed rewards)
${summary.cardOpt.length > 0 ? JSON.stringify(summary.cardOpt, null, 2) : 'Only one card or insufficient data for optimization.'}

## Monthly Income & Spending (last 4 months, oldest to newest)
Months are listed chronologically. A month flagged "inProgress": true is the current calendar month and is NOT finished yet — its totals are partial, so never describe it as "down" or "up" relative to a completed prior month without saying it's still in progress.
${JSON.stringify(summary.monthlyData, null, 2)}

## Top Merchants (last 90 days)
${JSON.stringify(summary.topMerchants, null, 2)}

## Detected Recurring Subscriptions
${JSON.stringify(summary.subscriptions, null, 2)}
Total monthly subscription cost: $${summary.totalMonthlySubscriptions}

## Current Month Cash Flow (internal transfers excluded)
Income: $${summary.curIncome} | Expenses: $${summary.curExpenses}${summary.savingsRate !== null ? ` | Net savings rate: ${summary.savingsRate}%` : ''}

## Task

Generate 4-8 high-value insights. Prioritize:
1. Card optimization opportunities (use the pre-calculated cardOpt data — cite exact card names with last 4 digits, dollar amounts missed)
2. Spending spikes or patterns vs prior months (use monthlyData)
3. Subscription overload or duplicates
4. Credit utilization, upcoming due dates, overdue payments
5. Savings rate health — flag if savings rate is <15% or negative; commend if >30%

Rules:
- Reference actual merchant names, account/card names, and dollar amounts from the data provided
- Every account and card in the data above includes a "mask" field with its real last-4 digits when known. When naming a specific account or card, append " ··" followed by that exact mask value (e.g. "Travel Credit Card ··0388"). If an account has no "mask" field, refer to it by name only — never invent or write a placeholder like "XXXX" or "1234"
- For card swaps: "Use your [BestCard ··<real mask>] instead of [CurrentCard ··<real mask>] for [Category]" — using the literal mask digits from the data, not a placeholder
- DO NOT generate generic advice — every insight must cite specific data
- Keep card optimization insights to top 2-3 highest-impact swaps only

Return ONLY a JSON array, no markdown, no explanation:
[
  {
    "id": "unique-slug",
    "severity": "high|medium|low",
    "category": "Spending|Savings|Credit|Cash Flow|Subscriptions|Rewards|Risk",
    "title": "Short headline (max 8 words)",
    "what": "What is happening — specific numbers, card names, merchants",
    "why": "Why this matters financially",
    "action": "Specific actionable next step with exact names",
    "impact": "Annual dollar impact description",
    "impactValue": 1200
  }
]`;
}

// ── Main handler ─────────────────────────────────────────────────
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

    if (!GROQ_KEY) return json({ error: 'GROQ_API_KEY not set' }, 500);

    // Fetch user data + card catalog in parallel
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const since = sixMonthsAgo.toISOString().split('T')[0];

    const [
      { data: accounts },
      { data: transactions },
      { data: creditDetails },
      { data: catalog },
    ] = await Promise.all([
      admin.from('plaid_accounts').select('id,name,official_name,type,subtype,current_balance,available_balance,mask').eq('user_id', user.id),
      admin.from('plaid_transactions').select('account_id,amount,date,name,merchant_name,category,pending').eq('user_id', user.id).gte('date', since).order('date', { ascending: false }).limit(600),
      admin.from('plaid_credit_details').select('*').eq('user_id', user.id),
      admin.from('card_catalog').select('*'),
    ]);

    if (!accounts?.length) return json({ insights: [] });

    const typedCatalog = (catalog ?? []) as CatalogCard[];

    // Match each credit card account against the catalog
    const creditAccounts = (accounts as Account[]).filter(a => a.type === 'credit');
    const cardMatches: CardMatch[] = [];

    for (const acc of creditAccounts) {
      let matched = matchCard(acc, typedCatalog);
      if (!matched) {
        // Unknown card — ask Groq to identify it and cache in DB
        matched = await resolveUnknownCard(admin, acc);
        if (matched) typedCatalog.push(matched); // add to in-memory catalog for this run
      }
      if (matched) {
        cardMatches.push({ ...matched, accountName: acc.name ?? '', mask: acc.mask ?? null, accountId: acc.id });
      }
    }

    const summary = buildSummary(
      accounts as Account[],
      (transactions ?? []) as Txn[],
      (creditDetails ?? []) as CreditDetail[],
      cardMatches,
    );
    const prompt = buildPrompt(summary);

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        temperature: 0.3,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[analyze-finances] Groq error:', errText);
      return json({ error: 'Groq API error' }, 500);
    }

    const aiResponse = await res.json();
    const text: string = aiResponse.choices?.[0]?.message?.content ?? '';

    const match = text.match(/\[[\s\S]*\]/);
    if (!match) {
      console.error('[analyze-finances] No JSON array in Groq response:', text.slice(0, 500));
      return json({ error: 'Invalid AI response format' }, 500);
    }

    let insights: unknown[];
    try {
      insights = JSON.parse(match[0]);
    } catch (e) {
      console.error('[analyze-finances] JSON parse error:', e);
      return json({ error: 'Could not parse AI response' }, 500);
    }

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
