import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { type ManualAccount, type ManualAccountInput, estimateRemainingBalance } from "@/hooks/useManualAccounts";
import { ROLE_META, type AccountRole } from "@/hooks/useAccountRoles";
import {
  Building2, Car, GraduationCap, Briefcase, TrendingUp,
  Wallet, CreditCard, HelpCircle, ChevronRight, ChevronLeft,
  Home, Check,
} from "lucide-react";

const ACCOUNT_TYPES: { type: string; label: string; icon: React.ReactNode; role: AccountRole; desc: string }[] = [
  { type: "mortgage",      label: "Mortgage",       icon: <Home className="h-5 w-5" />,           role: "debt",       desc: "Home loan from any servicer" },
  { type: "auto_loan",     label: "Auto Loan",      icon: <Car className="h-5 w-5" />,             role: "debt",       desc: "Car, truck, or motorcycle loan" },
  { type: "student_loan",  label: "Student Loan",   icon: <GraduationCap className="h-5 w-5" />,   role: "debt",       desc: "Federal or private student debt" },
  { type: "personal_loan", label: "Personal Loan",  icon: <Briefcase className="h-5 w-5" />,       role: "debt",       desc: "Unsecured personal loan" },
  { type: "investment",    label: "Investment",     icon: <TrendingUp className="h-5 w-5" />,      role: "investment", desc: "401k, IRA, brokerage, HSA" },
  { type: "savings",       label: "Savings",        icon: <Wallet className="h-5 w-5" />,          role: "buffer",     desc: "Savings or money market account" },
  { type: "credit_card",   label: "Credit Card",    icon: <CreditCard className="h-5 w-5" />,      role: "debt",       desc: "Credit card balance" },
  { type: "other",         label: "Other",          icon: <HelpCircle className="h-5 w-5" />,      role: "unassigned", desc: "Any other account or asset" },
];

const ROLES_FOR_PICKER: AccountRole[] = ["spending", "buffer", "reserve", "savings_goal", "investment", "debt", "unassigned"];

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSave: (input: ManualAccountInput, id?: string) => Promise<boolean>;
  editing?: ManualAccount | null;
}

const empty = (): Partial<ManualAccountInput> => ({
  name: "", institution_name: "", type: "mortgage",
  current_balance: undefined, role: "debt", role_label: "",
  original_loan_amount: undefined, interest_rate: undefined,
  monthly_payment: undefined, loan_start_date: "", loan_term_years: undefined,
  property_address: "", property_value: undefined, notes: "",
});

