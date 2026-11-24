import { Check, EyeOff, Moon, Percent, Repeat, Sparkles, Copy, X } from "lucide-react";
import type { AccountFinding } from "@/lib/accounts/findings";

const ICON = { autopay: Repeat, dormant: Moon, duplicate: Copy, apy: Percent } as const;
const SECONDARY: Record<AccountFinding["kind"], string> = { autopay: "Not autopay", dormant: "Keep", duplicate: "Not a copy", apy: "Not now" };

/**
 * "Worth a look" card under the hero (hidden when there's nothing). No count:
 * every inference is its own row with one primary tap and a quiet dismiss.
 */
export function ThingsToConfirmCard({ findings, onAccept, onDismiss }: {
  findings: AccountFinding[]; onAccept: (f: AccountFinding) => void; onDismiss: (f: AccountFinding) => void;
}) {
  if (!findings.length) return null;
  return (
    <section className="ac-look" aria-label="Worth a look" data-testid="ac-things">
      <h3><Sparkles className="h-4 w-4 text-primary" aria-hidden />Worth a look</h3>
      {findings.map(f => {
        const Icon = ICON[f.kind];
        const PrimaryIcon = f.kind === "dormant" || f.kind === "duplicate" ? EyeOff : Check;
        return (
          <div key={f.id} className="ac-look-row" data-finding={f.kind}>
            <span className="ic" aria-hidden><Icon className="h-4 w-4" /></span>
            <div className="tx">
              <div className="t">{f.title}</div>
              <div className="s">{f.detail}</div>
            </div>
            <div className="acts">
              <button type="button" className="btn-gold" onClick={() => onAccept(f)}><PrimaryIcon className="h-4 w-4" aria-hidden />{f.action}</button>
              <button type="button" className="ac-ib tap-44" aria-label={`${SECONDARY[f.kind]}: ${f.title}`} title={SECONDARY[f.kind]} onClick={() => onDismiss(f)}><X className="h-4 w-4" aria-hidden /></button>
            </div>
          </div>
        );
      })}
    </section>
  );
}

/** One finding with its one primary action (used in the sheet and inline in details). */
export function FindingBox({ f, onAccept, onDismiss }: { f: AccountFinding; onAccept: (f: AccountFinding) => void; onDismiss: (f: AccountFinding) => void }) {
  const Icon = ICON[f.kind];
  const PrimaryIcon = f.kind === "dormant" || f.kind === "duplicate" ? EyeOff : Check;
  return (
    <div className="ac-infer" data-finding={f.kind}>
      <Icon className="h-4 w-4" aria-hidden />
      <div className="min-w-0">
        <div className="t">{f.title}</div>
        <div className="s">{f.detail}</div>
        <div className="acts">
          <button type="button" className="btn-gold" onClick={() => onAccept(f)}><PrimaryIcon className="h-4 w-4" aria-hidden />{f.action}</button>
          <button type="button" className="btn" onClick={() => onDismiss(f)}>{SECONDARY[f.kind]}</button>
        </div>
      </div>
    </div>
  );
}
