import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useAuth } from "./AuthContext";

interface Ctx { demo: boolean; setDemo: (v: boolean) => void; toggle: () => void }
const DemoCtx = createContext<Ctx | null>(null);

const keyFor = (uid: string | undefined) => `atlas.demoMode.${uid ?? "anon"}`;

export const DemoProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  // New users default to FALSE — start with no data.
  const [demo, setDemoState] = useState<boolean>(false);

  useEffect(() => {
    const stored = localStorage.getItem(keyFor(user?.id));
    setDemoState(stored === "true");
  }, [user?.id]);

  const setDemo = (v: boolean) => {
    setDemoState(v);
    localStorage.setItem(keyFor(user?.id), String(v));
  };

  return (
    <DemoCtx.Provider value={{ demo, setDemo, toggle: () => setDemo(!demo) }}>
      {children}
    </DemoCtx.Provider>
  );
};

export const useDemo = () => {
  const c = useContext(DemoCtx);
  if (!c) throw new Error("useDemo must be used within DemoProvider");
  return c;
};
