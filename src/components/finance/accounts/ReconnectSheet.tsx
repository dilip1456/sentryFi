import { Info, RefreshCw } from "lucide-react";
import { fmtUSD } from "@/lib/format";
import { shortDate, type AccountView } from "@/lib/accounts/grouping";
import { AccountsSheet } from "./AccountsSheet";
import { BankAvatar } from "./AccountRow";
import type { BrokenBank } from "./SyncAlert";

/** Why it happened, 3 steps, affected accounts, what stays, Reconnect / Remind me tomorrow. */
export function ReconnectSheet({ bank, views, onClose, onReconnect, onSnooze, busy }: {
  bank: BrokenBank | null; views: AccountView[]; onClose: () => void;
  onReconnect: () => void; onSnooze: () => void; busy?: boolean;
}) {
  const affected = bank ? views.filter(v => v.itemId === bank.itemId) : [];
  return (
    <AccountsSheet open={!!bank} onClose={onClose} testId="ac-reconnect-sheet"
      title={bank ? `Reconnect ${bank.bankName}` : "Reconnect"}
      subtitle={bank ? `${bank.accounts} account${bank.accounts === 1 ? "" : "s"} paused${bank.since ? ` since ${shortDate(bank.since)}` : ""}` : ""}>
      {bank && (
        <>
          <div className="ac-pay">
            <BankAvatar name={bank.bankName} />
            <div className="min-w-0">
              <div className="t">{bank.bankName} asked you to sign in again</div>
              <div className="s">This happens after a password change or every few months for security.</div>
            </div>
          </div>
          <ol className="ac-steps">
            <li>Tap Reconnect. Plaid opens {bank.bankName}'s sign-in.</li>
            <li>Sign in and approve the same accounts.</li>
            <li>We catch up on balances and transactions{bank.since ? ` since ${shortDate(bank.since)}` : ""}.</li>
          </ol>
          <div className="ac-kv">
            {affected.map(v => [
              <div key={`${v.key}-n`} className="min-w-0"><span className="truncate">{v.name}{v.mask ? ` ··${v.mask}` : ""}</span></div>,
              <div key={`${v.key}-v`}>{fmtUSD(v.balance, { cents: true })}</div>,
            ])}
          </div>
          <p className="ac-note"><Info className="h-3.5 w-3.5" aria-hidden />Your nicknames, hidden settings, categories and history stay. Nothing is deleted.</p>
          <div className="mt-4 grid gap-2">
            <button type="button" className="btn-gold w-full" onClick={onReconnect} disabled={busy}><RefreshCw className="h-4 w-4" aria-hidden />Reconnect {bank.bankName}</button>
            <button type="button" className="btn w-full" onClick={onSnooze}>Remind me tomorrow</button>
          </div>
        </>
      )}
    </AccountsSheet>
  );
}
