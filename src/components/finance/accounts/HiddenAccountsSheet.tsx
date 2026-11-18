import { Eye } from "lucide-react";
import { fmtUSD } from "@/lib/format";
import { identifierOf, type AccountView } from "@/lib/accounts/grouping";
import { AccountsSheet } from "./AccountsSheet";
import { BankAvatar } from "./AccountRow";

export function HiddenAccountsSheet({ open, views, onClose, onShow }: { open: boolean; views: AccountView[]; onClose: () => void; onShow: (v: AccountView) => void }) {
  return (
    <AccountsSheet open={open} onClose={onClose} title="Hidden accounts" testId="ac-hidden-sheet"
      subtitle="Still syncing · tap Show to bring one back">
      {views.map(v => (
        <div key={v.key} className="ac-li">
          <BankAvatar name={v.kind === "manual" ? "Manual" : v.bankName} />
          <div>
            <div className="t">{v.name}</div>
            <div className="s s2">
              <span>{identifierOf(v)} · {fmtUSD(v.balance, { cents: true })}</span>
              <span>{v.countsInNetWorth ? "Still counted in net worth" : "Not counted in net worth"}</span>
            </div>
          </div>
          <button type="button" className="btn ib" onClick={() => onShow(v)}><Eye className="h-4 w-4" aria-hidden />Show</button>
        </div>
      ))}
      <p className="ac-note">Hide more from an account's details: Rename or hide.</p>
    </AccountsSheet>
  );
}
