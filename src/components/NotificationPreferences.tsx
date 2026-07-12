import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Mail, Smartphone, CalendarDays, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface AlertPrefs {
  email_enabled: boolean;
  push_enabled: boolean;
  email: string;
  budget_pct: number;
  low_balance: number;
  payment_days: number;
  weekly_summary: boolean;
}

const DEFAULTS: AlertPrefs = {
  email_enabled: true, push_enabled: true, email: "",
  budget_pct: 90, low_balance: 100, payment_days: 3, weekly_summary: true,
};

// Single reusable switch so every toggle looks and behaves identically.
// Segmented On/Off control — unambiguous (never reads as a radio button).
const Switch = ({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) => (
  <div role="group" aria-label={label} className="inline-flex shrink-0 rounded-lg border border-border-strong overflow-hidden text-[11px] font-semibold select-none">
    <button type="button" aria-pressed={!on} onClick={() => { if (on) onChange(); }}
      className={cn("px-3 py-1.5 transition-colors", !on ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}>
      Off
    </button>
    <button type="button" aria-pressed={on} onClick={() => { if (!on) onChange(); }}
      className={cn("px-3 py-1.5 transition-colors", on ? "bg-[hsl(var(--primary))] text-background" : "text-muted-foreground hover:text-foreground")}>
      On
    </button>
  </div>
);

export const NotificationPreferences = ({ onClose }: { onClose: () => void }) => {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<AlertPrefs>(DEFAULTS);
  const [initial, setInitial] = useState<AlertPrefs>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase.from("alert_preferences").select("*").eq("user_id", user.id).maybeSingle()
      .then(({ data, error }) => {
        if (error) console.warn("[notif-prefs] fetch error:", error.message);
        const loaded = data
          ? { ...DEFAULTS, ...data, email: data.email ?? user.email ?? "" }
          : { ...DEFAULTS, email: user.email ?? "" };
        setPrefs(loaded);
        setInitial(loaded);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [user]);

  const dirty = JSON.stringify(prefs) !== JSON.stringify(initial);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from("alert_preferences").upsert({
      user_id: user.id,
      email_enabled: prefs.email_enabled,
      push_enabled: prefs.push_enabled,
      email: prefs.email || null,
      budget_pct: prefs.budget_pct,
      low_balance: prefs.low_balance,
      payment_days: prefs.payment_days,
      weekly_summary: prefs.weekly_summary,
    }, { onConflict: "user_id" });
    setSaving(false);
    if (error) { toast.error("Failed to save"); return; }
    setInitial(prefs);
    toast.success("Notification preferences saved");
    onClose();
  };

  if (loading) return <div className="p-8 grid place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="flex flex-col">
      <div className="divide-y divide-border/20">
        {/* Channels */}
        <div className="p-5 space-y-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Channels</div>

          {/* Email */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-lg bg-secondary/60 grid place-items-center shrink-0">
                <Mail className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-semibold text-foreground">Email alerts</div>
                <div className="text-[11px] text-muted-foreground">Sent to your inbox</div>
              </div>
              <Switch on={prefs.email_enabled} label="Email alerts" onChange={() => setPrefs(p => ({ ...p, email_enabled: !p.email_enabled }))} />
            </div>
            {prefs.email_enabled && (
              <input value={prefs.email} onChange={e => setPrefs(p => ({ ...p, email: e.target.value }))}
                placeholder="your@email.com" type="email"
                className="w-full h-9 px-3 rounded-lg bg-secondary/40 border border-border text-[13px] outline-none focus:border-[hsl(var(--primary)/0.5)]" />
            )}
          </div>

          {/* Push */}
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-secondary/60 grid place-items-center shrink-0">
              <Smartphone className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13.5px] font-semibold text-foreground">Push notifications</div>
              <div className="text-[11px] text-muted-foreground">Android app alerts</div>
            </div>
            <Switch on={prefs.push_enabled} label="Push notifications" onChange={() => setPrefs(p => ({ ...p, push_enabled: !p.push_enabled }))} />
          </div>

          {/* Weekly summary */}
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-secondary/60 grid place-items-center shrink-0">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13.5px] font-semibold text-foreground">Weekly summary</div>
              <div className="text-[11px] text-muted-foreground">Every Monday morning</div>
            </div>
            <Switch on={prefs.weekly_summary} label="Weekly summary" onChange={() => setPrefs(p => ({ ...p, weekly_summary: !p.weekly_summary }))} />
          </div>
        </div>

        {/* Thresholds */}
        <div className="p-5 space-y-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Alert thresholds</div>

          <div className="space-y-1.5">
            <label className="text-[13px] text-foreground">Budget alert at <span className="font-semibold text-[hsl(var(--primary))]">{prefs.budget_pct}%</span> spent</label>
            <input type="range" min={50} max={100} step={5} value={prefs.budget_pct}
              onChange={e => setPrefs(p => ({ ...p, budget_pct: Number(e.target.value) }))}
              className="w-full accent-[hsl(var(--primary))]" />
            <div className="flex justify-between text-[10px] text-muted-foreground"><span>50%</span><span>100%</span></div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[13px] text-foreground">Low balance alert below <span className="font-semibold text-[hsl(var(--primary))]">${prefs.low_balance}</span></label>
            <input type="range" min={0} max={1000} step={50} value={prefs.low_balance}
              onChange={e => setPrefs(p => ({ ...p, low_balance: Number(e.target.value) }))}
              className="w-full accent-[hsl(var(--primary))]" />
            <div className="flex justify-between text-[10px] text-muted-foreground"><span>$0</span><span>$1,000</span></div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[13px] text-foreground">Payment due warning <span className="font-semibold text-[hsl(var(--primary))]">{prefs.payment_days} days</span> before</label>
            <input type="range" min={1} max={14} step={1} value={prefs.payment_days}
              onChange={e => setPrefs(p => ({ ...p, payment_days: Number(e.target.value) }))}
              className="w-full accent-[hsl(var(--primary))]" />
            <div className="flex justify-between text-[10px] text-muted-foreground"><span>1 day</span><span>14 days</span></div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="p-5 flex gap-2 border-t border-border/20">
        <button onClick={save} disabled={saving || !dirty}
          className="flex-1 h-11 rounded-xl bg-gold text-[14px] font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {dirty ? "Apply changes" : "Saved"}
        </button>
        <button onClick={() => { setPrefs(initial); onClose(); }}
          className="h-11 px-5 rounded-xl border border-border-strong text-[13.5px] text-muted-foreground hover:text-foreground">
          Cancel
        </button>
      </div>
    </div>
  );
};
