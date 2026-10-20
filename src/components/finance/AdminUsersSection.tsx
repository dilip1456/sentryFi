import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Shield, ShieldOff, UserCog, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { fmtShortDate } from "@/lib/format-date";

interface Row {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  timezone: string | null;
  disabled: boolean;
  created_at: string;
  roles: string[];
  plan: string | null;
}

export const AdminUsersSection = () => {
  const { user, isAdmin } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  const load = async () => {
    setLoading(true);
    const [{ data: profiles }, { data: roles }, { data: subs }] = await Promise.all([
      supabase.from("profiles").select("user_id,display_name,avatar_url,phone,timezone,disabled,created_at").order("created_at", { ascending: false }),
      supabase.from("user_roles").select("user_id,role"),
      supabase.from("subscribers").select("user_id,plan"),
    ]);
    const roleMap = new Map<string, string[]>();
    (roles ?? []).forEach((r: { user_id: string; role: string }) => {
      const arr = roleMap.get(r.user_id) ?? [];
      arr.push(r.role);
      roleMap.set(r.user_id, arr);
    });
    const planMap = new Map<string, string>();
    (subs ?? []).forEach((s: { user_id: string; plan: string }) => planMap.set(s.user_id, s.plan));
    setRows((profiles ?? []).map((p) => ({
      ...(p as Omit<Row, "roles" | "plan">),
      roles: roleMap.get((p as { user_id: string }).user_id) ?? [],
      plan: planMap.get((p as { user_id: string }).user_id) ?? null,
    })));
    setLoading(false);
  };

  useEffect(() => { if (isAdmin) load(); }, [isAdmin]);

  const toggleAdmin = async (uid: string, makeAdmin: boolean) => {
    if (uid === user?.id && !makeAdmin) {
      toast.error("You can't remove your own admin role.");
      return;
    }
    if (makeAdmin) {
      const { error } = await supabase.from("user_roles").insert({ user_id: uid, role: "admin" });
      if (error) return toast.error(error.message);
      toast.success("Admin role granted");
    } else {
      const { error } = await supabase.from("user_roles").delete().eq("user_id", uid).eq("role", "admin");
      if (error) return toast.error(error.message);
      toast.success("Admin role revoked");
    }
    load();
  };

  const toggleDisabled = async (uid: string, disabled: boolean) => {
    if (uid === user?.id) {
      toast.error("You can't disable your own account.");
      return;
    }
    // Goes through an admin-checked edge function that bans/unbans the auth
    // user and then sets profiles.disabled. Writing the column directly is
    // blocked by a trigger, so a user can't re-enable themselves.
    const { data, error } = await supabase.functions.invoke("admin-set-user-disabled", {
      body: { userId: uid, disabled },
    });
    if (error || data?.error) return toast.error(data?.error ?? error?.message ?? "Could not update user");
    toast.success(disabled ? "User disabled" : "User enabled");
    load();
  };

  if (!isAdmin) return null;

  const filtered = rows.filter((r) =>
    !q ||
    (r.display_name ?? "").toLowerCase().includes(q.toLowerCase()) ||
    r.user_id.includes(q)
  );

  return (
    <section className="space-y-3 animate-fade-up">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display text-lg text-foreground">Users</h2>
          <p className="text-[13px] text-muted-foreground">{rows.length} total · {rows.filter((r) => r.roles.includes("admin")).length} admin · {rows.filter((r) => r.disabled).length} disabled</p>
        </div>
        <div className="flex items-center gap-2 bg-surface/40 border border-border/60 rounded-md px-2 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
            className="bg-transparent text-[13px] text-foreground outline-none w-44" />
        </div>
      </div>

      <div className="rounded-xl border border-border/60 bg-surface/30 overflow-hidden">
        <div className="hidden md:grid grid-cols-[1.5fr_0.8fr_0.8fr_1fr_0.6fr] px-4 py-2 text-[12px] uppercase tracking-wider text-muted-foreground border-b border-border/40 bg-surface/40">
          <div>User</div>
          <div>Plan</div>
          <div>Role</div>
          <div>Joined</div>
          <div className="text-right">Actions</div>
        </div>
        {loading ? (
          <div className="py-10 grid place-items-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-muted-foreground">No users found.</div>
        ) : filtered.map((r) => {
          const isUserAdmin = r.roles.includes("admin");
          const initials = (r.display_name ?? "U").split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase();
          return (
            <div key={r.user_id} className={cn(
              "flex flex-wrap md:grid md:grid-cols-[1.5fr_0.8fr_0.8fr_1fr_0.6fr] px-4 py-3 gap-2 items-center border-b border-border/30 last:border-b-0 hover:bg-surface-hover/30 transition-colors text-[13.5px]",
              r.disabled && "opacity-50"
            )}>
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="h-7 w-7 rounded-full bg-gradient-to-br from-positive/40 to-info/40 border border-border-strong grid place-items-center text-[12px] font-semibold shrink-0">
                  {initials}
                </div>
                <div className="min-w-0">
                  <div className="text-foreground truncate">{r.display_name ?? "Unnamed"}</div>
                  <div className="text-[12px] text-muted-foreground truncate">{r.user_id.slice(0, 8)}…</div>
                </div>
              </div>
              <div className="text-foreground capitalize">{r.plan ?? "none"}</div>
              <div>
                <span className={cn(
                  "inline-flex items-center px-1.5 py-0.5 rounded text-[12px]",
                  isUserAdmin ? "bg-info/15 text-info" : "bg-surface text-muted-foreground"
                )}>{isUserAdmin ? "admin" : "user"}</span>
              </div>
              <div className="text-muted-foreground text-[13px]">{fmtShortDate(r.created_at)}</div>
              <div className="flex items-center justify-end gap-1">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button title={isUserAdmin ? "Revoke admin" : "Make admin"}
                      aria-label={isUserAdmin ? `Revoke admin access from ${r.display_name ?? "this user"}` : `Grant admin access to ${r.display_name ?? "this user"}`}
                      className="h-7 w-7 grid place-items-center rounded hover:bg-surface-hover text-muted-foreground hover:text-foreground">
                      <UserCog className="h-3.5 w-3.5" />
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{isUserAdmin ? "Revoke admin access?" : "Make this user an admin?"}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {isUserAdmin
                          ? `${r.display_name ?? "This user"} will immediately lose admin privileges.`
                          : `${r.display_name ?? "This user"} will gain full admin access, including the ability to manage other users' roles and accounts.`}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => toggleAdmin(r.user_id, !isUserAdmin)}>
                        {isUserAdmin ? "Revoke admin" : "Make admin"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button title={r.disabled ? "Enable user" : "Disable user"}
                      aria-label={r.disabled ? `Enable ${r.display_name ?? "this user"}'s account` : `Disable ${r.display_name ?? "this user"}'s account`}
                      className="h-7 w-7 grid place-items-center rounded hover:bg-surface-hover text-muted-foreground hover:text-foreground">
                      {r.disabled ? <Shield className="h-3.5 w-3.5" /> : <ShieldOff className="h-3.5 w-3.5" />}
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{r.disabled ? "Enable this account?" : "Disable this account?"}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {r.disabled
                          ? `${r.display_name ?? "This user"} will regain access to their account.`
                          : `${r.display_name ?? "This user"} will be locked out of their account immediately.`}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => toggleDisabled(r.user_id, !r.disabled)}
                        className={!r.disabled ? "bg-negative text-negative-foreground hover:bg-negative/90" : undefined}>
                        {r.disabled ? "Enable" : "Disable"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
