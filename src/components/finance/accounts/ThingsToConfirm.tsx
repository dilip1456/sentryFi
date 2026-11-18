import { Check, ChevronRight, EyeOff, Moon, Percent, Repeat, Sparkles, Copy } from "lucide-react";
import type { AccountFinding } from "@/lib/accounts/findings";
import { AccountsSheet } from "./AccountsSheet";

const ICON = { autopay: Repeat, dormant: Moon, duplicate: Copy, apy: Percent } as const;
const SECONDARY: Record<AccountFinding["kind"], string> = { autopay: "Not autopay", dormant: "Keep", duplicate: "Not a copy", apy: "Not now" };

/** "N things to confirm" card under the hero (hidden when there are none). */
export function ThingsToConfirmCard({ findings, onOpen }: { findings: AccountFinding[]; onOpen: () => void }) {
  if (!findings.length) return null;
  const n = findings.length;
  return (
    <button type="button" className="ac-check" onClick={onOpen} data-testid="ac-things">
      <Sparkles className="h-5 w-5 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="t block">{n} thing{n === 1 ? "" : "s"} to confirm</span>
        <span className="s block">{findings.map(f => f.title).join(" · ")}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
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

export function ThingsToConfirmSheet({ open, findings, onClose, onAccept, onDismiss }: {
  open: boolean; findings: AccountFinding[]; onClose: () => void;
  onAccept: (f: AccountFinding) => void; onDismiss: (f: AccountFinding) => void;
}) {
  return (
    <AccountsSheet open={open} onClose={onClose} title="Things to confirm" subtitle="We spotted these in your data" testId="ac-things-sheet">
      {findings.length === 0
        ? <p className="text-[13.5px] text-muted-foreground">All caught up.</p>
        : findings.map(f => <FindingBox key={f.id} f={f} onAccept={onAccept} onDismiss={onDismiss} />)}
    </AccountsSheet>
  );
}
