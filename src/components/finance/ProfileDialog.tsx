import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

const schema = z.object({
  display_name: z.string().trim().min(1, "Name required").max(80),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  timezone: z.string().trim().max(60).optional().or(z.literal("")),
  avatar_url: z.string().trim().url("Must be a valid URL").max(500).optional().or(z.literal("")),
});

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export const ProfileDialog = ({ open, onOpenChange }: Props) => {
  const { user, profile, refresh } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [timezone, setTimezone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setDisplayName(profile?.display_name ?? "");
      setPhone(profile?.phone ?? "");
      setTimezone(profile?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
      setAvatarUrl(profile?.avatar_url ?? "");
    }
  }, [open, profile]);

  const save = async () => {
    if (!user) return;
    const parsed = schema.safeParse({ display_name: displayName, phone, timezone, avatar_url: avatarUrl });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("profiles").update({
      display_name: parsed.data.display_name,
      phone: parsed.data.phone || null,
      timezone: parsed.data.timezone || null,
      avatar_url: parsed.data.avatar_url || null,
    }).eq("user_id", user.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    await refresh();
    toast.success("Profile saved");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md surface-elevated p-0 gap-0 overflow-hidden">
        <DialogTitle className="sr-only">Profile</DialogTitle>
        <DialogDescription className="sr-only">Edit your profile.</DialogDescription>
        <div className="p-5 border-b border-border/40">
          <div className="font-display text-base text-foreground">Your profile</div>
          <div className="text-[11.5px] text-muted-foreground mt-0.5">{user?.email}</div>
        </div>
        <div className="p-5 space-y-3">
          {[
            { label: "Display name", value: displayName, set: setDisplayName, ph: "Jordan Reeves", max: 80 },
            { label: "Phone", value: phone, set: setPhone, ph: "+1 555 123 4567", max: 30 },
            { label: "Timezone", value: timezone, set: setTimezone, ph: "America/Los_Angeles", max: 60 },
            { label: "Avatar URL", value: avatarUrl, set: setAvatarUrl, ph: "https://…", max: 500 },
          ].map((f) => (
            <div key={f.label}>
              <label className="text-[11px] text-muted-foreground">{f.label}</label>
              <input value={f.value} onChange={(e) => f.set(e.target.value)} placeholder={f.ph} maxLength={f.max}
                className="mt-1 w-full bg-surface/40 border border-border/60 rounded-md px-3 py-2 text-[13px] text-foreground outline-none focus:border-foreground/40" />
            </div>
          ))}
          <button onClick={save} disabled={busy}
            className="mt-2 w-full py-2 rounded-md bg-foreground text-background text-[13px] font-medium hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-2">
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save changes
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
