/**
 * Plaid Link in update mode for an existing item (plaid-create-link-token
 * with { itemId }):
 *  - "reconnect": the bank needs the user to sign in again. On success the
 *    item is healthy again, so run a sync and reload; nicknames, hidden
 *    flags and categories are untouched (same item, same account ids).
 *  - "consent": grant Liabilities on a card linked before it existed
 *    (plaid-grant-consent exchanges the new public token).
 */
import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export type PlaidUpdateMode = "reconnect" | "consent";

export function usePlaidUpdate(defaultItemId: string | null, mode: PlaidUpdateMode, onDone: () => void) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [itemId, setItemId] = useState<string | null>(defaultItemId);

  const onSuccess = useCallback(async (public_token: string) => {
    setBusy(true);
    try {
      if (mode === "consent") {
        const { data, error } = await supabase.functions.invoke("plaid-grant-consent", { body: { public_token, itemId } });
        if (error || data?.error) { toast.error("Couldn't finish granting access", { description: error?.message ?? data?.error }); return; }
        toast.success("Card details unlocked");
      } else {
        const { data, error } = await supabase.functions.invoke("plaid-sync-transactions");
        if (error || data?.error) toast.error("Reconnected, but the sync failed", { description: error?.message ?? data?.error });
        else toast.success("Reconnected. Balances are up to date.");
      }
      onDone();
    } finally {
      setBusy(false);
      setLinkToken(null);
    }
  }, [itemId, mode, onDone]);

  const { open, ready } = usePlaidLink({ token: linkToken, onSuccess, onExit: () => setLinkToken(null) });

  /** Start update mode for `id` (defaults to the hook's item). */
  const start = useCallback(async (id?: string) => {
    const target = id ?? defaultItemId;
    if (!target) return;
    if (linkToken && ready && target === itemId) { open(); return; }
    setItemId(target);
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("plaid-create-link-token", { body: { itemId: target, mode } });
    setBusy(false);
    if (error || !data?.link_token) {
      toast.error(mode === "consent" ? "Couldn't start access request" : "Couldn't start reconnect", { description: error?.message ?? data?.error });
      return;
    }
    setLinkToken(data.link_token);
  }, [defaultItemId, itemId, mode, linkToken, ready, open]);

  // Open Plaid as soon as a fresh token is ready.
  useEffect(() => { if (linkToken && ready) open(); }, [linkToken, ready, open]);

  return { start, busy };
}
