/**
 * useDashboardData — loads all Plaid data from Supabase.
 * Used by every view component so data fetching lives in one place.
 */
import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { type ManualAccount } from "./useManualAccounts";

export interface PAccount {
  id: string; account_id: string; item_id: string | null;
  name: string | null; official_name: string | null; mask: string | null;
  type: string | null; subtype: string | null;
  current_balance: number | null; available_balance: number | null;
  iso_currency_code: string | null;
}

export interface PTxn {
  id: string; account_id: string; item_id: string | null; transaction_id: string | null;
  amount: number; date: string; authorized_date: string | null;
  name: string | null; merchant_name: string | null; category: string[] | null;
  pending: boolean | null; payment_channel: string | null;
}

export interface PItem {
  id: string; institution_id: string | null; institution_name: string | null;
  status: string | null; cursor: string | null;
}

export interface CreditDetail {
  account_id: string; last_statement_balance: number | null;
  last_payment_amount: number | null; last_payment_date: string | null;
  minimum_payment_amount: number | null; next_payment_due_date: string | null;
  is_overdue: boolean; apr: number | null;
}

export const useDashboardData = (userId: string | undefined, demo: boolean) => {
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [accounts, setAccounts] = useState<PAccount[]>([]);
  const [txns, setTxns] = useState<PTxn[]>([]);
  const [items, setItems] = useState<PItem[]>([]);
  const [creditDetails, setCreditDetails] = useState<CreditDetail[]>([]);
  const [manualAccounts, setManualAccounts] = useState<ManualAccount[]>([]);

  const load = useCallback(async () => {
    if (demo || !userId) { setLoading(false); return; }
    setLoading(true);
    try {
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      const since = threeMonthsAgo.toISOString().slice(0, 10);

      const [accsRes, txnsRes, itsRes, cdRes, manRes] = await Promise.all([
        supabase.from("plaid_accounts").select("*").eq("user_id", userId).order("type"),
        supabase.from("plaid_transactions").select("*").eq("user_id", userId).gte("date", since).order("date", { ascending: false }),
        supabase.from("plaid_items").select("id,institution_id,institution_name,status,cursor").eq("user_id", userId),
        supabase.from("plaid_credit_details").select("*").eq("user_id", userId),
        supabase.from("manual_accounts").select("*").eq("user_id", userId).order("created_at"),
      ]);

      if (accsRes.error) console.error("[load] accounts:", accsRes.error.message);
      if (txnsRes.error) console.error("[load] transactions:", txnsRes.error.message);
      if (itsRes.error)  console.error("[load] items:", itsRes.error.message);
      if (cdRes.error)   console.error("[load] credit details:", cdRes.error.message);
      if (manRes.error)  console.error("[load] manual accounts:", manRes.error.message);

      setAccounts((accsRes.data ?? []) as unknown as PAccount[]);
      setTxns((txnsRes.data ?? []) as unknown as PTxn[]);
      setItems((itsRes.data ?? []) as unknown as PItem[]);
      setCreditDetails((cdRes.data ?? []) as unknown as CreditDetail[]);
      setManualAccounts((manRes.data ?? []) as ManualAccount[]);
    } catch (e) {
      console.error("[load] unexpected:", e);
      toast.error("Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [userId, demo]);

  const sync = useCallback(async (catOverrides: Record<string,string>) => {
    if (!userId) return;
    setSyncing(true);
    const { data, error } = await supabase.functions.invoke("plaid-sync-transactions");
    setSyncing(false);
    if (error || data?.error) { toast.error("Sync failed", { description: error?.message ?? data?.error }); return; }
    const synced = data?.synced ?? 0;
    toast.success(`Synced ${synced} transaction${synced !== 1 ? "s" : ""}`);
    await load();
    return synced;
  }, [userId, load]);

  useEffect(() => { load(); }, [load]);

  return { loading, syncing, accounts, txns, items, creditDetails, manualAccounts, load, sync };
};
