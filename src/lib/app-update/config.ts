// In-app update for the sideloaded Android APK.
//
// Both URLs are fixed here on purpose: nothing a user (or version.json) supplies can
// point the updater at another host. ApkUpdaterPlugin.java enforces the same origin
// natively. Keep the two in sync.
export const UPDATE_ORIGIN = "https://sentryfiapp.vercel.app";
export const VERSION_JSON_URL = `${UPDATE_ORIGIN}/downloads/version.json`;
export const DEFAULT_APK_PATH = "/downloads/SentryFi.apk";

// Automatic checks (launch / resume) run at most this often. "Check now" ignores it.
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export const STORAGE_KEYS = {
  lastCheck: "sentryfi.update.lastCheck",
  autoCheck: "sentryfi.update.autoCheck",
  // versionCode the user tapped "Later" on, so the banner doesn't nag again until
  // a newer build ships (or the next throttled check after the interval).
  dismissedCode: "sentryfi.update.dismissedCode",
} as const;
