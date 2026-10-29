/**
 * AppUpdateContext — one-tap in-app update for the sideloaded Android APK.
 *
 * Checks the fixed version.json on launch and on resume (throttled, see
 * CHECK_INTERVAL_MS), compares with the installed versionCode
 * (App.getInfo().build), and drives download → verify → install through
 * ApkUpdaterPlugin. Everything is a no-op unless isUpdateSupported().
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { STORAGE_KEYS, UPDATE_ORIGIN, DEFAULT_APK_PATH } from "@/lib/app-update/config";
import { shouldAutoCheck, readTimestamp } from "@/lib/app-update/throttle";
import type { UpdateVerdict, VersionInfo } from "@/lib/app-update/version";
import { ApkUpdater, isUpdateSupported, type DownloadProgressEvent } from "@/lib/app-update/native";
import {
  UpdateError, checkForUpdate, fetchVersionJson, installedFromAppInfo, performUpdate,
  type InstalledVersion,
} from "@/lib/app-update/flow";

export type CheckStatus = "idle" | "checking" | "up-to-date" | "available" | "error";
export type UpdatePhase = "idle" | "permission" | "downloading" | "installing" | "error";

export interface AppUpdateState {
  supported: boolean;
  installed: InstalledVersion | null;
  info: VersionInfo | null;
  verdict: UpdateVerdict;
  checkStatus: CheckStatus;
  checkError: string | null;
  lastCheckedAt: number | null;
  autoCheck: boolean;
  promptOpen: boolean;
  phase: UpdatePhase;
  progress: DownloadProgressEvent | null;
  errorCode: string | null;
  errorDetail: string | null;
  setAutoCheck: (v: boolean) => void;
  checkNow: () => Promise<void>;
  startUpdate: () => Promise<void>;
  openInstallSettings: () => Promise<void>;
  later: () => void;
  openPrompt: () => void;
}

const Ctx = createContext<AppUpdateState | null>(null);

const safeGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

export const AppUpdateProvider = ({ children }: { children: ReactNode }) => {
  const [supported] = useState(isUpdateSupported);
  const [installed, setInstalled] = useState<InstalledVersion | null>(null);
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [verdict, setVerdict] = useState<UpdateVerdict>("none");
  const [checkStatus, setCheckStatus] = useState<CheckStatus>("idle");
  const [checkError, setCheckError] = useState<string | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(() => readTimestamp(localStorage, STORAGE_KEYS.lastCheck));
  const [autoCheck, setAutoCheckState] = useState(() => safeGet(STORAGE_KEYS.autoCheck) !== "false");
  const [promptOpen, setPromptOpen] = useState(false);
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [progress, setProgress] = useState<DownloadProgressEvent | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  const checking = useRef(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const autoRef = useRef(autoCheck);
  autoRef.current = autoCheck;

  const getInstalled = useCallback(async () => installedFromAppInfo(await App.getInfo()), []);

  useEffect(() => {
    if (!supported) return;
    getInstalled().then(setInstalled).catch(() => { /* shown as unknown */ });
  }, [supported, getInstalled]);

  const runCheck = useCallback(async (manual: boolean) => {
    if (!supported || checking.current) return;
    checking.current = true;
    setCheckStatus("checking");
    setCheckError(null);
    try {
      const r = await checkForUpdate({ fetchJson: fetchVersionJson, getInstalled });
      const now = Date.now();
      safeSet(STORAGE_KEYS.lastCheck, String(now));
      setLastCheckedAt(now);
      setInstalled(r.installed);
      setInfo(r.info);
      setVerdict(r.verdict);
      setCheckStatus(r.verdict === "none" ? "up-to-date" : "available");
      if (r.verdict === "required") {
        setPromptOpen(true);
      } else if (r.verdict === "available") {
        const dismissed = Number(safeGet(STORAGE_KEYS.dismissedCode) ?? 0);
        // "Later" hides the banner for that build until the next manual check.
        if (manual || dismissed !== r.info.versionCode) setPromptOpen(true);
      }
    } catch (e) {
      setCheckStatus("error");
      setCheckError(e instanceof UpdateError ? e.code : "CHECK_FAILED");
    } finally {
      checking.current = false;
    }
  }, [supported, getInstalled]);

  const maybeAutoCheck = useCallback(() => {
    if (!autoRef.current) return;
    if (!shouldAutoCheck(Date.now(), readTimestamp(localStorage, STORAGE_KEYS.lastCheck))) return;
    void runCheck(false);
  }, [runCheck]);

  const doUpdate = useCallback(async () => {
    if (!info || !installed) return;
    setErrorCode(null);
    setErrorDetail(null);
    setProgress(null);
    setPhase("downloading");
    try {
      await performUpdate({
        canInstall: async () => (await ApkUpdater.canInstall()).allowed,
        download: (o) => ApkUpdater.download(o),
        install: async (o) => { setPhase("installing"); await ApkUpdater.install(o); },
      }, info, installed.versionCode);
      // Android now shows its own confirmation; the outcome arrives via "installStatus".
    } catch (e) {
      const code = e instanceof UpdateError ? e.code : (e as { code?: string })?.code ?? "INSTALL_FAILED";
      if (code === "INSTALL_PERMISSION_REQUIRED") { setPhase("permission"); return; }
      if (code === "UNIMPLEMENTED") {
        // Plugin missing in this build: fall back to the system browser download.
        await Browser.open({ url: `${UPDATE_ORIGIN}${DEFAULT_APK_PATH}` }).catch(() => {});
        setPhase("idle");
        return;
      }
      setErrorCode(code);
      setErrorDetail((e as Error)?.message ?? null);
      setPhase("error");
    }
  }, [info, installed]);

  const doUpdateRef = useRef(doUpdate);
  doUpdateRef.current = doUpdate;
  const autoCheckRef = useRef(maybeAutoCheck);
  autoCheckRef.current = maybeAutoCheck;

  // Native listeners + launch/resume checks. Subscribed once; callbacks read the latest
  // handlers through refs so state changes don't re-register listeners or re-run the check.
  useEffect(() => {
    if (!supported) return;
    const handles: Array<Promise<{ remove: () => Promise<void> }>> = [];
    handles.push(ApkUpdater.addListener("downloadProgress", (p) => setProgress(p)));
    handles.push(ApkUpdater.addListener("installStatus", (s) => {
      if (s.status === "failure") {
        setErrorCode(s.code ?? "INSTALL_FAILED");
        setErrorDetail(s.message ?? null);
        setPhase("error");
      } else if (s.status === "success") {
        setPhase("idle");
      }
    }));
    handles.push(App.addListener("resume", () => {
      // Came back from the "Install unknown apps" screen: continue if now allowed.
      if (phaseRef.current === "permission") {
        ApkUpdater.canInstall().then(({ allowed }) => { if (allowed) void doUpdateRef.current(); }).catch(() => {});
        return;
      }
      if (phaseRef.current === "installing") return;
      autoCheckRef.current();
    }));
    autoCheckRef.current();
    return () => { handles.forEach((h) => h.then((x) => x.remove()).catch(() => {})); };
  }, [supported]);

  const setAutoCheck = useCallback((v: boolean) => {
    setAutoCheckState(v);
    safeSet(STORAGE_KEYS.autoCheck, String(v));
  }, []);

  const later = useCallback(() => {
    if (verdict === "required") return;
    if (info) safeSet(STORAGE_KEYS.dismissedCode, String(info.versionCode));
    setPromptOpen(false);
    if (phaseRef.current !== "downloading" && phaseRef.current !== "installing") {
      setPhase("idle");
      setErrorCode(null);
    }
  }, [verdict, info]);

  const value = useMemo<AppUpdateState>(() => ({
    supported, installed, info, verdict, checkStatus, checkError, lastCheckedAt, autoCheck,
    promptOpen, phase, progress, errorCode, errorDetail,
    setAutoCheck,
    checkNow: () => runCheck(true),
    startUpdate: doUpdate,
    openInstallSettings: () => ApkUpdater.openInstallSettings().catch(() => {}),
    later,
    openPrompt: () => setPromptOpen(true),
  }), [supported, installed, info, verdict, checkStatus, checkError, lastCheckedAt, autoCheck,
    promptOpen, phase, progress, errorCode, errorDetail, setAutoCheck, runCheck, doUpdate, later]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAppUpdate = (): AppUpdateState => useContext(Ctx) ?? UNSUPPORTED;

// Outside the provider (tests, isolated renders) everything is a no-op.
const noop = async () => {};
const UNSUPPORTED: AppUpdateState = {
  supported: false, installed: null, info: null, verdict: "none", checkStatus: "idle", checkError: null,
  lastCheckedAt: null, autoCheck: true, promptOpen: false, phase: "idle", progress: null,
  errorCode: null, errorDetail: null,
  setAutoCheck: () => {}, checkNow: noop, startUpdate: noop, openInstallSettings: noop, later: () => {}, openPrompt: () => {},
};
