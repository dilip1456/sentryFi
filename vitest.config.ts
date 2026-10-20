import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { readFileSync } from "fs";
import { exposeInternals } from "./src/test/qa/expose-internals.plugin";

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf-8"));

export default defineConfig({
  // exposeInternals() is test-only: it lets the QA suite reach module-private
  // money helpers without editing the components (see the plugin's header).
  plugins: [exposeInternals(), react()],
  // Mirror the build-time constants from vite.config.ts so modules that read
  // them (app-version.ts, constants.ts) can be imported under test.
  define: {
    __APP_BUILD_TIME__: JSON.stringify("2026-01-01T00:00:00.000Z"),
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify("2026-01-01"),
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
    // The money tests pin "today" with fake timers; pin the zone too so the
    // results don't depend on the machine running them (the app's users are
    // in America/New_York). See tz tests for the other-zone cases.
    env: { TZ: "America/New_York" },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
