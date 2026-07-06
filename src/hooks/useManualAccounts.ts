import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface ManualAccount {
  id: string;
  user_id: string;
  name: string;
  institution_name: string | null;
  type: string;
  current_balance: number | null;
  role: string;
  role_label: string | null;
  // mortgage / loan
  original_loan_amount: number | null;
  interest_rate: number | null;
  monthly_payment: number | null;
  loan_start_date: string | null;
  loan_term_years: number | null;
  property_address: string | null;
  property_value: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type ManualAccountInput = Omit<ManualAccount, "id" | "user_id" | "created_at" | "updated_at">;

export const useManualAccounts = (userId: string | undefined) => {
  const [accounts, setAccounts] = useState<ManualAccount[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("manual_accounts")
      .select("*")
      .eq("user_id", userId)
      .order("created_at");
    setLoading(false);
    if (error) { console.error("manual_accounts load:", error.message); return; }
    setAccounts((data ?? []) as ManualAccount[]);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const save = async (input: ManualAccountInput, id?: string): Promise<boolean> => {
    if (!userId) return false;
    const payload = { ...input, user_id: userId, updated_at: new Date().toISOString() };
    if (id) {
      const { error } = await supabase.from("manual_accounts").update(payload).eq("id", id);
      if (error) { toast.error("Could not save account"); return false; }
    } else {
      const { error } = await supabase.from("manual_accounts").insert(payload);
      if (error) { toast.error("Could not save account"); return false; }
    }
    await load();
    return true;
  };

  const remove = async (id: string): Promise<boolean> => {
    const { error } = await supabase.from("manual_accounts").delete().eq("id", id);
    if (error) { toast.error("Could not delete account"); return false; }
    setAccounts(a => a.filter(x => x.id !== id));
    return true;
  };

  return { accounts, loading, load, save, remove };
};

/** Estimate remaining balance using simple amortization */
export const estimateRemainingBalance = (
  originalAmount: number,
  annualRate: number,
  termYears: number,
  startDate: string,
): { balance: number; payoffDate: Date; monthsRemaining: number } | null => {
  try {
    const r = annualRate / 100 / 12;
    const n = termYears * 12;
    if (r === 0) return null;
    const monthlyPayment = (originalAmount * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    const start = new Date(startDate + "T00:00:00");
    const now = new Date();
    const elapsed = Math.max(0,
      (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
    );
    const remaining = Math.max(0, n - elapsed);
    // Balance after elapsed payments
    const balance = originalAmount * Math.pow(1 + r, elapsed)
      - monthlyPayment * ((Math.pow(1 + r, elapsed) - 1) / r);
    const payoffDate = new Date(now);
    payoffDate.setMonth(payoffDate.getMonth() + remaining);
    return { balance: Math.max(0, balance), payoffDate, monthsRemaining: remaining };
  } catch {
    return null;
  }
};
