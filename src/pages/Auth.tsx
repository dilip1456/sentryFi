import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

const schema = z.object({
  email: z.string().trim().email("Enter a valid email").max(255),
  password: z.string().min(8, "At least 8 characters").max(72),
  displayName: z.string().trim().min(1).max(80).optional(),
});

const Auth = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (user && !loading) navigate("/", { replace: true }); }, [user, loading, navigate]);

  if (loading) return <div className="min-h-screen grid place-items-center bg-background"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (user) return <Navigate to="/" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ email, password, displayName: mode === "signup" ? displayName : undefined });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: { display_name: displayName },
          },
        });
        if (error) throw error;
        toast.success("Account created. Check your email to verify.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Welcome back");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Authentication failed";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) { toast.error(error.message ?? "Google sign-in failed"); setBusy(false); }
  };

  return (
    <div className="min-h-screen grid place-items-center bg-background px-4">
      <div className="w-full max-w-sm surface-elevated rounded-2xl p-6 border border-border/60">
        <div className="flex items-center gap-2 mb-5">
          <div className="h-9 w-9 rounded-lg bg-foreground text-background grid place-items-center font-display text-lg font-semibold">S</div>
          <div>
            <div className="font-display text-base text-foreground">SentryFi</div>
            <div className="text-[11px] text-muted-foreground">Personal finance intelligence</div>
          </div>
        </div>

        <div className="flex p-1 mb-4 rounded-full border border-border bg-surface/40 text-[12px]">
          {(["signin", "signup"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 py-1.5 rounded-full transition ${mode === m ? "bg-foreground text-background font-medium" : "text-muted-foreground"}`}
              type="button"
            >
              {m === "signin" ? "Sign in" : "Create account"}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-3">
          {mode === "signup" && (
            <div>
              <label className="text-[11px] text-muted-foreground">Display name</label>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                className="mt-1 w-full bg-surface/40 border border-border/60 rounded-md px-3 py-2 text-[13px] text-foreground outline-none focus:border-foreground/40"
                placeholder="Jordan Reeves" maxLength={80} />
            </div>
          )}
          <div>
            <label className="text-[11px] text-muted-foreground">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full bg-surface/40 border border-border/60 rounded-md px-3 py-2 text-[13px] text-foreground outline-none focus:border-foreground/40"
              placeholder="you@example.com" maxLength={255} autoComplete="email" />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full bg-surface/40 border border-border/60 rounded-md px-3 py-2 text-[13px] text-foreground outline-none focus:border-foreground/40"
              placeholder="••••••••" minLength={8} maxLength={72} autoComplete={mode === "signup" ? "new-password" : "current-password"} />
          </div>
          <button type="submit" disabled={busy}
            className="w-full py-2 rounded-md bg-foreground text-background text-[13px] font-medium hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-2">
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <div className="flex items-center gap-2 my-4 text-[10px] text-muted-foreground">
          <div className="flex-1 h-px bg-border/60" /> OR <div className="flex-1 h-px bg-border/60" />
        </div>

        <button onClick={google} disabled={busy}
          className="w-full py-2 rounded-md border border-border bg-surface/40 hover:bg-surface text-[13px] text-foreground inline-flex items-center justify-center gap-2 disabled:opacity-50">
          <svg className="h-4 w-4" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.77.42 3.44 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/></svg>
          Continue with Google
        </button>

        <div className="mt-4 text-center text-[10.5px] text-muted-foreground">
          By continuing you agree to our Terms & Privacy.
        </div>
      </div>
    </div>
  );
};

export default Auth;
