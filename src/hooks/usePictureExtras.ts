/**
 * Read-only extras for the Financial Picture: gift cards (total value,
 * expiries) and card perks. Same tables the Gift Cards and Benefits screens
 * read (RLS, own rows); nothing is written here. Demo: example cards, no perks.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { GiftCardLike } from "@/lib/picture/overview";
import { dedupeBenefits, summarizeBenefits, toBenefit, type BenefitSummary, type RawBenefit } from "@/lib/card-benefits";

type Res = PromiseLike<{ data: unknown; error: { message: string } | null }>;
type Query = Res & { select: (c: string) => Query; eq: (c: string, v: unknown) => Query; is: (c: string, v: null) => Query };
const db = supabase as unknown as { from: (t: string) => Query };

/** Mirrors the Gift Cards screen's demo wallet totals (5 cards). */
export const DEMO_GIFT_CARDS: GiftCardLike[] = [
  { id: "demo-1", brand_name: "Domino's", balance: 5, expiry_date: "2026-12-31" },
  { id: "demo-2", brand_name: "IKEA", balance: 42.41, expiry_date: "2026-12-31" },
  { id: "demo-3", brand_name: "Panera Bread", balance: 34.67, expiry_date: "2026-12-31" },
  { id: "demo-4", brand_name: "Best Buy", balance: 80.22, expiry_date: "2026-12-31" },
  { id: "demo-5", brand_name: "REI", balance: 14.17, expiry_date: "2026-12-31" },
];

export function useGiftCardRows(userId: string | null | undefined, demo: boolean): { rows: GiftCardLike[]; loaded: boolean } {
  const [state, setState] = useState<{ rows: GiftCardLike[]; loaded: boolean }>(() => (demo ? { rows: DEMO_GIFT_CARDS, loaded: true } : { rows: [], loaded: false }));
  useEffect(() => {
    if (demo) { setState({ rows: DEMO_GIFT_CARDS, loaded: true }); return; }
    if (!userId) { setState({ rows: [], loaded: true }); return; }
    let off = false;
    (async () => {
      let { data, error } = await (db.from("gift_cards").select("*").eq("user_id", userId).is("deleted_at", null) as Res);
      if (error) ({ data, error } = await (db.from("gift_cards").select("*").eq("user_id", userId) as Res)); // deleted_at not deployed
      if (off) return;
      if (error) { console.warn("[picture gift cards]", error.message); setState({ rows: [], loaded: true }); return; }
      setState({ rows: (data as GiftCardLike[]) ?? [], loaded: true });
    })();
    return () => { off = true; };
  }, [userId, demo]);
  return state;
}

export function useBenefitSummary(userId: string | null | undefined, demo: boolean, cardNames: Record<string, string>): BenefitSummary | null {
  const [s, setS] = useState<BenefitSummary | null>(null);
  const key = Object.keys(cardNames).sort().join(",");
  useEffect(() => {
    if (demo || !userId) { setS(null); return; }
    let off = false;
    (db.from("card_benefits").select("*").eq("user_id", userId) as Res).then(({ data, error }) => {
      if (off) return;
      if (error) { console.warn("[picture benefits]", error.message); setS(null); return; }
      const by: Record<string, RawBenefit[]> = {};
      for (const r of (data as (RawBenefit & { account_id: string; benefit_key?: string })[]) ?? []) (by[r.account_id] ??= []).push({ ...r, key: r.benefit_key ?? r.key });
      setS(summarizeBenefits(Object.entries(by).map(([account_id, list]) => ({ account_id, name: cardNames[account_id] ?? "Card", official_name: "", benefits: dedupeBenefits(list.map(toBenefit)) }))));
    });
    return () => { off = true; };
  }, [userId, demo, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return s;
}
