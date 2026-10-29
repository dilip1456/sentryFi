import { useEffect, useState, useRef } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { isValidTimeZone } from "@/lib/timezone";
import { z } from "zod";
import { Loader2, Landmark, Trash2, Camera, User, X, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { NotificationPreferences } from "@/components/NotificationPreferences";
import { AppUpdateSettings } from "@/components/app-update/AppUpdateSettings";
import { isUpdateSupported } from "@/lib/app-update/native";

const schema = z.object({
  display_name: z.string().trim().min(1, "Name required").max(80),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  timezone: z.string().trim().max(60)
    .refine(isValidTimeZone, "Use a time zone name like America/New_York").optional().or(z.literal("")),
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
  const [confirmFullResync, setConfirmFullResync] = useState(false);
  const [fullResyncing, setFullResyncing] = useState(false);

  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [activeTab, setActiveTab] = useState<"profile" | "banks" | "notifications" | "app">("profile");

  // "App" (update settings) only exists in the Android APK.
  const settingsTabs: ReadonlyArray<readonly ["profile" | "banks" | "notifications" | "app", string]> = [
    ["profile", "Profile"], ["banks", "Banks"], ["notifications", "Notifications"],
    ...(isUpdateSupported() ? [["app", "App"] as const] : []),
  ];

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

  // Re-walks every linked bank's history from the start (no sync cursor), so
  // older transactions pick up fields added since they were first synced
  // (e.g. Plaid's detailed category) and rows a failed sync skipped come back.
  // Nothing is deleted; existing transactions are updated in place.
  const fullResync = async () => {
    setFullResyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("plaid-sync-transactions", {
        body: { full_resync: true },
      });
      if (error || data?.error) throw new Error(data?.error ?? error?.message ?? "Full resync failed");
      const synced = data?.synced ?? 0;
      toast.success(`Full resync complete: ${synced} transaction${synced !== 1 ? "s" : ""} refreshed`);
      setConfirmFullResync(false);
      // Same as disconnect: reload so every screen shows the refreshed data.
      window.location.reload();
    } catch (e) {
      toast.error("Full resync failed", { description: (e as Error).message });
    } finally {
      setFullResyncing(false);
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
      {/* Fixed height so switching tabs doesn't make the modal jump. */}
      <DialogContent className="max-w-md surface-elevated p-0 gap-0 overflow-hidden h-[min(640px,85vh)] flex flex-col">
        <DialogTitle className="sr-only">Profile</DialogTitle>
        <DialogDescription className="sr-only">Edit your profile, manage connected banks, or delete your account.</DialogDescription>
        <div className="relative p-5 border-b border-border/40 shrink-0">
          <DialogClose aria-label="Close settings" title="Close"
            className="absolute top-3.5 right-3.5 h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X className="h-4 w-4" />
          </DialogClose>
          <div className="font-display text-base text-foreground pr-10">Settings</div>
          <div className="text-[13px] text-muted-foreground mt-0.5">{user?.email}</div>
          <div className="flex mt-3 p-0.5 rounded-full border border-border bg-surface/40 text-[13px] w-fit">
            {settingsTabs.map(([tab, label]) => (
              <button key={tab} type="button" onClick={() => setActiveTab(tab)}
                className={`${settingsTabs.length > 3 ? "px-3" : "px-4"} py-1 rounded-full transition ${activeTab === tab ? "bg-foreground text-background font-medium" : "text-muted-foreground"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-y-auto flex-1">
          {activeTab === "notifications" && (
            <NotificationPreferences onClose={() => onOpenChange(false)} />
          )}
          {activeTab === "app" && (
            <div className="p-5"><AppUpdateSettings /></div>
          )}
          {activeTab === "profile" && <>
          <div className="p-5 space-y-4">
            {/* Avatar */}
            <div className="flex items-center gap-4">
              <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
                aria-label="Change profile photo"
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
                  className="text-[13.5px] font-medium text-[hsl(var(--primary))] hover:underline disabled:opacity-50">
                  {uploading ? "Uploading…" : avatarUrl ? "Change photo" : "Upload photo"}
                </button>
                <div className="text-[12.5px] text-muted-foreground mt-0.5">JPG or PNG, up to 5 MB</div>
                {avatarUrl && (
                  <button type="button" onClick={() => setAvatarUrl("")}
                    className="text-[12.5px] text-muted-foreground hover:text-negative mt-0.5">Remove</button>
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
                <label className="text-[12.5px] text-muted-foreground">{f.label}</label>
                <input value={f.value} onChange={(e) => f.set(e.target.value)} placeholder={f.ph} maxLength={f.max}
                  className="mt-1 w-full bg-surface/40 border border-border/60 rounded-md px-3 py-2 text-[14px] text-foreground outline-none focus:border-foreground/40" />
              </div>
            ))}
            {/* Phone with live US formatting: (555) 123-4567 */}
            <div>
              <label className="text-[12.5px] text-muted-foreground">Phone</label>
              <input value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} placeholder="(555) 123-4567"
                type="tel" inputMode="tel" maxLength={16}
                className="mt-1 w-full bg-surface/40 border border-border/60 rounded-md px-3 py-2 text-[14px] text-foreground outline-none focus:border-foreground/40" />
            </div>
            <button onClick={save} disabled={busy}
              className="mt-2 w-full py-2 rounded-md bg-foreground text-background text-[14px] font-medium hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-2">
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save changes
            </button>
          </div>

          {/* ── Danger zone: delete account ── */}
          <div className="px-5 pb-5">
            <div className="border-t border-negative/20 pt-4">
              <button onClick={() => { setDeleteConfirmText(""); setShowDeleteAccount(true); }}
                className="inline-flex items-center gap-1.5 text-[13px] text-negative hover:underline">
                <Trash2 className="h-3.5 w-3.5" /> Delete account
              </button>
              <ConfirmDialog
                open={showDeleteAccount}
                onOpenChange={o => { setShowDeleteAccount(o); if (!o) setDeleteConfirmText(""); }}
                title="Delete your account?"
                description="This permanently deletes your account, disconnects every linked bank, and erases all your data. This can't be undone."
                confirmLabel="Permanently delete"
                busy={deletingAccount}
                confirmDisabled={deleteConfirmText !== "DELETE"}
                onConfirm={deleteAccount}>
                <div>
                  <label htmlFor="delete-confirm" className="text-[12.5px] text-muted-foreground">Type <span className="font-semibold text-foreground">DELETE</span> to confirm</label>
                  <input id="delete-confirm" value={deleteConfirmText} onChange={(e) => setDeleteConfirmText(e.target.value)} autoComplete="off"
                    className="mt-1 w-full bg-surface/40 border border-negative/30 rounded-md px-3 py-2 text-[14px] text-foreground outline-none focus:border-negative" />
                </div>
              </ConfirmDialog>
            </div>
          </div>
          </>}

          {activeTab === "banks" && (
            <div className="p-5">
              <div className="text-[12.5px] uppercase tracking-wider text-muted-foreground mb-2">Connected banks</div>
              {items === null ? (
                <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
              ) : items.length === 0 ? (
                <div className="text-[13px] text-muted-foreground">No banks connected.</div>
              ) : (
                <div className="space-y-2">
                  {items.map((item) => (
                    <div key={item.id} className="flex items-center gap-2.5 surface-card px-3 py-2.5">
                      <div className="h-8 w-8 rounded-lg bg-secondary/60 grid place-items-center shrink-0">
                        <Landmark className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13.5px] text-foreground font-medium truncate">{item.institution_name ?? "Connected bank"}</div>
                        <div className="text-[12px] text-muted-foreground capitalize">{item.status}</div>
                      </div>
                      <button onClick={() => setConfirmDisconnect(item)}
                        className="text-[12.5px] font-medium text-negative hover:underline shrink-0">Disconnect</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="text-[12px] text-muted-foreground mt-2">
                Disconnecting fully revokes access with your bank. It doesn't just remove it from this view.
              </div>
              <ConfirmDialog
                open={confirmDisconnect !== null}
                onOpenChange={o => { if (!o) setConfirmDisconnect(null); }}
                title={`Disconnect ${confirmDisconnect?.institution_name ?? "this bank"}?`}
                description="SentryFi will revoke its access with the bank and stop syncing these accounts. You can link it again later."
                confirmLabel="Disconnect"
                busy={disconnectingId !== null}
                onConfirm={() => { if (confirmDisconnect) return disconnectBank(confirmDisconnect); }} />

              {items !== null && items.length > 0 && (
                <div className="mt-5">
                  <div className="text-[12.5px] uppercase tracking-wider text-muted-foreground mb-2">Full resync</div>
                  <div className="flex items-center gap-2.5 surface-card px-3 py-2.5">
                    <div className="flex-1 min-w-0 text-[12.5px] text-muted-foreground">
                      Re-download all transaction history from your banks. Use it if older transactions look wrong or are missing. Your categories and notes are kept.
                    </div>
                    <button onClick={() => setConfirmFullResync(true)} disabled={fullResyncing}
                      aria-label="Full resync of all banks"
                      className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-foreground hover:underline shrink-0 disabled:opacity-50">
                      <RefreshCw className={`h-3.5 w-3.5 ${fullResyncing ? "animate-spin" : ""}`} /> Full resync
                    </button>
                  </div>
                </div>
              )}
              <ConfirmDialog
                open={confirmFullResync}
                onOpenChange={o => { if (!o && !fullResyncing) setConfirmFullResync(false); }}
                title="Run a full resync?"
                description="SentryFi will re-download your full transaction history from every connected bank. This can take a minute. Nothing is deleted."
                confirmLabel="Full resync"
                destructive={false}
                busy={fullResyncing}
                onConfirm={fullResync} />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

