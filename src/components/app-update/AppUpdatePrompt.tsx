import { Download, Loader2, ShieldAlert, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppUpdate } from "@/contexts/AppUpdateContext";
import { progressPct, updateErrorMessage } from "@/lib/app-update/flow";

const fmtMB = (b: number) => `${(b / (1024 * 1024)).toFixed(1)} MB`;

/**
 * Bottom sheet offering the new APK. Non-blocking ("Later") for a normal update;
 * blocking (dimmed backdrop, no Later) when the installed build is below
 * version.json's minVersionCode.
 */
export const AppUpdatePrompt = () => {
  const u = useAppUpdate();
  if (!u.supported || !u.promptOpen || !u.info || u.verdict === "none") return null;

  const blocking = u.verdict === "required";
  const busy = u.phase === "downloading" || u.phase === "installing";
  const pct = progressPct(u.progress);

  return (
    <>
      {blocking && (
        <div className="fixed inset-0 z-[10000] bg-background/80 backdrop-blur-sm" aria-hidden />
      )}
      <div
        role={blocking ? "alertdialog" : "dialog"}
        aria-modal={blocking}
        aria-labelledby="app-update-title"
        data-testid="app-update-prompt"
        className="fixed inset-x-0 bottom-0 z-[10001] px-3 pointer-events-none"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        <div className="surface-elevated pointer-events-auto mx-auto max-w-md p-4 shadow-2xl animate-in slide-in-from-bottom-4 fade-in-0 duration-300">
          <div className="flex items-start gap-3">
            <div className={cn("h-9 w-9 shrink-0 rounded-full grid place-items-center",
              blocking ? "bg-negative/15 text-negative" : "bg-[hsl(var(--primary)/0.14)] text-[hsl(var(--primary))]")}>
              {blocking ? <ShieldAlert className="h-[18px] w-[18px]" /> : <Sparkles className="h-[18px] w-[18px]" />}
            </div>
            <div className="min-w-0 flex-1">
              <div id="app-update-title" className="font-display text-[15px] text-foreground">
                {blocking ? "Update required" : "Update available"}
              </div>
              <div className="text-[12.5px] text-muted-foreground mt-0.5">
                SentryFi {u.info.versionName} (build {u.info.versionCode}) · {fmtMB(u.info.size)}
                {u.installed && <> · you have build {u.installed.versionCode}</>}
              </div>
            </div>
            {!blocking && !busy && (
              <button type="button" onClick={u.later} aria-label="Dismiss update"
                className="-mr-1 -mt-1 h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {blocking && (
            <p className="mt-3 text-[13px] text-foreground">
              This version of SentryFi is no longer supported. Update to keep using the app.
            </p>
          )}
          {u.info.releaseNotes && (
            <p className="mt-3 text-[13px] text-muted-foreground leading-snug" data-testid="app-update-notes">
              <span className="text-foreground font-medium">What's new: </span>{u.info.releaseNotes}
            </p>
          )}

          {u.phase === "downloading" && (
            <div className="mt-3" aria-live="polite">
              <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                <div className="h-full bg-[hsl(var(--primary))] transition-[width] duration-200"
                  style={{ width: `${pct ?? 5}%` }} />
              </div>
              <div className="mt-1 text-[12px] text-muted-foreground tabular-nums">
                Downloading… {pct !== null ? `${pct}%` : ""}
                {u.progress && u.progress.total > 0 && <> · {fmtMB(u.progress.bytes)} of {fmtMB(u.progress.total)}</>}
              </div>
            </div>
          )}
          {u.phase === "installing" && (
            <div className="mt-3 text-[12.5px] text-muted-foreground" aria-live="polite">
              Verified. Confirm the install on the Android screen that opens.
            </div>
          )}
          {u.phase === "permission" && (
            <div className="mt-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[12.5px] text-foreground" role="status">
              Android needs your OK to let SentryFi install updates. Tap <b>Allow installs</b>, turn on
              <i> Allow from this source</i>, then come back. The update continues automatically.
            </div>
          )}
          {u.phase === "error" && (
            <div className="mt-3 rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-[12.5px] text-foreground" role="alert"
              data-testid="app-update-error">
              {updateErrorMessage(u.errorCode ?? undefined)}
            </div>
          )}

          <div className="mt-4 flex gap-2">
            {!blocking && (
              <button type="button" onClick={u.later} disabled={busy}
                className="flex-1 py-2 rounded-md border border-border text-[14px] text-foreground hover:bg-secondary/60 disabled:opacity-50">
                Later
              </button>
            )}
            {u.phase === "permission" ? (
              <button type="button" onClick={() => void u.openInstallSettings()}
                className="flex-1 py-2 rounded-md bg-foreground text-background text-[14px] font-medium hover:opacity-90">
                Allow installs
              </button>
            ) : (
              <button type="button" onClick={() => void u.startUpdate()} disabled={busy}
                className="flex-1 py-2 rounded-md bg-foreground text-background text-[14px] font-medium hover:opacity-90 disabled:opacity-60 inline-flex items-center justify-center gap-2">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                {u.phase === "error" ? "Try again" : busy ? (u.phase === "installing" ? "Installing…" : "Downloading…") : "Update now"}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
};
