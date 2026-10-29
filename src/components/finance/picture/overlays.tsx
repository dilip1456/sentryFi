/**
 * Overlay manager for My Financial Picture (prototype fp.js "overlay manager").
 *
 *  - Desktop: one centered dialog. Opening something from inside it replaces
 *    the content in place, so X / Escape / backdrop always close it.
 *  - Mobile: `row:` and `pick:` / `add:` details are bottom sheets (vaul) —
 *    swipe down, backdrop, X, Escape or back closes them; opening a sheet from
 *    a sheet replaces it. Everything else pushes a full screen that slides in
 *    from the right and has a back arrow.
 *  - Every open pushes a history entry, and every close goes through
 *    history.back(), so the Android hardware back button and browser back close
 *    the top layer instead of leaving the page.
 * Radix keeps the layers ordered: Escape and outside clicks only reach the top one.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Drawer as DrawerPrimitive } from "vaul";
import { ArrowLeft, X } from "lucide-react";

export interface DetailView {
  title: string;
  wide?: boolean;
  body: ReactNode;
  /** Sticky footer (mobile edit screen's Cancel / Save). */
  footer?: ReactNode;
}

interface Entry { key: string; uid: number; closing?: boolean }

interface OverlayApi {
  open: (key: string) => void;
  close: () => void;
  /** Close everything this page opened. */
  closeAll: () => void;
  isMobile: boolean;
  /** Key of the top-most open overlay (null when none). */
  top: string | null;
}

const OverlayCtx = createContext<OverlayApi | null>(null);
export const useOverlay = () => {
  const c = useContext(OverlayCtx);
  if (!c) throw new Error("useOverlay outside OverlayProvider");
  return c;
};

export const isSheetKey = (k: string) => /^(row|pick|add):/.test(k);
const HISTORY_TAG = "fpOverlay";
const EXIT_MS = 320;