export const ManualAccountDialog = ({ open, onOpenChange, onSave, editing }: Props) => {
  const [step, setStep] = useState<"type" | "details" | "role" | "done">("type");
  const [form, setForm] = useState<Partial<ManualAccountInput>>(empty());
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isLoan = ["mortgage", "auto_loan", "student_loan", "personal_loan"].includes(form.type ?? "");
  const isMortgage = form.type === "mortgage";

  // Auto-estimate balance for loans when all fields are present
  const estimate = (isLoan && form.original_loan_amount && form.interest_rate && form.loan_term_years && form.loan_start_date)
    ? estimateRemainingBalance(form.original_loan_amount, form.interest_rate, form.loan_term_years, form.loan_start_date)
    : null;

  useEffect(() => {
    if (open) {
      if (editing) {
        setForm({ ...editing });
        setStep("details");
      } else {
        setForm(empty());
        setStep("type");
      }
      setErrors({});
    }
  }, [open, editing]);

  const set = (k: keyof ManualAccountInput, v: unknown) =>
    setForm(f => ({ ...f, [k]: v }));

  const numOrNull = (s: string) => s === "" ? null : (isNaN(Number(s)) ? null : Number(s));

  const validateDetails = () => {
    const e: Record<string, string> = {};
    if (!form.name?.trim()) e.name = "Name is required";
    if (form.current_balance == null && !estimate) e.current_balance = "Balance is required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validateDetails()) return;
    setSaving(true);
    const payload: ManualAccountInput = {
      name: form.name ?? "",
      institution_name: form.institution_name ?? null,
      type: form.type ?? "other",
      current_balance: form.current_balance ?? (estimate ? Math.round(estimate.balance) : null),
      role: form.role ?? "unassigned",
      role_label: form.role_label ?? null,
      original_loan_amount: form.original_loan_amount ?? null,
      interest_rate: form.interest_rate ?? null,
      monthly_payment: form.monthly_payment ?? null,
      loan_start_date: form.loan_start_date ?? null,
      loan_term_years: form.loan_term_years ?? null,
      property_address: form.property_address ?? null,
      property_value: form.property_value ?? null,
      notes: form.notes ?? null,
    };
    const ok = await onSave(payload, editing?.id);
    setSaving(false);
    if (ok) setStep("done");
  };

  const typeInfo = ACCOUNT_TYPES.find(t => t.type === form.type);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg surface-elevated border-border p-0 gap-0 overflow-hidden max-h-[90dvh] flex flex-col">
        <DialogTitle className="sr-only">Add manual account</DialogTitle>
        <DialogDescription className="sr-only">Enter account details manually</DialogDescription>

        {/* Header */}
        <div className="px-5 py-4 border-b border-border/30 shrink-0 flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-gold/10 grid place-items-center text-gold shrink-0">
            {typeInfo?.icon ?? <HelpCircle className="h-4 w-4" />}
          </div>
          <div>
            <div className="font-semibold text-[14px] text-foreground">
              {editing ? "Edit account" : "Add account manually"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {step === "type" ? "Choose account type" : step === "details" ? "Enter details" : step === "role" ? "Assign to Money Map" : "Account saved"}
            </div>
          </div>
          {/* Step dots */}
          {!editing && (
            <div className="ml-auto flex items-center gap-1.5">
              {(["type", "details", "role"] as const).map((s, i) => (
                <div key={s} className={cn("h-1.5 w-1.5 rounded-full transition-colors",
                  step === s ? "bg-gold" : ["type", "details", "role"].indexOf(step) > i ? "bg-gold/50" : "bg-border")} />
              ))}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* STEP: TYPE */}
          {step === "type" && (
            <div className="grid grid-cols-2 gap-2.5">
              {ACCOUNT_TYPES.map(t => (
                <button key={t.type} onClick={() => { set("type", t.type); set("role", t.role); }}
                  className={cn("text-left p-3.5 rounded-xl border transition-all",
                    form.type === t.type
                      ? "border-gold bg-gold/5 shadow-[0_0_0_1px_hsl(var(--gold)/0.5)]"
                      : "border-border hover:border-border-strong bg-surface-card")}>
                  <div className={cn("h-8 w-8 rounded-lg grid place-items-center mb-2",
                    form.type === t.type ? "bg-gold/15 text-gold" : "bg-surface-hover text-muted-foreground")}>
                    {t.icon}
                  </div>
                  <div className="text-[13px] font-semibold text-foreground">{t.label}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{t.desc}</div>
                </button>
              ))}
            </div>
          )}

          {/* STEP: DETAILS */}
          {step === "details" && (
            <div className="space-y-4">
              {/* Institution + Name */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[12px] font-medium text-muted-foreground">Lender / Institution</label>
                  <input
                    value={form.institution_name ?? ""}
                    onChange={e => set("institution_name", e.target.value)}
                    placeholder={isMortgage ? "Provident Funding" : "Chase, Vanguard..."}
                    className="w-full h-9 rounded-lg border border-border bg-surface-card px-3 text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-gold/60"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[12px] font-medium text-muted-foreground">Account nickname *</label>
                  <input
                    value={form.name ?? ""}
                    onChange={e => set("name", e.target.value)}
                    placeholder={isMortgage ? "Home mortgage" : "My account"}
                    className={cn("w-full h-9 rounded-lg border bg-surface-card px-3 text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-gold/60",
                      errors.name ? "border-red-500/60" : "border-border")}
                  />
                  {errors.name && <p className="text-[11px] text-red-400">{errors.name}</p>}
                </div>
              </div>

              {/* Mortgage-specific fields */}
              {isMortgage && (
                <div className="space-y-1.5">
                  <label className="text-[12px] font-medium text-muted-foreground">Property address</label>
                  <input
                    value={form.property_address ?? ""}
                    onChange={e => set("property_address", e.target.value)}
                    placeholder="123 Main St, San Francisco CA 94102"
                    className="w-full h-9 rounded-lg border border-border bg-surface-card px-3 text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-gold/60"
                  />
                </div>
              )}

              {/* Loan details (all loan types) */}
              {isLoan && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-[12px] font-medium text-muted-foreground">Original loan amount</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground">$</span>
                        <input
                          type="number" min="0" step="1000"
                          value={form.original_loan_amount ?? ""}
                          onChange={e => set("original_loan_amount", numOrNull(e.target.value))}
                          placeholder="450,000"
                          className="w-full h-9 rounded-lg border border-border bg-surface-card pl-6 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-gold/60"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[12px] font-medium text-muted-foreground">Interest rate (%)</label>
                      <input
                        type="number" min="0" max="30" step="0.01"
                        value={form.interest_rate ?? ""}
                        onChange={e => set("interest_rate", numOrNull(e.target.value))}
                        placeholder="6.75"
                        className="w-full h-9 rounded-lg border border-border bg-surface-card px-3 text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-gold/60"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-[12px] font-medium text-muted-foreground">Monthly payment</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground">$</span>
                        <input
                          type="number" min="0"
                          value={form.monthly_payment ?? ""}
                          onChange={e => set("monthly_payment", numOrNull(e.target.value))}
                          placeholder="2,850"
                          className="w-full h-9 rounded-lg border border-border bg-surface-card pl-6 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-gold/60"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[12px] font-medium text-muted-foreground">Loan start date</label>
                      <input
                        type="date"
                        value={form.loan_start_date ?? ""}
                        onChange={e => set("loan_start_date", e.target.value)}
                        className="w-full h-9 rounded-lg border border-border bg-surface-card px-3 text-[13px] text-foreground focus:outline-none focus:border-gold/60"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[12px] font-medium text-muted-foreground">Loan term</label>
                      <select
                        value={form.loan_term_years ?? ""}
                        onChange={e => set("loan_term_years", e.target.value === "" ? null : Number(e.target.value))}
                        className="w-full h-9 rounded-lg border border-border bg-surface-card px-3 text-[13px] text-foreground focus:outline-none focus:border-gold/60">
                        <option value="">Select</option>
                        <option value="5">5 yr</option>
                        <option value="10">10 yr</option>
                        <option value="15">15 yr</option>
                        <option value="20">20 yr</option>
                        <option value="25">25 yr</option>
                        <option value="30">30 yr</option>
                      </select>
                    </div>
                  </div>

                  {/* Auto-estimated balance callout */}
                  {estimate ? (
                    <div className="rounded-xl border border-gold/20 bg-gold/5 px-4 py-3 space-y-1">
                      <div className="text-[11px] text-gold font-semibold uppercase tracking-wide">Estimated from your loan details</div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-[22px] font-bold text-foreground">${Math.round(estimate.balance).toLocaleString()}</span>
                        <span className="text-[12px] text-muted-foreground">remaining balance</span>
                      </div>
                      <div className="text-[11.5px] text-muted-foreground">
                        Payoff in approx. {Math.ceil(estimate.monthsRemaining / 12)} yrs ({estimate.payoffDate.toLocaleDateString("en-US", { month: "short", year: "numeric" })})
                      </div>
                      <div className="text-[11px] text-muted-foreground/60 mt-1">
                        Or enter the exact balance from your latest statement below.
                      </div>
                    </div>
                  ) : null}
                </>
              )}

              {/* Current balance (all types) */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[12px] font-medium text-muted-foreground">
                    {isLoan ? "Current balance (override)" : "Current balance *"}
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground">$</span>
                    <input
                      type="number" min="0"
                      value={form.current_balance ?? ""}
                      onChange={e => set("current_balance", numOrNull(e.target.value))}
                      placeholder={estimate ? String(Math.round(estimate.balance)) : "0"}
                      className={cn("w-full h-9 rounded-lg border bg-surface-card pl-6 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-gold/60",
                        errors.current_balance ? "border-red-500/60" : "border-border")}
                    />
                  </div>
                  {errors.current_balance && <p className="text-[11px] text-red-400">{errors.current_balance}</p>}
                </div>
                {isMortgage && (
                  <div className="space-y-1.5">
                    <label className="text-[12px] font-medium text-muted-foreground">Property value (est.)</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground">$</span>
                      <input
                        type="number" min="0" step="1000"
                        value={form.property_value ?? ""}
                        onChange={e => set("property_value", numOrNull(e.target.value))}
                        placeholder="550,000"
                        className="w-full h-9 rounded-lg border border-border bg-surface-card pl-6 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-gold/60"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Equity callout for mortgage */}
              {isMortgage && form.property_value && (form.current_balance ?? (estimate?.balance ?? 0)) > 0 && (
                <div className="rounded-xl border border-[hsl(var(--primary)/0.2)] bg-[hsl(var(--primary)/0.05)] px-4 py-3">
                  <div className="text-[11px] text-[hsl(var(--primary))] font-semibold uppercase tracking-wide mb-1">Home equity</div>
                  <div className="text-[20px] font-bold text-foreground">
                    ${(form.property_value - (form.current_balance ?? Math.round(estimate?.balance ?? 0))).toLocaleString()}
                  </div>
                  <div className="text-[11.5px] text-muted-foreground">
                    {((1 - (form.current_balance ?? Math.round(estimate?.balance ?? 0)) / form.property_value) * 100).toFixed(1)}% equity
                  </div>
                </div>
              )}

              {/* Notes */}
              <div className="space-y-1.5">
                <label className="text-[12px] font-medium text-muted-foreground">Notes (optional)</label>
                <textarea
                  rows={2}
                  value={form.notes ?? ""}
                  onChange={e => set("notes", e.target.value)}
                  placeholder="Any other details..."
                  className="w-full rounded-lg border border-border bg-surface-card px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-gold/60 resize-none"
                />
              </div>
            </div>
          )}

          {/* STEP: ROLE */}
          {step === "role" && (
            <div className="space-y-2">
              <p className="text-[12.5px] text-muted-foreground mb-3">
                How should this account affect your True Available balance in Money Map?
              </p>
              {ROLES_FOR_PICKER.map(r => (
                <button key={r} onClick={() => set("role", r)}
                  className={cn("w-full text-left px-4 py-3 rounded-xl border transition-all flex items-start gap-3",
                    form.role === r
                      ? "border-gold bg-gold/5"
                      : "border-border hover:border-border-strong bg-surface-card")}>
                  <div className={cn("h-5 w-5 rounded-full border-2 shrink-0 mt-0.5 grid place-items-center",
                    form.role === r ? "border-gold bg-gold" : "border-border")}>
                    {form.role === r && <Check className="h-3 w-3 text-background" />}
                  </div>
                  <div>
                    <div className="text-[13px] font-semibold text-foreground">{ROLE_META[r].name}</div>
                    <div className="text-[11.5px] text-muted-foreground mt-0.5">{ROLE_META[r].description}</div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* STEP: DONE */}
          {step === "done" && (
            <div className="py-6 text-center space-y-3">
              <div className="h-14 w-14 rounded-full bg-gold/10 border border-gold/30 grid place-items-center mx-auto">
                <Check className="h-6 w-6 text-gold" />
              </div>
              <div className="text-[16px] font-semibold text-foreground">Account saved!</div>
              <div className="text-[13px] text-muted-foreground">
                {form.name} has been added to your dashboard and Money Map.
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {step !== "done" && (
          <div className="px-5 py-4 border-t border-border/30 shrink-0 flex items-center gap-3">
            {step !== "type" && (
              <button onClick={() => setStep(step === "role" ? "details" : "type")}
                className="flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground transition-colors">
                <ChevronLeft className="h-4 w-4" /> Back
              </button>
            )}
            <div className="flex-1" />
            {step === "type" && (
              <button onClick={() => setStep("details")}
                disabled={!form.type}
                className="flex items-center gap-1.5 h-9 px-5 rounded-lg bg-gold text-background text-[13px] font-semibold disabled:opacity-40">
                Next <ChevronRight className="h-4 w-4" />
              </button>
            )}
            {step === "details" && (
              <button onClick={() => { if (validateDetails()) setStep("role"); }}
                className="flex items-center gap-1.5 h-9 px-5 rounded-lg bg-gold text-background text-[13px] font-semibold">
                Next <ChevronRight className="h-4 w-4" />
              </button>
            )}
            {step === "role" && (
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-1.5 h-9 px-5 rounded-lg bg-gold text-background text-[13px] font-semibold disabled:opacity-60">
                {saving ? "Saving..." : "Save account"}
              </button>
            )}
          </div>
        )}
        {step === "done" && (
          <div className="px-5 py-4 border-t border-border/30 shrink-0 flex justify-center">
            <button onClick={() => onOpenChange(false)}
              className="h-9 px-6 rounded-lg bg-gold text-background text-[13px] font-semibold">
              Done
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
