/**
 * Coverage Health: is every bill, loan, card and budget paid from somewhere?
 *
 * Mirrors the prototype (fp.js flags()/pct()):
 *   items = obligations + fixed + budgets + cards + savings goals
 *   flags = obligations/fixed with no "Covered by" account (Unassigned)
 *         + credit cards with no payoff account
 *   pct   = round((items − flags) / items × 100)
 * A monthly set-aside into a savings account counts as covered. A budget
 * charged to a card with no payoff account is a warning, not a flag (the card
 * itself is already flagged).
 */
export type CoverGroup = "obligations" | "fixed" | "budgets" | "savings";

export interface CoverItem {
  group: CoverGroup;
  id: string;
  label: string;
  monthly: number;
  /** Account that covers it (bank, savings set-aside, or card), or null if unassigned. */
  coverId: string | null;
}

export interface CoverCard { id: string; label: string; payoffId: string | null }

export interface CoverFlag {
  key: string;
  text: string;
  kind: "unassigned" | "card_no_payoff";
  group: CoverGroup | "cards";
  id: string;
}

export interface CoverageResult {
  items: number;
  covered: number;
  pct: number;
  flags: CoverFlag[];
  /** Budgets charged to a card with no payoff account. */
  warnings: { key: string; text: string; id: string; cardId: string }[];
}

export function coverage(items: CoverItem[], cards: CoverCard[]): CoverageResult {
  const flags: CoverFlag[] = [];
  for (const it of items) {
    if ((it.group === "obligations" || it.group === "fixed") && !it.coverId)
      flags.push({ key: `row:${it.group}:${it.id}`, text: `${it.label} unassigned`, kind: "unassigned", group: it.group, id: it.id });
  }
  const unpaid = new Set<string>();
  for (const c of cards) {
    if (!c.payoffId) {
      unpaid.add(c.id);
      flags.push({ key: `row:cards:${c.id}`, text: `${c.label} has no payoff account`, kind: "card_no_payoff", group: "cards", id: c.id });
    }
  }
  const warnings = items
    .filter(it => it.coverId && unpaid.has(it.coverId))
    .map(it => ({ key: `row:${it.group}:${it.id}`, text: `${it.label} is charged to a card with no payoff account`, id: it.id, cardId: it.coverId! }));
  const total = items.length + cards.length;
  const covered = total - flags.length;
  return { items: total, covered, pct: total > 0 ? Math.round((covered / total) * 100) : 100, flags, warnings };
}

export interface MapAccount { id: string; label: string; kind: "bank" | "save" | "card" }
export interface MapBox {
  account: MapAccount;
  items: { label: string; tone: "ok" | "warn" | "bad"; to?: string }[];
}

/**
 * Coverage map (prototype covDetail): one box per paying account listing what
 * it covers, card bills under the account that pays them, and a final
 * "Not covered" box for everything unassigned.
 */
export function coverageMap(
  items: (CoverItem & { toLabel?: string | null })[],
  cards: CoverCard[],
  accounts: MapAccount[],
): { boxes: MapBox[]; notCovered: MapBox["items"] } {
  const byId = new Map(accounts.map(a => [a.id, a]));
  const unpaid = new Set(cards.filter(c => !c.payoffId).map(c => c.id));
  const boxes = new Map<string, MapBox>();
  const box = (id: string) => {
    let b = boxes.get(id);
    if (!b) { const a = byId.get(id) ?? { id, label: "Account", kind: "bank" as const }; b = { account: a, items: [] }; boxes.set(id, b); }
    return b;
  };
  const notCovered: MapBox["items"] = [];
  for (const it of items) {
    if (it.group === "savings") {
      if (it.coverId) box(it.coverId).items.push({ label: `→ ${it.toLabel ?? it.label}`, tone: "ok" });
      continue;
    }
    if (!it.coverId) { notCovered.push({ label: it.label, tone: "bad" }); continue; }
    box(it.coverId).items.push({ label: it.label, tone: unpaid.has(it.coverId) ? "warn" : "ok" });
  }
  for (const c of cards) {
    if (c.payoffId) box(c.payoffId).items.push({ label: `${c.label} bill`, tone: "ok" });
    else notCovered.push({ label: `${c.label} bill`, tone: "bad" });
  }
  const order = { bank: 0, save: 1, card: 2 } as const;
  return {
    boxes: [...boxes.values()].filter(b => b.items.length).sort((a, b) => order[a.account.kind] - order[b.account.kind] || b.items.length - a.items.length),
    notCovered,
  };
}
