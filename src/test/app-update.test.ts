import { describe, it, expect, vi } from "vitest";
import {
  parseVersionJson, compareVersionCodes, evaluateUpdate, parseBuildNumber, resolveApkUrl, type VersionInfo,
} from "@/lib/app-update/version";
import { shouldAutoCheck, readTimestamp } from "@/lib/app-update/throttle";
import { sha256Hex, sha256Matches, normalizeSha256 } from "@/lib/app-update/sha256";
import { checkForUpdate, performUpdate, UpdateError, installedFromAppInfo, progressPct, updateErrorMessage, fetchVersionJson } from "@/lib/app-update/flow";
import { CHECK_INTERVAL_MS, VERSION_JSON_URL } from "@/lib/app-update/config";

const SHA = "a".repeat(64);
const base = { versionName: "1.2.0", versionCode: 1210, sha256: SHA, size: 7_100_000, releaseNotes: "Faster sync" };

describe("parseVersionJson", () => {
  it("accepts a valid file and pins the APK URL to the fixed origin", () => {
    const v = parseVersionJson(base)!;
    expect(v).toMatchObject({ versionName: "1.2.0", versionCode: 1210, sha256: SHA, size: 7_100_000, releaseNotes: "Faster sync" });
    expect(v.minVersionCode).toBeUndefined();
    expect(v.apkUrl).toBe("https://sentryfiapp.vercel.app/downloads/SentryFi.apk?v=1210");
  });
  it("normalises an upper-case sha256 and numeric-string versionCode", () => {
    const v = parseVersionJson({ ...base, sha256: SHA.toUpperCase(), versionCode: "1210" })!;
    expect(v.sha256).toBe(SHA);
    expect(v.versionCode).toBe(1210);
  });
  it.each([
    ["null", null], ["array", []], ["string", "x"],
    ["missing versionCode", { ...base, versionCode: undefined }],
    ["zero versionCode", { ...base, versionCode: 0 }],
    ["float versionCode", { ...base, versionCode: 1.5 }],
    ["empty versionName", { ...base, versionName: " " }],
    ["short sha", { ...base, sha256: "abc" }],
    ["non-hex sha", { ...base, sha256: "z".repeat(64) }],
    ["missing size", { ...base, size: undefined }],
    ["negative size", { ...base, size: -1 }],
    ["bad minVersionCode", { ...base, minVersionCode: "soon" }],
  ])("rejects %s", (_n, raw) => {
    expect(parseVersionJson(raw)).toBeNull();
  });
  it("reads minVersionCode; 0/null mean none", () => {
    expect(parseVersionJson({ ...base, minVersionCode: 1200 })!.minVersionCode).toBe(1200);
    expect(parseVersionJson({ ...base, minVersionCode: 0 })!.minVersionCode).toBeUndefined();
    expect(parseVersionJson({ ...base, minVersionCode: null })!.minVersionCode).toBeUndefined();
  });
  it("collapses and caps release notes, tolerates missing notes", () => {
    expect(parseVersionJson({ ...base, releaseNotes: "a\n\n b" })!.releaseNotes).toBe("a b");
    expect(parseVersionJson({ ...base, releaseNotes: "x".repeat(1000) })!.releaseNotes).toHaveLength(300);
    expect(parseVersionJson({ ...base, releaseNotes: undefined })!.releaseNotes).toBe("");
  });
});

describe("resolveApkUrl (no user/remote-controlled hosts)", () => {
  it.each([
    "https://evil.example/SentryFi.apk",
    "//evil.example/downloads/x.apk",
    "/downloads/../secret.apk",
    "/other/SentryFi.apk",
    "/downloads/SentryFi.apk?x=https://evil",
    "javascript:alert(1)",
    42,
  ])("falls back to the fixed APK for %s", (p) => {
    expect(resolveApkUrl(p)).toBe("https://sentryfiapp.vercel.app/downloads/SentryFi.apk");
  });
  it("allows a same-origin /downloads/*.apk path", () => {
    expect(resolveApkUrl("/downloads/SentryFi-1.2.0.apk", 7)).toBe("https://sentryfiapp.vercel.app/downloads/SentryFi-1.2.0.apk?v=7");
  });
});

