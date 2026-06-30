// __APP_BUILD_TIME__ is injected at build time (see vite.config.ts) — lets you tell at a
// glance, on-device, whether you're looking at a stale APK or the one you just installed.
export const BUILD_TIME: string = __APP_BUILD_TIME__;

// __APP_VERSION__ mirrors package.json's version, also injected at build time.
export const APP_VERSION: string = __APP_VERSION__;

export const formatBuildTime = (iso: string = BUILD_TIME): string =>
  new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
