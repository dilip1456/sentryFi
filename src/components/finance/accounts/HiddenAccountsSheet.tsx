import { Eye } from "lucide-react";
import { fmtUSD } from "@/lib/format";
import { identifierOf, type AccountView } from "@/lib/accounts/grouping";
import { AccountsSheet } from "./AccountsSheet";
import { BankAvatar } from "./AccountRow";

export function HiddenAccountsSheet({ open, views, onClose, onShow }: { open: boolean; views: AccountView[]; onClose: () => void; onShow: (v: AccountView) => void }) {
  const n = views.length;
  const out = views.filter(v => !v.countsInNetWorth).length;
  return (
    <AccountsSheet open={open} onClose={onClose} title="Hidden accounts" testId="ac-hidden-sheet"
      subtitle={`${n} hidden · ${out ? `${out} left out of net worth` : "still syncing"}`}>
      {views.map(v => (
        <div key={v.key} className="ac-li">
          <BankAvatar name={v.kind === "manual" ? "Manual" : v.bankName} />
          <div>
            <div className="t">{v.name}</div>
            <div className="s"><span className="truncate">{identifierOf(v)} · {fmtUSD(v.balance, { cents: true })} · {v.countsInNetWorth ? "in net worth" : "not in net worth"}</span></div>
          </div>
          <button type="button" className="btn ib" onClick={() => onShow(v)}><Eye className="h-4 w-4" aria-hidden />Show</button>
        </div>
      ))}
      <p className="ac-note">Hide more from an account's details: Rename or hide.</p>
    </AccountsSheet>
  );
}
