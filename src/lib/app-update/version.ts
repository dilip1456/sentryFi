import { DEFAULT_APK_PATH, UPDATE_ORIGIN } from "./config";

export interface VersionInfo {
  versionName: string;
  versionCode: number;
  sha256: string;      // lowercase hex
  size: number;        // bytes
  releaseNotes: string;
  minVersionCode?: number;
  apkUrl: string;      // absolute, always on UPDATE_ORIGIN
}

const isPosInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

export const SHA256_RE = /^[0-9a-f]{64}$/;

/**
 * Resolves version.json's optional `apkPath` against the fixed update origin.
 * Only same-origin paths under /downloads/ ending in .apk are accepted; anything
 * else (absolute URL to another host, protocol-relative, traversal) falls back
 * to the default APK path.
 */
export const resolveApkUrl = (apkPath: unknown, versionCode?: number): string => {
  let path = DEFAULT_APK_PATH;
  if (typeof apkPath === "string" && /^\/downloads\/[A-Za-z0-9._-]+\.apk$/.test(apkPath) && !apkPath.includes("..")) {
    path = apkPath;
  }
  const url = new URL(path, UPDATE_ORIGIN);
  if (url.origin !== UPDATE_ORIGIN) return `${UPDATE_ORIGIN}${DEFAULT_APK_PATH}`;
  // Cache-buster so a CDN edge can't hand back the previous APK for the new version.
  if (versionCode) url.search = `?v=${versionCode}`;
  return url.toString();
};

/** Validates the fetched version.json. Returns null if anything required is missing or malformed. */
export const parseVersionJson = (raw: unknown): VersionInfo | null => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const versionCode = typeof o.versionCode === "string" && /^\d+$/.test(o.versionCode) ? Number(o.versionCode) : o.versionCode;
  if (!isPosInt(versionCode)) return null;
  if (typeof o.versionName !== "string" || !o.versionName.trim() || o.versionName.length > 50) return null;
  const sha256 = typeof o.sha256 === "string" ? o.sha256.trim().toLowerCase() : "";
  if (!SHA256_RE.test(sha256)) return null;
  if (!isPosInt(o.size)) return null;
  let minVersionCode: number | undefined;
  if (o.minVersionCode !== undefined && o.minVersionCode !== null && o.minVersionCode !== 0) {
    if (!isPosInt(o.minVersionCode)) return null;
    minVersionCode = o.minVersionCode;
  }
  const notes = typeof o.releaseNotes === "string" ? o.releaseNotes.replace(/\s+/g, " ").trim().slice(0, 300) : "";
  return {
    versionName: o.versionName.trim(),
    versionCode,
    sha256,
    size: o.size,
    releaseNotes: notes,
    minVersionCode,
    apkUrl: resolveApkUrl(o.apkPath, versionCode),
  };
};

/** Parses an installed build number (App.getInfo().build is a string on Android). */
export const parseBuildNumber = (build: unknown): number | null => {
  const n = typeof build === "number" ? build : typeof build === "string" && /^\d+$/.test(build.trim()) ? Number(build.trim()) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};

/** -1 / 0 / 1 like a comparator. */
export const compareVersionCodes = (a: number, b: number): number => (a === b ? 0 : a < b ? -1 : 1);

export type UpdateVerdict = "none" | "available" | "required";

/**
 * "required" only when the installed build is below minVersionCode AND the offered
 * build actually satisfies it (never block on an update that wouldn't help).
 */
export const evaluateUpdate = (installedCode: number, info: VersionInfo): UpdateVerdict => {
  if (compareVersionCodes(info.versionCode, installedCode) <= 0) return "none";
  if (info.minVersionCode && installedCode < info.minVersionCode && info.versionCode >= info.minVersionCode) return "required";
  return "available";
};
