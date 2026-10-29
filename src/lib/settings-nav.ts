/** Open Settings on a tab from anywhere (e.g. the Financial Picture history hint). Index listens. */
export type SettingsTab = "profile" | "banks" | "notifications";
export const OPEN_SETTINGS_EVENT = "sentryfi:open-settings";
export const openSettings = (tab: SettingsTab) =>
  window.dispatchEvent(new CustomEvent<{ tab: SettingsTab }>(OPEN_SETTINGS_EVENT, { detail: { tab } }));
