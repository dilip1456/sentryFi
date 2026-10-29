/** Open Settings on a tab from anywhere (e.g. the Financial Picture history hint). Index listens. */
/** "app" (in-app update settings) is only shown inside the Android APK. */
export type SettingsTab = "profile" | "banks" | "notifications" | "app";
export const OPEN_SETTINGS_EVENT = "sentryfi:open-settings";
export const openSettings = (tab: SettingsTab) =>
  window.dispatchEvent(new CustomEvent<{ tab: SettingsTab }>(OPEN_SETTINGS_EVENT, { detail: { tab } }));
