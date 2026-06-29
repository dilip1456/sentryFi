import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { z } from "zod";
import { Loader2, Landmark, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

const schema = z.object({
  display_name: z.string().trim().min(1, "Name required").max(80),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  timezone: z.string().trim().max(60).optional().or(z.literal("")),
  avatar_url: z.string().trim().url("Must be a valid URL").max(500).optional().or(z.literal("")),
});

type PlaidItemRow = { id: string; institution_name: string | null; status: string; created_at: string };

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export const ProfileDialog = ({ open, onOpenChange }: Props) => {
  const { user, profile, refresh, signOut } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [timezone, setTimezone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const [items, setItems] = useState<PlaidItemRow[] | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<PlaidItemRow | null>(null);

  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);

  const loadItems = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("plaid_items")
      .select("id, institution_name, status, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) { toast.error("Couldn't load connected banks", { description: error.message }); return; }
    setItems(data ?? []);
  };

  useEffect(() => {
    if (open) {
      setDisplayName(profile?.display_name ?? "");
      setPhone(profile?.phone ?? "");
      setTimezone(profile?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
      setAvatarUrl(profile?.avatar_url ?? "");
      setShowDeleteAccount(false);
      setDeleteConfirmText("");
      loadItems();
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

  const disconnectBank = async (item: PlaidItemRow) => {
    setDisconnectingId(item.id);
    try {
      const { data, error } = await supabase.functions.invoke("plaid-remove-item", {
        body: { itemId: item.id },
      });
      if (error || data?.error) throw new Error(data?.error ?? error?.message ?? "Failed to disconnect");
      toast.success(`Disconnected ${item.institution_name ?? "bank"}`);
      setConfirmDisconnect(null);
      // A full reload is the simplest way to make sure every screen (accounts,
      // transactions, hasItems gating, etc.) reflects the removed connection.
      window.location.reload();
    } catch (e) {
      toast.error("Couldn't disconnect", { description: (e as Error).message });
    } finally {
      setDisconnectingId(null);
    }
  };

  const deleteAccount = async () => {
    setDeletingAccount(true);
    try {
      const { data, error } = await supabase.functions.invoke("delete-account", { body: {} });
      if (error || data?.error) throw new Error(data?.error ?? error?.message ?? "Failed to delete account");
      toast.success("Account deleted");
      await signOut();
      navigate("/auth");
    } catch (e) {
      toast.error("Couldn't delete account", { description: (e as Error).message });
      setDeletingAccount(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md surface-elevated p-0 gap-0 overflow-hidden max-h-[85vh] flex flex-col">
        <DialogTitle className="sr-only">Profile</DialogTitle>
        <DialogDescription className="sr-only">Edit your profile, manage connected banks, or delete your account.</DialogDescription>
        <div className="p-5 border-b border-border/40 shrink-0">
          <div className="font-display text-base text-foreground">Your profile</div>
          <div className="text-[11.5px] text-muted-foreground mt-0.5">{user?.email}</div>
        </div>
        <div className="overflow-y-auto flex-1">
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

          {/* ── Connected banks ── */}
          <div className="px-5 pb-5">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Connected banks</div>
            {items === null ? (
              <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
            ) : items.length === 0 ? (
              <div className="text-[12px] text-muted-foreground">No banks connected.</div>
            ) : (
              <div className="space-y-2">
                {items.map((item) => (
                  <div key={item.id} className="flex items-center gap-2.5 surface-card px-3 py-2.5">
                    <div className="h-8 w-8 rounded-lg bg-secondary/60 grid place-items-center shrink-0">
                      <Landmark className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12.5px] text-foreground font-medium truncate">{item.institution_name ?? "Connected bank"}</div>
                      <div className="text-[10px] text-muted-foreground capitalize">{item.status}</div>
                    </div>
                    {confirmDisconnect?.id === item.id ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button onClick={() => disconnectBank(item)} disabled={disconnectingId === item.id}
                          className="h-7 px-2.5 rounded-md bg-negative text-white text-[11px] font-medium hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1">
                          {disconnectingId === item.id && <Loader2 className="h-3 w-3 animate-spin" />} Confirm
                        </button>
                        <button onClick={() => setConfirmDisconnect(null)} className="h-7 px-2 rounded-md border border-border-strong text-[11px] text-muted-foreground hover:text-foreground">
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmDisconnect(item)}
                        className="text-[11px] font-medium text-negative hover:underline shrink-0">Disconnect</button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="text-[10px] text-muted-foreground mt-2">
              Disconnecting fully revokes access with your bank — it doesn't just remove it from this view.
            </div>
          </div>

          {/* ── Danger zone: delete account ── */}
          <div className="px-5 pb-5">
            <div className="border-t border-negative/20 pt-4">
              {!showDeleteAccount ? (
                <button onClick={() => setShowDeleteAccount(true)}
                  className="inline-flex items-center gap-1.5 text-[12px] text-negative hover:underline">
                  <Trash2 className="h-3.5 w-3.5" /> Delete account
                </button>
              ) : (
                <div className="rounded-lg border border-negative/30 bg-negative/5 p-3.5 space-y-2.5">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-negative shrink-0 mt-0.5" />
                    <div className="text-[12px] text-foreground">
                      This permanently deletes your account, disconnects every linked bank, and erases all your data. This can't be undone.
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Type <span className="font-semibold text-foreground">DELETE</span> to confirm</label>
                    <input value={deleteConfirmText} onChange={(e) => setDeleteConfirmText(e.target.value)}
                      className="mt-1 w-full bg-surface/40 border border-negative/30 rounded-md px-3 py-2 text-[13px] text-foreground outline-none focus:border-negative" />
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={deleteAccount} disabled={deleteConfirmText !== "DELETE" || deletingAccount}
                      className="flex-1 h-9 rounded-md bg-negative text-white text-[12.5px] font-medium hover:opacity-90 disabled:opacity-40 inline-flex items-center justify-center gap-1.5">
                      {deletingAccount && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Permanently delete my account
                    </button>
                    <button onClick={() => { setShowDeleteAccount(false); setDeleteConfirmText(""); }}
                      className="h-9 px-3 rounded-md border border-border-strong text-[12.5px] text-muted-foreground hover:text-foreground">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

