import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf-8"));

// `vite preview` serves the production build with the same security headers
// Vercel sends (vercel.json, source "/(.*)"), so CSP problems show up locally
// before deploy. HSTS and upgrade-insecure-requests are dropped because preview
// runs on plain http://localhost. Not applied to the dev server: Vite's HMR
// client and React Refresh need inline scripts and ws://.
const vercelHeaders = (): Record<string, string> => {
  try {
    const cfg = JSON.parse(readFileSync(path.resolve(__dirname, "vercel.json"), "utf-8"));
    const all = (cfg.headers ?? []).find((h: { source: string }) => h.source === "/(.*)");
    const out: Record<string, string> = {};
    for (const { key, value } of all?.headers ?? []) {
      if (key === "Strict-Transport-Security") continue;
      out[key] = key === "Content-Security-Policy"
        ? value.split(";").map((d: string) => d.trim()).filter((d: string) => d && d !== "upgrade-insecure-requests").join("; ")
        : value;
    }
    return out;
  } catch {
    return {};
  }
};

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  preview: {
    headers: vercelHeaders(),
  },
  define: {
    // Baked in at build time so every build (web or mobile) can show exactly when it was built —
    // makes it obvious on-device whether you're running a stale APK or the latest one.
    __APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
