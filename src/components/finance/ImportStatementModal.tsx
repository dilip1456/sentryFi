/**
 * Import Statement — upload one or more bank statement PDFs, review what got
 * extracted, pick which linked account each part belongs to, and merge it
 * into the same plaid_transactions dataset every other screen reads from.
 * Every imported row is tagged "Imported" through the app's existing tag
 * system, so it's filterable from the transaction table's tag filter without
 * any separate "imported transactions" view to maintain.
 *
 * A single PDF can describe more than one account — a combined statement
 * (checking plus several savings sub-accounts, say) — so the parser returns
 * one group per account it finds, and each group gets its own "which linked
 * account is this for" picker rather than one picker for the whole file.
 */
import { useState, useCallback } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { fmtUSD } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload, FileText, X, AlertTriangle, Loader2 } from "lucide-react";
import { extractPdfLines, parseStatement, buildImportTransactionId, type ParsedStatementTxn } from "@/lib/statement-import";
import { fmtShortDate } from "@/lib/format-date";

const IMPORT_TAG = "Imported";

interface AccountOption {
  account_id: string;
  item_id?: string | null;
  name?: string | null;
  official_name?: string | null;
  mask?: string | null;
}

interface DetectedGroup {
  groupId: string;
  file: string;
  label: string;
  hint?: string;
  accountId: string;
}

interface PreviewRow extends ParsedStatementTxn {
  id: string;
  groupId: string;
  include: boolean;
}

export interface ImportStatementModalProps {
  open: boolean;
  onClose: () => void;
  accounts: AccountOption[];
  userId: string;
  onAddTag: (id: string, tag: string) => void;
  onImported: () => void;
}

