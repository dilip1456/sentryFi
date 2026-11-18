/**
 * High-yield savings detection and the APY implied by real interest credits.
 * Moved out of LivePlaidDashboard.tsx unchanged (types made structural) so the
 * Accounts page and Home share one definition.
 */
export interface InterestAccount { account_id: string; type: string | null; subtype: string | null; name: string | null; official_name: string | null; current_balance: number | null }
export interface InterestTxn { account_id: string; amount: number; date: string; category: string[] | null }

const HYSA_INSTITUTIONS = ["marcus", "ally", "sofi", "discover", "american express", "amex", "barclays", "synchrony",
  "capital one 360", "citizens", "bask", "bread", "sallie mae", "varo", "axos", "laurel road", "ufb", "lending club",
  "cit bank", "live oak", "western alliance", "primis", "wealthfront", "betterment", "current", "robinhood", "vio",
  "quontic", "customers bank", "salem five", "everbank", "comenity", "popular direct", "tab bank", "first foundation",
  "north american savings", "dollar savings direct", "my banking direct", "evergreen", "patriot bank", "lendingclub"];
// HYSA threshold — most checking/standard savings pay well under 1%, online HYSAs are typically 4%+
const HYSA_APR_THRESHOLD = 3.0;
// Lower threshold used for a *computed* rate (derived from real interest the
// account actually earned) rather than a manually-typed APR — the name/
// institution list and the 3% manual-APR threshold above both depend on the
// user doing something (naming their bank recognizably, or typing an APR in),
// so most HYSAs never got flagged. A realized rate >1% is specific enough on
// its own since ordinary checking/standard savings pay a small fraction of
// that, per the user's own instruction.
const HYSA_IMPLIED_RATE_THRESHOLD = 1.0;
export const isHYSA = (a: InterestAccount, instName: string, apr?: number | null, impliedApy?: number | null): boolean => {
  if (a.type !== "depository" || a.subtype !== "savings") return false;
  const haystack = `${a.name ?? ""} ${a.official_name ?? ""} ${instName}`.toLowerCase();
  if (/high.?yield|hysa|hys\b/.test(haystack)) return true;
  if (HYSA_INSTITUTIONS.some(inst => haystack.includes(inst))) return true;
  if (apr != null && apr >= HYSA_APR_THRESHOLD) return true;
  return impliedApy != null && impliedApy >= HYSA_IMPLIED_RATE_THRESHOLD;
};

// Interest actually credited into an account (excludes interest *charged* on
// debt, which is a cost, not income) — used to derive a real-world implied
// rate instead of relying on the user to type an APR in.
const isInterestEarnedTxn = (t: InterestTxn) => {
  const hay = `${t.category?.[0] ?? ""} ${t.category?.[1] ?? ""}`.toLowerCase();
  if (!hay.includes("interest") || hay.includes("interest charged")) return false;
  return Number(t.amount) < 0; // money in, per this app's sign convention
};
const monthlyInterestFor = (accountId: string, txns: InterestTxn[], monthsBack: number): number => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  const end = new Date(now.getFullYear(), now.getMonth() - monthsBack + 1, 0);
  return txns.reduce((s, t) => {
    if (t.account_id !== accountId || !isInterestEarnedTxn(t)) return s;
    const d = new Date(t.date + "T00:00:00");
    if (d < start || d > end) return s;
    return s + Math.abs(Number(t.amount));
  }, 0);
};
// Annualized rate implied by actual interest credits — last *completed*
// month's interest alone (monthsBack starts at 1 so a mid-month credit this
// month doesn't understate it) for the headline figure, averaged over the
// last 3 completed months (skipping months with no credit) for a steadier
// "average rate" since some banks post interest irregularly.
export const computeImpliedApy = (a: InterestAccount, txns: InterestTxn[]): { lastMonthInterest: number; impliedApy: number | null } => {
  const bal = Math.abs(Number(a.current_balance) || 0);
  const lastMonthInterest = monthlyInterestFor(a.account_id, txns, 1);
  if (bal <= 0) return { lastMonthInterest, impliedApy: null };
  const recentMonths = [1, 2, 3].map(mb => monthlyInterestFor(a.account_id, txns, mb)).filter(v => v > 0);
  if (recentMonths.length === 0) return { lastMonthInterest, impliedApy: null };
  const avgMonthly = recentMonths.reduce((s, v) => s + v, 0) / recentMonths.length;
  return { lastMonthInterest, impliedApy: (avgMonthly * 12 / bal) * 100 };
};
