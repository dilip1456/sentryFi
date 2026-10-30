import { VERSION_JSON_URL } from "./config";
import { evaluateUpdate, parseBuildNumber, parseVersionJson, type UpdateVerdict, type VersionInfo } from "./version";
import { sha256Matches } from "./sha256";
import type { DownloadProgressEvent, DownloadResult } from "./native";

export class UpdateError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
    this.name = "UpdateError";
  }
}

export interface InstalledVersion { versionName: string; versionCode: number }

export interface CheckDeps {
  fetchJson: (url: string) => Promise<unknown>;
  getInstalled: () => Promise<InstalledVersion>;
}

export interface CheckResult { installed: InstalledVersion; info: VersionInfo; verdict: UpdateVerdict }

/** Default fetch: the one fixed URL, no cookies, no cache, 10s timeout. */
export const fetchVersionJson = async (url: string = VERSION_JSON_URL): Promise<unknown> => {
  if (url !== VERSION_JSON_URL) throw new UpdateError("URL_NOT_ALLOWED");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, { cache: "no-store", credentials: "omit", redirect: "error", signal: ctrl.signal });
    if (!res.ok) throw new UpdateError("CHECK_FAILED", `HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
};

export const installedFromAppInfo = (info: { version?: string; build?: string | number }): InstalledVersion => {
  const code = parseBuildNumber(info.build);
  if (code === null) throw new UpdateError("NO_INSTALLED_VERSION", "Couldn't read the installed version");
  return { versionName: info.version ?? "", versionCode: code };
};

export const checkForUpdate = async (deps: CheckDeps): Promise<CheckResult> => {
  const [raw, installed] = await Promise.all([deps.fetchJson(VERSION_JSON_URL), deps.getInstalled()]);
  const info = parseVersionJson(raw);
  if (!info) throw new UpdateError("BAD_VERSION_JSON", "The update server sent an invalid response");
  return { installed, info, verdict: evaluateUpdate(installed.versionCode, info) };
};

export interface UpdateDeps {
  canInstall: () => Promise<boolean>;
  download: (o: { url: string; sha256: string; size: number }) => Promise<DownloadResult>;
  install: (o: { sha256: string }) => Promise<void>;
}

/**
 * Download → verify → hand to Android. The native side verifies the hash and signer too;
 * this re-checks what it reports so a native regression can't silently skip verification.
 */
export const performUpdate = async (deps: UpdateDeps, info: VersionInfo, installedCode: number): Promise<void> => {
  if (!(await deps.canInstall())) throw new UpdateError("INSTALL_PERMISSION_REQUIRED");
  const res = await deps.download({ url: info.apkUrl, sha256: info.sha256, size: info.size });
  if (!sha256Matches(info.sha256, res.sha256)) throw new UpdateError("SHA256_MISMATCH");
  if (res.size !== info.size) throw new UpdateError("SIZE_MISMATCH");
  if (res.signatureMatch === false) throw new UpdateError("SIGNATURE_MISMATCH");
  if (typeof res.versionCode === "number" && res.versionCode <= installedCode) throw new UpdateError("NOT_NEWER");
  await deps.install({ sha256: info.sha256 });
};

export const progressPct = (p: DownloadProgressEvent | null): number | null =>
  p && p.total > 0 ? Math.max(0, Math.min(100, Math.round((p.bytes / p.total) * 100))) : null;

const SIGNATURE_MSG =
  "This update is signed with a different key than the Sentry Finance app on your phone, so Android won't install it over it. " +
  "Your current app is unchanged. To switch, uninstall Sentry Finance and install the latest app from sentryfiapp.vercel.app, then sign in again.";

/** User-facing text for an error code from the flow or from ApkUpdaterPlugin. */
export const updateErrorMessage = (code: string | undefined): string => {
  switch (code) {
    case "INSTALL_PERMISSION_REQUIRED":
      return "Allow Sentry Finance to install apps (Settings → Install unknown apps), then tap Update now again.";
    case "SHA256_MISMATCH":
    case "SIZE_MISMATCH":
      return "The download didn't match the published update, so it was deleted and not installed. Try again in a few minutes.";
    case "SIGNATURE_MISMATCH":
    case "CONFLICT":
      return SIGNATURE_MSG;
    case "PACKAGE_MISMATCH":
    case "INVALID_APK":
    case "INVALID":
      return "The downloaded file isn't a valid Sentry Finance update, so it was not installed.";
    case "NOT_NEWER":
      return "The downloaded build isn't newer than the one you have.";
    case "INCOMPATIBLE":
      return "This update isn't compatible with your phone's Android version.";
    case "STORAGE":
      return "Not enough free storage to install the update.";
    case "ABORTED":
      return "Install cancelled. You can update any time from Settings.";
    case "BLOCKED":
      return "Android blocked the install (a device policy may prevent installing apps).";
    case "DOWNLOAD_FAILED":
    case "CHECK_FAILED":
      return "Couldn't reach the update server. Check your connection and try again.";
    case "BAD_VERSION_JSON":
      return "The update server sent an invalid response. Try again later.";
    default:
      return "The update couldn't be installed. Try again, or download the latest app from sentryfiapp.vercel.app.";
  }
};
