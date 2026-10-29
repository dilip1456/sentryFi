import { CheckCircle2, Download, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Switch as UISwitch } from "@/components/ui/switch";
import { useAppUpdate } from "@/contexts/AppUpdateContext";
import { updateErrorMessage } from "@/lib/app-update/flow";
import { APP_VERSION } from "@/lib/constants";

const fmtWhen = (t: number) =>
  new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** "App updates" settings block: auto-check toggle, installed version, Check now + result. */
export const AppUpdateSettings = () => {
  const u = useAppUpdate();
  if (!u.supported) return null;
  const checking = u.checkStatus === "checking";

  return (
    <div className="space-y-3" data-testid="app-update-settings">
      <div className="text-[12.5px] uppercase tracking-wider text-muted-foreground">App updates</div>

      <div className="surface-card px-3 py-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] text-foreground font-medium">Check for updates automatically</div>
          <div className="text-[12px] text-muted-foreground">When the app opens, at most every few hours</div>
        </div>
        <label className="inline-flex shrink-0 items-center gap-2 cursor-pointer select-none">
          <span aria-hidden className={cn("text-[12px] font-semibold w-6 text-right", u.autoCheck ? "text-foreground" : "text-muted-foreground")}>
            {u.autoCheck ? "On" : "Off"}
          </span>
          <UISwitch checked={u.autoCheck} onCheckedChange={u.setAutoCheck} aria-label="Check for updates automatically"
            className="data-[state=checked]:bg-[hsl(var(--primary))] data-[state=unchecked]:bg-border-strong" />
        </label>
      </div>

      <div className="surface-card px-3 py-3">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] text-foreground font-medium">
              Version {u.installed?.versionName || APP_VERSION}
              {u.installed && <span className="text-muted-foreground font-normal"> (build {u.installed.versionCode})</span>}
            </div>
            <div className="text-[12px] text-muted-foreground" aria-live="polite" data-testid="app-update-result">
              {checking && "Checking…"}
              {u.checkStatus === "up-to-date" && <span className="inline-flex items-center gap-1 text-positive"><CheckCircle2 className="h-3.5 w-3.5" /> You're up to date</span>}
              {u.checkStatus === "available" && u.info && <span className="text-[hsl(var(--primary))] font-medium">Update available: {u.info.versionName} (build {u.info.versionCode})</span>}
              {u.checkStatus === "error" && <span className="text-negative">{updateErrorMessage(u.checkError ?? undefined)}</span>}
              {u.checkStatus === "idle" && (u.lastCheckedAt ? `Last checked ${fmtWhen(u.lastCheckedAt)}` : "Not checked yet")}
            </div>
          </div>
          {u.checkStatus === "available" ? (
            <button type="button" onClick={u.openPrompt}
              className="inline-flex items-center gap-1.5 shrink-0 px-3 py-1.5 rounded-md bg-foreground text-background text-[13px] font-medium hover:opacity-90">
              <Download className="h-3.5 w-3.5" /> Update
            </button>
          ) : (
            <button type="button" onClick={() => void u.checkNow()} disabled={checking}
              className="inline-flex items-center gap-1.5 shrink-0 px-3 py-1.5 rounded-md border border-border text-[13px] text-foreground hover:bg-secondary/60 disabled:opacity-50">
              {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Check now
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
