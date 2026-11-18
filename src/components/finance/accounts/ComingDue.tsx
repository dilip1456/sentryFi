import { CalendarClock, CircleHelp, Hand, Repeat } from "lucide-react";
import { fmtUSD } from "@/lib/format";
import type { ComingDueItem } from "@/lib/accounts/findings";
import { BankAvatar } from "./AccountRow";
import { cn } from "@/lib/utils";

export function AutopayTag({ state }: { state: ComingDueItem["autopay"] }) {
  if (state === "on") return <span className="st-ok inline-flex items-center gap-1"><Repeat className="h-3 w-3" aria-hidden />Autopay</span>;
  if (state === "detected") return <span className="st-warn inline-flex items-center gap-1"><CircleHelp className="h-3 w-3" aria-hidden />Autopay?</span>;
  if (state === "manual") return <span className="st-mute inline-flex items-center gap-1"><Hand className="h-3 w-3" aria-hidden />Pay manually</span>;
  return null;
}

/** Statement, due date and autopay status for the next 30 days (rail card; end of list on mobile). */
export function ComingDue({ items, onOpen }: { items: ComingDueItem[]; onOpen: (i: ComingDueItem) => void }) {
  if (!items.length) return null;
  return (
    <section className="ac-card" aria-label="Coming due" data-testid="ac-coming-due">
      <h3><CalendarClock className="h-4 w-4 text-primary" aria-hidden />Coming due</h3>
      <p className="hs">Next 30 days · from your bank</p>
      {items.map(i => (
        <button key={i.key} type="button" className="ac-li" onClick={() => onOpen(i)}>
          <BankAvatar name={i.view.bankName} />
          <div>
            <div className="t">{i.name}</div>
            <div className="s">
              <span className={cn("due", i.soon && "soon")}>{i.dueLabel}</span>
              {i.autopay && <><span aria-hidden>·</span><AutopayTag state={i.autopay} /></>}
            </div>
          </div>
          {i.amount != null && <div className="r">{fmtUSD(i.amount, { cents: true })}<small>{i.amountLabel}</small></div>}
        </button>
      ))}
    </section>
  );
}
