import { createContext, useContext, useEffect, useState, ReactNode } from "react";

type Theme = "dark" | "light";
const KEY = "sentrifi.theme";
const COMPACT_KEY = "sentrifi.compact";

interface Ctx {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
  compact: boolean;
  setCompact: (v: boolean) => void;
}
const ThemeCtx = createContext<Ctx | null>(null);

const apply = (t: Theme, compact: boolean) => {
  const root = document.documentElement;
  root.classList.remove("dark", "light");
  root.classList.add(t);
  root.style.colorScheme = t;
  if (compact) root.classList.add("compact");
  else root.classList.remove("compact");
};

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return "dark";
    return (localStorage.getItem(KEY) as Theme) || "dark";
  });
  const [compact, setCompactState] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(COMPACT_KEY) === "true";
  });

  useEffect(() => {
    apply(theme, compact);
    localStorage.setItem(KEY, theme);
    localStorage.setItem(COMPACT_KEY, String(compact));
  }, [theme, compact]);

  return (
    <ThemeCtx.Provider value={{
      theme, setTheme: setThemeState,
      toggle: () => setThemeState(t => t === "dark" ? "light" : "dark"),
      compact, setCompact: setCompactState,
    }}>
      {children}
    </ThemeCtx.Provider>
  );
};

export const useTheme = () => {
  const c = useContext(ThemeCtx);
  if (!c) throw new Error("useTheme must be used within ThemeProvider");
  return c;
};