export function ImportStatementModal({ open, onClose, accounts, userId, onAddTag, onImported }: ImportStatementModalProps) {
  const [groups, setGroups] = useState<DetectedGroup[]>([]);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [unrecognizedFiles, setUnrecognizedFiles] = useState<string[]>([]);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);

  const reset = useCallback(() => {
    setGroups([]); setRows([]); setUnrecognizedFiles([]); setParsing(false); setImporting(false);
  }, []);

  const close = () => { reset(); onClose(); };

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setParsing(true);
    const files = Array.from(fileList);
    const nextGroups: DetectedGroup[] = [];
    const nextRows: PreviewRow[] = [];
    const unrecognized: string[] = [];
    try {
      for (const file of files) {
        try {
          const lines = await extractPdfLines(file);
          const { accounts: blocks, recognizedFormat } = parseStatement(lines);
          if (!recognizedFormat) unrecognized.push(file.name);
          for (const block of blocks) {
            if (block.txns.length === 0) continue;
            const groupId = crypto.randomUUID();
            const matched = block.hint ? accounts.find(a => a.mask && a.mask === block.hint) : undefined;
            nextGroups.push({ groupId, file: file.name, label: block.label, hint: block.hint, accountId: matched?.account_id ?? "" });
            for (const t of block.txns) nextRows.push({ ...t, id: crypto.randomUUID(), groupId, include: true });
          }
        } catch (e) {
          toast.error(`Couldn't read ${file.name}`, { description: (e as Error)?.message });
        }
      }
      setGroups(prev => [...prev, ...nextGroups]);
      setRows(prev => [...prev, ...nextRows]);
      setUnrecognizedFiles(prev => [...prev, ...unrecognized]);
      if (nextRows.length === 0 && unrecognized.length === 0) {
        toast.error("No transactions found in that file");
      }
    } finally {
      setParsing(false);
    }
  };

  const toggleRow = (id: string) => setRows(prev => prev.map(r => r.id === id ? { ...r, include: !r.include } : r));
  const setGroupAccount = (groupId: string, accountId: string) => setGroups(prev => prev.map(g => g.groupId === groupId ? { ...g, accountId } : g));
  const removeGroup = (groupId: string) => {
    setGroups(prev => prev.filter(g => g.groupId !== groupId));
    setRows(prev => prev.filter(r => r.groupId !== groupId));
  };

  const included = rows.filter(r => r.include);
  const totalIn = included.filter(r => r.amount < 0).reduce((s, r) => s + Math.abs(r.amount), 0);
  const totalOut = included.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0);
  const groupsMissingAccount = groups.some(g => !g.accountId && rows.some(r => r.groupId === g.groupId && r.include));
  const filesShown = Array.from(new Set(groups.map(g => g.file)));

  const doImport = async () => {
    if (included.length === 0 || groupsMissingAccount) return;
    setImporting(true);
    try {
      const groupById = new Map(groups.map(g => [g.groupId, g]));
      const accountById = new Map(accounts.map(a => [a.account_id, a]));
      for (const g of groups) {
        if (!accountById.get(g.accountId)?.item_id && rows.some(r => r.groupId === g.groupId && r.include)) {
          toast.error(`"${g.label}" is mapped to an account that isn't linked to a Plaid item. Pick a different account`);
          setImporting(false);
          return;
        }
      }
      // Postgres's ON CONFLICT DO UPDATE errors ("cannot affect row a second
      // time") if the SAME conflict key appears twice within one statement —
      // this can happen even on a first-ever import, since two genuinely
      // different transactions can share the same date/description/amount
      // (e.g. two identical same-day charges), which hash to the same id.
      // Rather than silently dropping the second one, give repeats within
      // this batch a disambiguating suffix so both survive as distinct rows;
      // the first occurrence keeps the plain hash so re-importing the same
      // file later still upserts onto the same rows instead of duplicating.
      const seen = new Map<string, number>();
      const insertRows = included.map(r => {
        const group = groupById.get(r.groupId)!;
        const account = accountById.get(group.accountId)!;
        const baseId = buildImportTransactionId(account.account_id, r.date, r.description, r.amount);
        const n = seen.get(baseId) ?? 0;
        seen.set(baseId, n + 1);
        return {
          user_id: userId,
          item_id: account.item_id as string,
          account_id: account.account_id,
          transaction_id: n === 0 ? baseId : `${baseId}_${n}`,
          date: r.date,
          name: r.description,
          merchant_name: null,
          amount: r.amount,
          category: null,
          pending: false,
        };
      });
      const { data, error } = await supabase
        .from("plaid_transactions")
        .upsert(insertRows, { onConflict: "transaction_id" })
        .select("id");
      if (error) throw error;
      // Tag using the real post-upsert row ids (a re-import that matches an
      // existing row via onConflict keeps that row's original id, not
      // whatever id we generated client-side) so the "Imported" tag always
      // lands on the actual row.
      for (const row of data ?? []) onAddTag(row.id, IMPORT_TAG);
      toast.success(`Imported ${included.length} transaction${included.length !== 1 ? "s" : ""}`);
      onImported();
      close();
    } catch (e) {
      toast.error("Import failed", { description: (e as Error)?.message });
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogTitle>Import statement</DialogTitle>
        <DialogDescription>
          Upload one or more bank statement PDFs. Every transaction found gets merged into your
          transaction list and tagged "{IMPORT_TAG}" so you can find it again later. A statement covering
          several accounts (checking plus savings, say) is split into one group per account below.
        </DialogDescription>

        {groups.length === 0 && unrecognizedFiles.length === 0 ? (
          <label className="mt-2 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border/50 py-10 cursor-pointer hover:border-[hsl(var(--primary)/0.5)] hover:bg-muted/10 transition-colors">
            <input type="file" accept="application/pdf" multiple className="hidden"
              onChange={e => handleFiles(e.target.files)} disabled={parsing}/>
            {parsing ? (
              <>
                <Loader2 className="h-6 w-6 text-muted-foreground animate-spin"/>
                <p className="text-[12.5px] text-muted-foreground">Reading statement…</p>
              </>
            ) : (
              <>
                <Upload className="h-6 w-6 text-muted-foreground/60"/>
                <p className="text-[12.5px] text-foreground font-medium">Choose PDF statements</p>
                <p className="text-[11px] text-muted-foreground/70">You can select more than one at a time</p>
              </>
            )}
          </label>
        ) : (
          <div className="flex flex-col flex-1 min-h-0 gap-3 mt-1">
            {unrecognizedFiles.length > 0 && (
              <div className="flex items-start gap-2 rounded-lg bg-warning/10 border border-warning/25 px-3 py-2">
                <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5"/>
                <p className="text-[11px] text-foreground">
                  Didn't recognize the layout of {unrecognizedFiles.join(", ")}, rows were extracted with a best-effort
                  scan. Double-check dates, descriptions and amounts before importing.
                </p>
              </div>
            )}

            <label className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/50 py-2 cursor-pointer hover:border-[hsl(var(--primary)/0.5)] transition-colors text-[11.5px] text-muted-foreground">
              <input type="file" accept="application/pdf" multiple className="hidden" onChange={e => handleFiles(e.target.files)} disabled={parsing}/>
              {parsing ? <Loader2 className="h-3.5 w-3.5 animate-spin"/> : <Upload className="h-3.5 w-3.5"/>}
              Add more files
            </label>

            <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-border/30 divide-y divide-border/20">
              {filesShown.map(file => (
                <div key={file}>
                  {groups.filter(g => g.file === file).map(g => {
                    const groupRows = rows.filter(r => r.groupId === g.groupId);
                    return (
                      <div key={g.groupId} className="border-b border-border/20 last:border-b-0">
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/20 sticky top-0 flex-wrap">
                          <FileText className="h-3 w-3 text-muted-foreground/60 shrink-0"/>
                          <span className="text-[11px] font-medium text-foreground truncate">{g.label}</span>
                          {g.hint && <span className="text-[10px] text-muted-foreground/60 shrink-0">••{g.hint}</span>}
                          <span className="text-[10px] text-muted-foreground/50 truncate">{file}</span>
                          <span className="text-[10.5px] text-muted-foreground/70 shrink-0 ml-auto">{groupRows.length} txns</span>
                          <select value={g.accountId} onChange={e => setGroupAccount(g.groupId, e.target.value)}
                            className={cn("h-7 max-w-[190px] rounded-lg border text-[11px] text-foreground px-1.5 outline-none shrink-0",
                              !g.accountId ? "border-warning/50 bg-warning/10" : "border-border/60 bg-muted/40")}>
                            <option value="">Which account?</option>
                            {accounts.map(a => (
                              <option key={a.account_id} value={a.account_id}>
                                {a.name ?? a.official_name ?? "Account"}{a.mask ? ` ••${a.mask}` : ""}
                              </option>
                            ))}
                          </select>
                          <button onClick={() => removeGroup(g.groupId)} aria-label={`Remove ${g.label}`}
                            className="h-5 w-5 grid place-items-center rounded text-muted-foreground/50 hover:text-negative shrink-0"><X className="h-3 w-3"/></button>
                        </div>
                        {groupRows.map(r => (
                          <label key={r.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/10 cursor-pointer">
                            <input type="checkbox" checked={r.include} onChange={() => toggleRow(r.id)} className="shrink-0"/>
                            <span className="text-[10.5px] text-muted-foreground tabular shrink-0 w-16">{fmtShortDate(r.date)}</span>
                            <span className="text-[11px] text-foreground truncate flex-1 min-w-0" title={r.description}>{r.description}</span>
                            <span className={cn("text-[11px] font-semibold tabular shrink-0 w-20 text-right", r.amount < 0 ? "text-positive" : "text-foreground")}>
                              {r.amount < 0 ? "+" : ""}{fmtUSD(Math.abs(r.amount))}
                            </span>
                          </label>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between gap-3 pt-1 border-t border-border/20">
              <div className="text-[11px] text-muted-foreground">
                {included.length} selected · <span className="text-positive font-medium">{fmtUSD(totalIn)} in</span> · <span className="font-medium">{fmtUSD(totalOut)} out</span>
              </div>
              {groupsMissingAccount && (
                <span className="text-[10.5px] text-warning font-medium">Pick an account for every group above</span>
              )}
            </div>

            <div className="flex items-center justify-end gap-2">
              <button onClick={close} className="h-8 px-3 rounded-lg text-[11.5px] text-muted-foreground hover:text-foreground">Cancel</button>
              <button onClick={doImport} disabled={included.length === 0 || groupsMissingAccount || importing}
                className="h-8 px-3.5 rounded-lg bg-gold text-[11.5px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5">
                {importing && <Loader2 className="h-3 w-3 animate-spin"/>}
                Import {included.length} transaction{included.length !== 1 ? "s" : ""}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
