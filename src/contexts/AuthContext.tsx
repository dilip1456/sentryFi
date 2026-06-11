import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface Profile {
  display_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  timezone: string | null;
}

interface Subscriber {
  plan: "free" | "pro" | "premium";
  status: string;
  current_period_end: string | null;
}

interface AuthCtx {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  subscriber: Subscriber | null;
  roles: string[];
  isAdmin: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [subscriber, setSubscriber] = useState<Subscriber | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const loadExtras = async (uid: string) => {
    try {
      const [
        { data: p, error: pe },
        { data: s, error: se },
        { data: r, error: re },
      ] = await Promise.all([
        supabase.from("profiles").select("display_name,avatar_url,phone,timezone").eq("user_id", uid).maybeSingle(),
        supabase.from("subscribers").select("plan,status,current_period_end").eq("user_id", uid).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", uid),
      ]);
      if (pe) console.error("[auth] profiles fetch failed:", pe.message);
      if (se) console.error("[auth] subscribers fetch failed:", se.message);
      if (re) console.error("[auth] user_roles fetch failed:", re.message);
      setProfile(p as Profile | null);
      setSubscriber(s as Subscriber | null);
      setRoles((r ?? []).map((x: { role: string }) => x.role));
    } catch (err) {
      console.error("[auth] loadExtras threw:", err);
    }
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, sess) => {
      setSession(prev => prev?.access_token === sess?.access_token ? prev : sess);
      setUser(prev => {
        const next = sess?.user ?? null;
        if (prev?.id === next?.id) return prev;
        return next;
      });
      if (sess?.user) {
        setTimeout(() => { loadExtras(sess.user.id).catch(console.error); }, 0);
      } else {
        setProfile(null); setSubscriber(null); setRoles([]);
      }
    });
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) loadExtras(s.user.id);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const refresh = async () => { if (user) await loadExtras(user.id); };
  const signOut = async () => { await supabase.auth.signOut(); };

  return (
    <Ctx.Provider value={{
      user, session, profile, subscriber, roles,
      isAdmin: roles.includes("admin"),
      loading, refresh, signOut,
    }}>
      {children}
    </Ctx.Provider>
  );
};

export const useAuth = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
};
