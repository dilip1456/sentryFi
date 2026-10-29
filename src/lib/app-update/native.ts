import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export interface DownloadResult {
  sha256: string;
  size: number;
  versionCode?: number;
  versionName?: string;
  signatureMatch?: boolean | null;
}
export interface InstallStatusEvent {
  status: "pending" | "success" | "failure";
  code?: string;
  message?: string;
}
export interface DownloadProgressEvent { bytes: number; total: number }

/** App-local native plugin: android/app/src/main/java/com/sentryfi/app/ApkUpdaterPlugin.java */
export interface ApkUpdaterPlugin {
  canInstall(): Promise<{ allowed: boolean }>;
  openInstallSettings(): Promise<void>;
  download(options: { url: string; sha256: string; size: number }): Promise<DownloadResult>;
  install(options: { sha256: string }): Promise<void>;
  addListener(eventName: "downloadProgress", fn: (e: DownloadProgressEvent) => void): Promise<PluginListenerHandle>;
  addListener(eventName: "installStatus", fn: (e: InstallStatusEvent) => void): Promise<PluginListenerHandle>;
}

export const ApkUpdater = registerPlugin<ApkUpdaterPlugin>("ApkUpdater");

/**
 * In-app updates only exist in the Android APK that ships ApkUpdaterPlugin.
 * Web (including the public /demo) and iOS are a no-op.
 */
export const isUpdateSupported = (): boolean => {
  try {
    return Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("ApkUpdater");
  } catch {
    return false;
  }
};
