/** "Extend history" hint shown when a connected bank has less than ~2 years. */
import { useEffect } from "react";
import { History, X } from "lucide-react";
import { toast } from "sonner";
import { historyHintBanks, historyHintKey, historyLabel } from "@/lib/relink/history";
import { openSettings } from "@/lib/settings-nav";
import { usePicture } from "./state";

const names = (xs: string[]) => xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

function getReminder(banks: NonNullable<ReturnType<typeof usePicture>["props"]["banks"]>, dismissedInsights: string[]) {
  const show = historyHintBanks(banks, dismissedInsights);
  const one = show.length === 1 ? show[0] : null;
  const text = one
    ? `${one.institution} has ${historyLabel(one.days).replace(/^About/, "about").replace(/ of history$/, "")} of history.`
    : `${names(show.map(b => b.institution))} have less than 2 years of history.`;
  return { show, text, key: show.map(b => b.itemId).join(":") };
}

/** Inline reminder retained on the original financial picture screen. */
export function HistoryHint() {
  const pc = usePicture();
  const { banks = [], dismissedInsights = [] } = pc.props;
  const { show, text } = getReminder(banks, dismissedInsights);
  if (!show.length) return null;
  const dismiss = () => pc.props.onUpdate({ dismissedInsights: [...new Set([...dismissedInsights, ...show.map(b => historyHintKey(b.itemId))])] });
  return (
    <div className="hist-hint" role="note" data-testid="history-hint">
      <History className="h-4 w-4 shrink-0 text-[hsl(var(--primary))]" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="hist-t">{text}</div>
        <div className="note">Re-link to get up to 2 years so yearly bills and paychecks are detected.</div>
      </div>
      <button type="button" className="btn hist-go" onClick={() => openSettings("banks")}>Extend history</button>
      <button type="button" className="icon-btn hist-x" aria-label="Dismiss history hint" onClick={dismiss}><X className="h-4 w-4" /></button>
    </div>
  );
}

/** Brief floating reminder shown when entering the redesigned screen. */
export function HistoryToast() {
  const { banks = [], dismissedInsights = [] } = usePicture().props;
  const { show, text, key } = getReminder(banks, dismissedInsights);
  useEffect(() => {
    if (!show.length) return;
    toast.info(text, {
      id: `fp-history-${key}`,
      description: "More bank history helps detect yearly bills and recurring paychecks.",
      duration: 6000,
      action: { label: "Extend history", onClick: () => openSettings("banks") },
    });
  }, [key, show.length, text]);
  return null;
}
