import { createContext, useContext, useEffect, useState, ReactNode } from "react";

type Theme = "dark" | "light";
const KEY = "sentryfi.theme";

interface Ctx {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}
const ThemeCtx = createContext<Ctx | null>(null);

const apply = (t: Theme) => {
  const root = document.documentElement;
  root.classList.remove("dark", "light");
  root.classList.add(t);
  root.style.colorScheme = t;
};

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return "dark";
    return (localStorage.getItem(KEY) as Theme) || "dark";
  });

  useEffect(() => {
    apply(theme);
    localStorage.setItem(KEY, theme);
  }, [theme]);

  return (
    <ThemeCtx.Provider value={{
      theme, setTheme: setThemeState,
      toggle: () => setThemeState(t => t === "dark" ? "light" : "dark"),
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