export function OverlayProvider({ isMobile, render, children }: {
  isMobile: boolean;
  render: (key: string) => DetailView | null;
  children: ReactNode;
}) {
  const [stack, setStack] = useState<Entry[]>([]);
  const stackRef = useRef<Entry[]>([]);
  const pushed = useRef(0);
  const uid = useRef(0);
  const set = (next: Entry[]) => { stackRef.current = next; setStack(next); };
  const live = () => stackRef.current.filter(e => !e.closing);

  const popOne = useCallback(() => {
    const l = stackRef.current.filter(e => !e.closing);
    const top = l[l.length - 1];
    if (!top) return;
    set(stackRef.current.map(e => (e.uid === top.uid ? { ...e, closing: true } : e)));
    window.setTimeout(() => set(stackRef.current.filter(e => e.uid !== top.uid)), EXIT_MS);
  }, []);

  useEffect(() => {
    const onPop = () => {
      if (pushed.current <= 0) return;
      pushed.current -= 1;
      popOne();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [popOne]);

  // Leaving the page with overlays open: drop our history entries.
  useEffect(() => () => {
    if (pushed.current > 0) { const n = pushed.current; pushed.current = 0; window.history.go(-n); }
  }, []);

  const open = useCallback((key: string) => {
    const l = live();
    const top = l[l.length - 1];
    const replace = top && (!isMobile || (isSheetKey(top.key) && isSheetKey(key)));
    if (replace) {
      set(stackRef.current.map(e => (e.uid === top.uid ? { ...e, key } : e)));
      return;
    }
    uid.current += 1;
    set([...stackRef.current, { key, uid: uid.current }]);
    try {
      window.history.pushState({ ...(window.history.state ?? {}), [HISTORY_TAG]: uid.current }, "");
      pushed.current += 1;
    } catch { /* sandboxed iframe: closes still work, just not via back */ }
  }, [isMobile]);

  const close = useCallback(() => {
    if (pushed.current > 0) window.history.back();
    else popOne();
  }, [popOne]);

  const closeAll = useCallback(() => {
    const n = live().length;
    if (!n) return;
    if (pushed.current > 0) window.history.go(-Math.min(n, pushed.current));
    else for (let i = 0; i < n; i++) popOne();
  }, [popOne]);

  const l = stack.filter(e => !e.closing);
  const api = useMemo<OverlayApi>(() => ({ open, close, closeAll, isMobile, top: l[l.length - 1]?.key ?? null }), [open, close, closeAll, isMobile, l]);

  return (
    <OverlayCtx.Provider value={api}>
      {children}
      {isMobile
        ? stack.map((e, i) => {
            const v = render(e.key);
            if (!v) return null;
            const isTop = !e.closing && e.uid === l[l.length - 1]?.uid;
            const underTop = !e.closing && !isTop && stack.slice(i + 1).some(x => !x.closing && !isSheetKey(x.key));
            return isSheetKey(e.key)
              ? <Sheet key={e.uid} open={!e.closing} onClose={close} view={v} />
              : <Screen key={e.uid} open={!e.closing} onClose={close} view={v} under={underTop} />;
          })
        : <DesktopDialog entry={stack.find(e => !e.closing) ?? null} lastEntry={stack[stack.length - 1] ?? null} onClose={close} render={render} />}
    </OverlayCtx.Provider>
  );
}

const BACKDROP = "fixed inset-0 z-50 bg-[hsl(222_40%_3%/.66)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0";

function DesktopDialog({ entry, lastEntry, onClose, render }: {
  entry: Entry | null; lastEntry: Entry | null; onClose: () => void; render: (k: string) => DetailView | null;
}) {
  const shown = entry ?? lastEntry;
  const v = shown ? render(shown.key) : null;
  return (
    <DialogPrimitive.Root open={!!entry} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={BACKDROP} />
        {v && (
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className={`fp fp-dlg ${v.wide ? "wide" : ""} fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-popover text-foreground shadow-2xl outline-none duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95`}
          >
            <div className="ov-h">
              <DialogPrimitive.Title asChild><h3>{v.title}</h3></DialogPrimitive.Title>
              <DialogPrimitive.Close className="ov-x" aria-label="Close"><X className="h-4 w-4" aria-hidden="true" /></DialogPrimitive.Close>
            </div>
            <div className="ov-b" key={shown?.key}>{v.body}</div>
            {v.footer}
          </DialogPrimitive.Content>
        )}
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Sheet({ open, onClose, view }: { open: boolean; onClose: () => void; view: DetailView }) {
  return (
    <DrawerPrimitive.Root open={open} onOpenChange={o => { if (!o && open) onClose(); }} shouldScaleBackground={false}>
      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Overlay className="fixed inset-0 z-50 bg-[hsl(222_40%_3%/.66)]" />
        <DrawerPrimitive.Content aria-describedby={undefined} className="fp fp-sheet fixed inset-x-0 bottom-0 z-50 border-t border-border bg-popover text-foreground outline-none" data-fp-sheet="">
          <div className="grab" aria-hidden="true"><span /></div>
          <div className="ov-h">
            <DrawerPrimitive.Title asChild><h3>{view.title}</h3></DrawerPrimitive.Title>
            <DrawerPrimitive.Close className="ov-x" aria-label="Close"><X className="h-4 w-4" aria-hidden="true" /></DrawerPrimitive.Close>
          </div>
          <div className="ov-b">{view.body}</div>
          {view.footer}
        </DrawerPrimitive.Content>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.Root>
  );
}

function Screen({ open, onClose, view, under }: { open: boolean; onClose: () => void; view: DetailView; under: boolean }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={o => { if (!o && open) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          data-fp-screen=""
          className={`fp fp-screen ${under ? "under" : ""} text-foreground outline-none duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right`}
          onPointerDownOutside={e => e.preventDefault()}
        >
          <div className="scr-h">
            <DialogPrimitive.Close className="back" aria-label="Back"><ArrowLeft className="h-5 w-5" aria-hidden="true" /></DialogPrimitive.Close>
            <DialogPrimitive.Title asChild><h3>{view.title}</h3></DialogPrimitive.Title>
          </div>
          <div className="scr-b">{view.body}</div>
          {view.footer}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
