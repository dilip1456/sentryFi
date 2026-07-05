import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useAuth } from "./AuthContext";

interface Ctx {
  demo: boolean;
  setDemo: (v: boolean) => void;
  toggle: () => void;
  onHasItemsResolved: (hasItems: boolean) => void;
}
const DemoCtx = createContext<Ctx | null>(null);

const keyFor = (uid: string | undefined) => `sentryfi.demoMode.${uid ?? "anon"}`;

export const DemoProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  // Initialize synchronously from localStorage so there's zero flash
  const [demo, setDemoState] = useState<boolean>(() => {
    try { return localStorage.getItem(keyFor(undefined)) === "true"; }
    catch { return false; }
  });

  // Re-read when user changes (anon key → user-specific key)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(keyFor(user?.id));
      setDemoState(stored === "true");
    } catch { setDemoState(false); }
  }, [user?.id]);

  const setDemo = (v: boolean) => {
    setDemoState(v);
    try { localStorage.setItem(keyFor(user?.id), String(v)); } catch {}
  };

  // Auto-exit demo when real accounts are found
  const onHasItemsResolved = (hasItems: boolean) => {
    if (hasItems) setDemo(false);
  };

  return (
    <DemoCtx.Provider value={{ demo, setDemo, toggle: () => setDemo(!demo), onHasItemsResolved }}>
      {children}
    </DemoCtx.Provider>
  );
};

export const useDemo = () => {
  const c = useContext(DemoCtx);
  if (!c) throw new Error("useDemo must be used within DemoProvider");
  return c;
};
