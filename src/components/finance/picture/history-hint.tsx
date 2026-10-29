/**
 * "Extend history" hint: shown when a connected bank has less than ~2 years
 * of transactions. Dismissal is per bank in user_settings.dismissedInsights
 * (the list the other dismissible hints use), so a bank linked later can
 * show it again. "Extend history" opens Settings → Banks.
 */
import { History, X } from "lucide-react";
import { historyHintBanks, historyHintKey, historyLabel } from "@/lib/relink/history";
import { openSettings } from "@/lib/settings-nav";
import { usePicture } from "./state";

const names = (xs: string[]) => xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

export function HistoryHint() {
  const pc = usePicture();
  const { banks = [], dismissedInsights = [] } = pc.props;
  const show = historyHintBanks(banks, dismissedInsights);
  if (!show.length) return null;
  const one = show.length === 1 ? show[0] : null;
  const text = one
    ? `${one.institution} has ${historyLabel(one.days).replace(/^About/, "about").replace(/ of history$/, "")} of history.`
    : `${names(show.map(b => b.institution))} have less than 2 years of history.`;
  const dismiss = () => pc.props.onUpdate({ dismissedInsights: [...new Set([...dismissedInsights, ...show.map(b => historyHintKey(b.itemId))])] });
  return (
    <div className="hist-hint" role="note" data-testid="history-hint">
      <History className="h-4 w-4 shrink-0 text-[hsl(var(--primary))]" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="hist-t">{text}</div>
        <div className="note">Re-link to get up to 2 years so yearly bills and paychecks are detected.</div>
      </div>
      <button type="button" className="btn hist-go" onClick={() => openSettings("banks")}>Extend history</button>
      <button type="button" className="icon-btn hist-x" aria-label="Dismiss history hint" onClick={dismiss}><X className="h-4 w-4" aria-hidden="true" /></button>
    </div>
  );
}
