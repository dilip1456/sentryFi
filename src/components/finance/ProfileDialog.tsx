import { useEffect, useState, useRef } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { z } from "zod";
import { Loader2, Landmark, Trash2, AlertTriangle, Camera, User } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { NotificationPreferences } from "@/components/NotificationPreferences";

const schema = z.object({
  display_name: z.string().trim().min(1, "Name required").max(80),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  timezone: z.string().trim().max(60).optional().or(z.literal("")),
  avatar_url: z.string().trim().url("Must be a valid URL").max(500).optional().or(z.literal("")),
});

type PlaidItemRow = { id: string; institution_name: string | null; status: string; created_at: string };

// Live US phone formatting as the user types: 5551234567 -> (555) 123-4567
const formatPhone = (raw: string): string => {
  const d = raw.replace(/\D/g, "").slice(0, 10);
  if (d.length === 0) return "";
  if (d.length < 4) return `(${d}`;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
};

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
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState<PlaidItemRow[] | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<PlaidItemRow | null>(null);

  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [activeTab, setActiveTab] = useState<"profile" | "banks" | "notifications">("profile");

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

  // Reset transient UI (active tab, delete confirmation) only when the dialog
  // actually opens — not on every profile refresh (a background auth-token
  // refresh on tab-focus updates `profile` and must NOT bounce the user's tab).
  useEffect(() => {
    if (open) {
      setShowDeleteAccount(false);
      setDeleteConfirmText("");
      setActiveTab("profile");
      loadItems();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep the editable fields in sync with the latest profile, but this must not
  // touch activeTab.
  useEffect(() => {
    if (!open) return;
    setDisplayName(profile?.display_name ?? "");
    setPhone(formatPhone(profile?.phone ?? ""));
    setTimezone(profile?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
    setAvatarUrl(profile?.avatar_url ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, profile]);

  const save = async () => {
    if (!user) return;
    const parsed = schema.safeParse({ display_name: displayName, phone, timezone, avatar_url: avatarUrl });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setBusy(true);
    // upsert (not update): brand-new users may not have a profile row yet, so a
    // plain update would silently affect zero rows and "save" nothing.
    const { error } = await supabase.from("profiles").upsert({
      user_id: user.id,
      display_name: parsed.data.display_name,
      phone: parsed.data.phone || null,
      timezone: parsed.data.timezone || null,
      avatar_url: parsed.data.avatar_url || null,
    }, { onConflict: "user_id" });
    setBusy(false);
    if (error) return toast.error(error.message);
    await refresh();
    toast.success("Profile saved");
    onOpenChange(false);
  };

  const uploadAvatar = async (file: File) => {
    if (!user) return;
    if (!file.type.startsWith("image/")) { toast.error("Please choose an image file"); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("Image must be under 5 MB"); return; }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${user.id}/avatar_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, { upsert: true, cacheControl: "3600" });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      const publicUrl = data.publicUrl;
      setAvatarUrl(publicUrl);
      // Persist immediately so the new photo sticks even without pressing Save.
      const { error: dbErr } = await supabase.from("profiles").upsert(
        { user_id: user.id, avatar_url: publicUrl }, { onConflict: "user_id" });
      if (dbErr) throw dbErr;
      await refresh();
      toast.success("Photo updated");
    } catch (e) {
      toast.error("Upload failed", { description: (e as Error).message });
    } finally {
      setUploading(false);
    }
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
          <div className="font-display text-base text-foreground">Settings</div>
          <div className="text-[11.5px] text-muted-foreground mt-0.5">{user?.email}</div>
          <div className="flex mt-3 p-0.5 rounded-full border border-border bg-surface/40 text-[12px] w-fit">
            {([["profile", "Profile"], ["banks", "Banks"], ["notifications", "Notifications"]] as const).map(([tab, label]) => (
              <button key={tab} type="button" onClick={() => setActiveTab(tab)}
                className={`px-4 py-1 rounded-full transition ${activeTab === tab ? "bg-foreground text-background font-medium" : "text-muted-foreground"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-y-auto flex-1">
          {activeTab === "notifications" && (
            <NotificationPreferences onClose={() => onOpenChange(false)} />
          )}
          {activeTab === "profile" && <>
          <div className="p-5 space-y-4">
            {/* Avatar */}
            <div className="flex items-center gap-4">
              <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
                className="relative h-16 w-16 rounded-full overflow-hidden shrink-0 border border-border grid place-items-center bg-[hsl(var(--primary)/0.12)] group">
                {avatarUrl
                  ? <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
                  : <User className="h-6 w-6 text-[hsl(var(--primary))]" />}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity grid place-items-center">
                  {uploading ? <Loader2 className="h-4 w-4 text-white animate-spin" /> : <Camera className="h-4 w-4 text-white" />}
                </div>
              </button>
              <div className="min-w-0">
                <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
                  className="text-[12.5px] font-medium text-[hsl(var(--primary))] hover:underline disabled:opacity-50">
                  {uploading ? "Uploading…" : avatarUrl ? "Change photo" : "Upload photo"}
                </button>
                <div className="text-[11px] text-muted-foreground mt-0.5">JPG or PNG, up to 5 MB</div>
                {avatarUrl && (
                  <button type="button" onClick={() => setAvatarUrl("")}
                    className="text-[11px] text-muted-foreground hover:text-negative mt-0.5">Remove</button>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) uploadAvatar(f); e.target.value = ""; }} />
            </div>

            {[
              { label: "Display name", value: displayName, set: setDisplayName, ph: "Jordan Reeves", max: 80 },
              { label: "Timezone", value: timezone, set: setTimezone, ph: "America/Los_Angeles", max: 60 },
            ].map((f) => (
              <div key={f.label}>
                <label className="text-[11px] text-muted-foreground">{f.label}</label>
                <input value={f.value} onChange={(e) => f.set(e.target.value)} placeholder={f.ph} maxLength={f.max}
                  className="mt-1 w-full bg-surface/40 border border-border/60 rounded-md px-3 py-2 text-[13px] text-foreground outline-none focus:border-foreground/40" />
              </div>
            ))}
            {/* Phone with live US formatting: (555) 123-4567 */}
            <div>
              <label className="text-[11px] text-muted-foreground">Phone</label>
              <input value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} placeholder="(555) 123-4567"
                type="tel" inputMode="tel" maxLength={16}
                className="mt-1 w-full bg-surface/40 border border-border/60 rounded-md px-3 py-2 text-[13px] text-foreground outline-none focus:border-foreground/40" />
            </div>
            <button onClick={save} disabled={busy}
              className="mt-2 w-full py-2 rounded-md bg-foreground text-background text-[13px] font-medium hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-2">
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save changes
            </button>
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
          </>}

          {activeTab === "banks" && (
            <div className="p-5">
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
                Disconnecting fully revokes access with your bank. It doesn't just remove it from this view.
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