describe("version compare", () => {
  it("compareVersionCodes", () => {
    expect(compareVersionCodes(1, 2)).toBe(-1);
    expect(compareVersionCodes(2, 2)).toBe(0);
    expect(compareVersionCodes(10, 9)).toBe(1); // numeric, not lexicographic
  });
  it("parseBuildNumber", () => {
    expect(parseBuildNumber("1206")).toBe(1206);
    expect(parseBuildNumber(" 2 ")).toBe(2);
    expect(parseBuildNumber(3)).toBe(3);
    expect(parseBuildNumber("1.2")).toBeNull();
    expect(parseBuildNumber(undefined)).toBeNull();
    expect(parseBuildNumber("")).toBeNull();
  });
  const info = (o: Partial<VersionInfo> = {}): VersionInfo => ({ ...parseVersionJson(base)!, ...o });
  it("evaluateUpdate", () => {
    expect(evaluateUpdate(1210, info())).toBe("none");
    expect(evaluateUpdate(1300, info())).toBe("none");        // never offer a downgrade
    expect(evaluateUpdate(2, info())).toBe("available");
    expect(evaluateUpdate(2, info({ minVersionCode: 1000 }))).toBe("required");
    expect(evaluateUpdate(1000, info({ minVersionCode: 1000 }))).toBe("available"); // at the minimum = OK
    // A minVersionCode the offered build doesn't satisfy must not lock the user out.
    expect(evaluateUpdate(2, info({ minVersionCode: 5000 }))).toBe("available");
  });
});

describe("throttle", () => {
  const now = 1_800_000_000_000;
  it("checks when never checked or interval elapsed", () => {
    expect(shouldAutoCheck(now, null)).toBe(true);
    expect(shouldAutoCheck(now, now - CHECK_INTERVAL_MS)).toBe(true);
    expect(shouldAutoCheck(now, now - CHECK_INTERVAL_MS - 1)).toBe(true);
  });
  it("skips inside the interval", () => {
    expect(shouldAutoCheck(now, now)).toBe(false);
    expect(shouldAutoCheck(now, now - CHECK_INTERVAL_MS + 1)).toBe(false);
  });
  it("treats a future timestamp (clock moved back) and NaN as due", () => {
    expect(shouldAutoCheck(now, now + 60_000)).toBe(true);
    expect(shouldAutoCheck(now, NaN)).toBe(true);
  });
  it("interval is a few hours", () => {
    expect(CHECK_INTERVAL_MS).toBeGreaterThanOrEqual(2 * 3600_000);
    expect(CHECK_INTERVAL_MS).toBeLessThanOrEqual(12 * 3600_000);
  });
  it("readTimestamp", () => {
    const s = (v: string | null) => ({ getItem: () => v });
    expect(readTimestamp(s("123"), "k")).toBe(123);
    expect(readTimestamp(s(null), "k")).toBeNull();
    expect(readTimestamp(s("junk"), "k")).toBeNull();
    expect(readTimestamp({ getItem: () => { throw new Error("denied"); } }, "k")).toBeNull();
  });
});

