/**
 * Settings → Banks "Extend history": link the same bank again (730 days) and
 * carry the user's settings over (src/lib/relink/flow.ts). Owns Plaid Link
 * for the re-link plus its confirm and result dialogs; the caller hides its
 * own dialog while `plaidActive` so Plaid's iframe isn't caught by the
 * modal's focus lock (same as LinkAccountDialog).
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePlaidLink, type PlaidLinkOnSuccessMetadata } from "react-plaid-link";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { dbToSettings, settingsToDb, type UserSettings } from "@/hooks/useUserSettings";
import { extendSummary, ExtendHistoryError, loadSettingsFresh, runExtendHistory, type ExtendTarget, type RelinkDb } from "@/lib/relink";

const db = supabase as unknown as RelinkDb;

type Phase = "idle" | "confirm" | "preparing" | "plaid" | "moving";

export function useExtendHistory(userId: string | undefined) {
  const [target, setTarget] = useState<ExtendTarget | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [token, setToken] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  const reset = () => { setPhase("idle"); setToken(null); setTarget(null); };

  const onSuccess = useCallback(async (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => {
    if (!userId || !target) return;
    setPhase("moving");
    try {
      const report = await runExtendHistory({
        db, userId, target, publicToken, institution: metadata?.institution,
        loadSettings: () => loadSettingsFresh(db, userId, dbToSettings),
        saveSettings: async (next: UserSettings) => {
          const { error } = await db.from("user_settings").upsert({ user_id: userId, ...settingsToDb(next) }, { onConflict: "user_id" });
          if (error) throw new Error(`settings: ${error.message}`);
        },
      });
      setSummary(extendSummary(report, target.institution_name ?? "Your bank"));
      setPhase("idle"); setToken(null);
    } catch (e) {
      const msg = e instanceof ExtendHistoryError ? e.message : (e as Error)?.message ?? String(e);
      toast.error("Extend history didn't finish", { description: msg, duration: 12000 });
      reset();
    }
  }, [userId, target]);

  const { open: openPlaid, ready } = usePlaidLink({ token, onSuccess, onExit: () => reset() });

  // Open Plaid once the token is ready; wait for our dialogs to release the
  // modal lock first.
  useEffect(() => {
    if (phase !== "preparing" || !token || !ready) return;
    setPhase("plaid");
    const t = setTimeout(() => openPlaid(), 250);
    return () => clearTimeout(t);
  }, [phase, token, ready, openPlaid]);

  const start = (item: ExtendTarget) => { setTarget(item); setPhase("confirm"); };

  const begin = async () => {
    setPhase("preparing");
    // A new Link session: plaid-create-link-token without itemId requests 730 days.
    const { data, error } = await supabase.functions.invoke("plaid-create-link-token");
    if (error || !data?.link_token) {
      toast.error("Couldn't start Plaid", { description: error?.message ?? data?.error });
      reset();
      return;
    }
    setToken(data.link_token);
  };

  const bank = target?.institution_name ?? "this bank";
  const dialogs: ReactNode = (
    <>
      <ConfirmDialog
        open={phase === "confirm" || (phase === "preparing" && !token)}
        onOpenChange={o => { if (!o) reset(); }}
        title={`Extend ${bank}'s history?`}
        description={<>You'll sign in to {bank} again through Plaid. Sentry Finance links it as a new connection with up to 2 years of transactions, moves your edits to it, then removes the old connection. Re-linking resets per-account settings for any account that can't be matched.</>}
        confirmLabel="Continue to Plaid"
        destructive={false}
        busy={phase === "preparing"}
        onConfirm={begin} />
      <ConfirmDialog
        open={phase === "moving"}
        onOpenChange={() => { /* busy */ }}
        title="Moving your settings…"
        description={`Matching ${bank}'s accounts and transactions. Keep this window open.`}
        confirmLabel="Working…"
        destructive={false}
        busy
        onConfirm={() => {}} />
      <ConfirmDialog
        open={summary !== null}
        onOpenChange={o => { if (!o) window.location.reload(); }}
        title="History extended"
        description={summary ?? ""}
        confirmLabel="Reload"
        destructive={false}
        onConfirm={() => window.location.reload()} />
    </>
  );

  return {
    start,
    busyId: phase === "idle" ? null : target?.id ?? null,
    /** hide the caller's dialog while Plaid (or our own dialogs) are up */
    plaidActive: phase !== "idle" || summary !== null,
    dialogs,
  };
}
