import { useState } from "react";
import { Info, Unlink, Trash2, Pencil } from "lucide-react";
import type { AccountView } from "@/lib/accounts/grouping";
import type { AccountMetaEntry } from "@/lib/accounts/types";

const SUGGESTIONS: Record<string, string[]> = {
  checking: ["Bills account", "Everyday"],
  savings: ["Emergency fund", "House fund", "Vacation fund"],
  credit: ["Travel card", "Bills card"],
  loan: ["Car loan", "Home loan"],
  investment: ["Retirement", "Brokerage"],
  other: ["Home", "Car"],
};

export interface EditSave {
  nickname?: string;
  hidden: boolean;
  excludeFromNetWorth: boolean;
  apr?: number;
  promoApr?: number;
  promoEndDate?: string;
  customUrl?: string;
}

function Toggle({ checked, disabled, onChange, title, sub, testId }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; title: string; sub: string; testId?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} className="ac-tg" onClick={() => onChange(!checked)} data-testid={testId}>
      <span className="min-w-0"><span className="t block">{title}</span><span className="s block">{sub}</span></span>
      <span className="sw" aria-hidden />
    </button>
  );
}

/** Rename or hide, pushed inside the details sheet. */
export function AccountEdit({ v, meta, instUrl, onCancel, onSave, onDisconnect, onEditManual, onDeleteManual }: {
  v: AccountView; meta: AccountMetaEntry; instUrl: string | null;
  onCancel: () => void; onSave: (s: EditSave) => void;
  onDisconnect?: () => void; onEditManual?: () => void; onDeleteManual?: () => void;
}) {
  const [name, setName] = useState(meta.nickname ?? "");
  const [hidden, setHidden] = useState(!!meta.hidden);
  const [countNw, setCountNw] = useState(!meta.excludeFromNetWorth);
  const [apr, setApr] = useState(meta.apr != null ? String(meta.apr) : "");
  const [promoApr, setPromoApr] = useState(meta.promoApr != null ? String(meta.promoApr) : "");
  const [promoEnd, setPromoEnd] = useState(meta.promoEndDate ?? "");
  const [customUrl, setCustomUrl] = useState(meta.customUrl ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const linked = v.kind === "linked";
  const numOrUndef = (s: string) => (s.trim() === "" || !Number.isFinite(Number(s)) ? undefined : Number(s));

  const save = () => onSave({
    nickname: name.trim() || undefined,
    hidden,
    excludeFromNetWorth: hidden ? !countNw : false,
    ...(linked ? { apr: numOrUndef(apr), promoApr: numOrUndef(promoApr), promoEndDate: promoApr !== "" ? promoEnd || undefined : undefined, customUrl: customUrl.trim() || undefined } : {}),
  });

  return (
    <div data-testid="ac-edit">
      <div className="ac-field">
        <label htmlFor="ac-nick">Name in SentryFi</label>
        <input id="ac-nick" value={name} onChange={e => setName(e.target.value)} placeholder={v.bankAccountName} autoComplete="off" />
        <small>Bank's name: {v.bankAccountName}. Only you see this.</small>
      </div>
      <div className="ac-sugg">
        {(SUGGESTIONS[v.group] ?? []).slice(0, 3).map(s => <button key={s} type="button" className="chip" onClick={() => setName(s)}>{s}</button>)}
      </div>

      <div className="ac-sec-t">Visibility</div>
      <Toggle checked={hidden} onChange={h => { setHidden(h); if (!h) setCountNw(true); }} title="Hide this account" sub="Removes it from lists, Home and alerts" testId="ac-hide-toggle" />
      <Toggle checked={countNw} disabled={!hidden} onChange={setCountNw} title="Still count it in net worth" sub="Off for duplicates or accounts that aren't yours" testId="ac-nw-toggle" />
      <p className="ac-note"><Info className="h-3.5 w-3.5" aria-hidden />Hidden accounts keep syncing and can be shown again from "Hidden accounts" at the bottom of the list.</p>

      {linked && (
        <details className="ac-more">
          <summary>More details</summary>
          <div>
            <div className="ac-grid2">
              <div className="ac-field"><label htmlFor="ac-apr">{v.group === "savings" ? "APY %" : "APR %"}</label><input id="ac-apr" type="number" inputMode="decimal" value={apr} onChange={e => setApr(e.target.value)} placeholder="e.g. 22.49" /></div>
              <div className="ac-field"><label htmlFor="ac-papr">Promo APR %</label><input id="ac-papr" type="number" inputMode="decimal" value={promoApr} onChange={e => setPromoApr(e.target.value)} placeholder="e.g. 0" /></div>
            </div>
            {promoApr !== "" && (
              <div className="ac-field mt-3"><label htmlFor="ac-pend">Promo expires</label><input id="ac-pend" type="date" value={promoEnd} onChange={e => setPromoEnd(e.target.value)} /></div>
            )}
            <div className="ac-field mt-3">
              <label htmlFor="ac-url">Bank website (optional override)</label>
              <input id="ac-url" type="url" value={customUrl} onChange={e => setCustomUrl(e.target.value)} placeholder={instUrl ?? "https://..."} />
            </div>
          </div>
        </details>
      )}

      <div className="ac-acts">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn-gold" onClick={save} data-testid="ac-edit-save">Save</button>
      </div>
      <div className="mt-3 grid gap-2">
        {linked && onDisconnect && (
          <button type="button" className="btn-danger" onClick={onDisconnect}><Unlink className="h-4 w-4" aria-hidden />Disconnect {v.bankName}…</button>
        )}
        {!linked && onEditManual && (
          <button type="button" className="btn w-full" onClick={onEditManual}><Pencil className="h-4 w-4" aria-hidden />Edit balance and details…</button>
        )}
        {!linked && onDeleteManual && (
          <button type="button" className="btn-danger" onClick={() => (confirmDelete ? onDeleteManual() : setConfirmDelete(true))}>
            <Trash2 className="h-4 w-4" aria-hidden />{confirmDelete ? "Tap again to delete" : "Delete this account…"}
          </button>
        )}
      </div>
    </div>
  );
}