describe("sha256", () => {
  it("hashes bytes (known vector)", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc")))
      .toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("matches case-insensitively and rejects malformed or different digests", () => {
    expect(sha256Matches(SHA, SHA.toUpperCase())).toBe(true);
    expect(sha256Matches(SHA, "b".repeat(64))).toBe(false);
    expect(sha256Matches(SHA, "")).toBe(false);
    expect(sha256Matches("", "")).toBe(false);
    expect(sha256Matches(undefined, undefined)).toBe(false);
    expect(normalizeSha256(` ${SHA} `)).toBe(SHA);
  });
});

describe("checkForUpdate", () => {
  it("fetches only the fixed URL and reports the verdict", async () => {
    const fetchJson = vi.fn().mockResolvedValue({ ...base, minVersionCode: 1100 });
    const r = await checkForUpdate({ fetchJson, getInstalled: async () => ({ versionName: "1.1.0", versionCode: 2 }) });
    expect(fetchJson).toHaveBeenCalledWith(VERSION_JSON_URL);
    expect(r.verdict).toBe("required");
  });
  it("throws BAD_VERSION_JSON on junk", async () => {
    await expect(checkForUpdate({ fetchJson: async () => ({ hi: 1 }), getInstalled: async () => ({ versionName: "", versionCode: 2 }) }))
      .rejects.toMatchObject({ code: "BAD_VERSION_JSON" });
  });
  it("fetchVersionJson refuses any other URL", async () => {
    await expect(fetchVersionJson("https://evil.example/version.json")).rejects.toMatchObject({ code: "URL_NOT_ALLOWED" });
  });
  it("installedFromAppInfo uses build as versionCode", () => {
    expect(installedFromAppInfo({ version: "1.1.0", build: "2" })).toEqual({ versionName: "1.1.0", versionCode: 2 });
    expect(() => installedFromAppInfo({ version: "1.1.0", build: "x" })).toThrow(UpdateError);
  });
});

describe("performUpdate (sha256 gate)", () => {
  const info = parseVersionJson(base)!;
  const deps = (over: Partial<Parameters<typeof performUpdate>[0]> = {}) => ({
    canInstall: vi.fn().mockResolvedValue(true),
    download: vi.fn().mockResolvedValue({ sha256: SHA, size: base.size, versionCode: 1210, signatureMatch: true }),
    install: vi.fn().mockResolvedValue(undefined),
    ...over,
  });
  it("downloads the pinned URL with the expected hash, then installs", async () => {
    const d = deps();
    await performUpdate(d, info, 2);
    expect(d.download).toHaveBeenCalledWith({ url: info.apkUrl, sha256: SHA, size: base.size });
    expect(d.install).toHaveBeenCalledWith({ sha256: SHA });
  });
  it("refuses to install on sha256 mismatch", async () => {
    const d = deps({ download: vi.fn().mockResolvedValue({ sha256: "b".repeat(64), size: base.size }) });
    await expect(performUpdate(d, info, 2)).rejects.toMatchObject({ code: "SHA256_MISMATCH" });
    expect(d.install).not.toHaveBeenCalled();
  });
  it("refuses on size mismatch, signature mismatch, or a non-newer APK", async () => {
    for (const [res, code] of [
      [{ sha256: SHA, size: 1 }, "SIZE_MISMATCH"],
      [{ sha256: SHA, size: base.size, signatureMatch: false }, "SIGNATURE_MISMATCH"],
      [{ sha256: SHA, size: base.size, versionCode: 2 }, "NOT_NEWER"],
    ] as const) {
      const d = deps({ download: vi.fn().mockResolvedValue(res) });
      await expect(performUpdate(d, info, 2)).rejects.toMatchObject({ code });
      expect(d.install).not.toHaveBeenCalled();
    }
  });
  it("asks for the install permission before downloading", async () => {
    const d = deps({ canInstall: vi.fn().mockResolvedValue(false) });
    await expect(performUpdate(d, info, 2)).rejects.toMatchObject({ code: "INSTALL_PERMISSION_REQUIRED" });
    expect(d.download).not.toHaveBeenCalled();
  });
  it("propagates a native rejection (e.g. SHA256_MISMATCH from the plugin) without installing", async () => {
    const d = deps({ download: vi.fn().mockRejectedValue(Object.assign(new Error("bad"), { code: "SHA256_MISMATCH" })) });
    await expect(performUpdate(d, info, 2)).rejects.toMatchObject({ code: "SHA256_MISMATCH" });
    expect(d.install).not.toHaveBeenCalled();
  });
});

describe("misc", () => {
  it("progressPct", () => {
    expect(progressPct(null)).toBeNull();
    expect(progressPct({ bytes: 5, total: 0 })).toBeNull();
    expect(progressPct({ bytes: 50, total: 200 })).toBe(25);
    expect(progressPct({ bytes: 300, total: 200 })).toBe(100);
  });
  it("signature mismatch has a clear message", () => {
    expect(updateErrorMessage("SIGNATURE_MISMATCH")).toMatch(/signed with a different key/);
    expect(updateErrorMessage("CONFLICT")).toMatch(/signed with a different key/);
    expect(updateErrorMessage("whatever")).toMatch(/couldn't be installed/);
  });
});

describe("version.json as written by build-apk.yml", () => {
  it("parses the CI output shape", () => {
    const ci = {
      versionName: "1.1.0", versionCode: 1206,
      sha256: "dd1488252d67ff8f00fbc4d864032c94b700e5aef96b13d101bd6cbf845fe812",
      size: 7099900, releaseNotes: "feat: one-tap in-app APK update",
      apkPath: "/downloads/SentryFi.apk", publishedAt: "2026-10-29T00:18:54.417Z", minVersionCode: 1200,
    };
    expect(parseVersionJson(ci)).toEqual({
      versionName: "1.1.0", versionCode: 1206, sha256: ci.sha256, size: 7099900,
      releaseNotes: "feat: one-tap in-app APK update", minVersionCode: 1200,
      apkUrl: "https://sentryfiapp.vercel.app/downloads/SentryFi.apk?v=1206",
    });
  });
});

describe("native URL allow-list stays in sync", () => {
  it("ApkUpdaterPlugin.java accepts the URLs the app builds and rejects others", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("android/app/src/main/java/com/sentryfi/app/ApkUpdaterPlugin.java", "utf8");
    const lit = /ALLOWED_URL =\s*Pattern\.compile\("((?:[^"\\]|\\.)*)"\)/.exec(src)?.[1];
    expect(lit).toBeTruthy();
    const re = new RegExp(lit!.replace(/\\\\/g, "\\"));
    expect(re.test(resolveApkUrl(undefined, 1206))).toBe(true);
    expect(re.test(resolveApkUrl("/downloads/SentryFi-2.apk"))).toBe(true);
    expect(re.test("https://sentryfiapp.vercel.app.evil.com/downloads/SentryFi.apk")).toBe(false);
    expect(re.test("http://sentryfiapp.vercel.app/downloads/SentryFi.apk")).toBe(false);
    expect(re.test("https://sentryfiapp.vercel.app/downloads/../x.apk")).toBe(false);
  });
});
