import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Bell, Mail, Smartphone, ChevronDown, ChevronUp, Save, Loader2 } from "lucide-react";
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

export const NotificationPreferences = ({ onClose }: { onClose: () => void }) => {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<AlertPrefs>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase.from("alert_preferences").select("*").eq("user_id", user.id).maybeSingle()
      .then(({ data }) => {
        if (data) setPrefs({ ...DEFAULTS, ...data, email: data.email ?? user.email ?? "" });
        else setPrefs({ ...DEFAULTS, email: user.email ?? "" });
        setLoading(false);
      });
  }, [user]);

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
    toast.success("Notification preferences saved");
    onClose();
  };

  if (loading) return <div className="p-8 grid place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-0 divide-y divide-border/20">
      {/* Email */}
      <div className="p-5 space-y-3">
        <div className="flex items-center gap-2.5">
          <Mail className="h-4 w-4 text-muted-foreground" />
          <span className="text-[13.5px] font-semibold text-foreground flex-1">Email alerts</span>
          <button onClick={() => setPrefs(p => ({ ...p, email_enabled: !p.email_enabled }))}
            className={cn("w-11 h-6 rounded-full transition-colors relative", prefs.email_enabled ? "bg-[hsl(var(--primary))]" : "bg-border")}>
            <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform", prefs.email_enabled ? "translate-x-5" : "translate-x-0.5")} />
          </button>
        </div>
        {prefs.email_enabled && (
          <input value={prefs.email} onChange={e => setPrefs(p => ({ ...p, email: e.target.value }))}
            placeholder="your@email.com" type="email"
            className="w-full h-9 px-3 rounded-lg bg-secondary/40 border border-border text-[13px] outline-none focus:border-[hsl(var(--primary)/0.5)]" />
        )}
      </div>

      {/* Push */}
      <div className="p-5 flex items-center gap-2.5">
        <Smartphone className="h-4 w-4 text-muted-foreground" />
        <div className="flex-1">
          <div className="text-[13.5px] font-semibold text-foreground">Push notifications</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Android app alerts</div>
        </div>
        <button onClick={() => setPrefs(p => ({ ...p, push_enabled: !p.push_enabled }))}
          className={cn("w-11 h-6 rounded-full transition-colors relative shrink-0", prefs.push_enabled ? "bg-[hsl(var(--primary))]" : "bg-border")}>
          <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform", prefs.push_enabled ? "translate-x-5" : "translate-x-0.5")} />
        </button>
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

        <label className="flex items-center gap-3 cursor-pointer select-none">
          <input type="checkbox" checked={prefs.weekly_summary}
            onChange={e => setPrefs(p => ({ ...p, weekly_summary: e.target.checked }))}
            className="h-4 w-4 rounded accent-[hsl(var(--primary))]" />
          <div>
            <div className="text-[13px] text-foreground">Weekly summary email</div>
            <div className="text-[11px] text-muted-foreground">Every Monday morning</div>
          </div>
        </label>
      </div>

      {/* Save */}
      <div className="p-5">
        <button onClick={save} disabled={saving}
          className="w-full h-11 rounded-xl bg-gold text-[14px] font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save preferences
        </button>
      </div>
    </div>
  );
};
