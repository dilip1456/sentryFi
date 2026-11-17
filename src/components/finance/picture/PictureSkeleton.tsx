import { Skeleton } from "@/components/ui/skeleton";

/**
 * Placeholder with the current Picture's (or Insights') shape: title, the
 * six summary tiles, then section cards. Shown while the linked-account
 * check, settings, transactions or saved review decisions load, so the first
 * paint is never another screen's layout (it used to be the Spending
 * skeleton, then a spinner, then a guessed review queue).
 */
export function PictureSkeleton({ insights = false }: { insights?: boolean }) {
  return (
    <div role="status" aria-busy="true" aria-label={insights ? "Loading insights" : "Loading your financial picture"} data-testid="picture-skeleton" className="content-max px-4 md:px-8 pt-3 md:pt-6 pb-10">
      <div className="hidden md:flex items-center justify-between gap-4">
        <div className="space-y-2"><Skeleton className="h-8 w-64" /><Skeleton className="h-4 w-80" /></div>
        <Skeleton className="h-11 w-28 rounded-xl" />
      </div>
      <Skeleton className="md:hidden h-4 w-56" />
      {!insights && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 mt-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[76px] rounded-[14px]" />)}
        </div>
      )}
      <div className="grid md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-4 mt-4 items-start">
        {[0, 1].map(col => (
          <div key={col} className="space-y-3.5 min-w-0">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="surface-card p-5 space-y-3">
                <div className="flex items-center gap-3"><Skeleton className="h-9 w-9 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-56" /></div></div>
                {Array.from({ length: 3 }).map((__, j) => (
                  <div key={j} className="flex items-center gap-3"><Skeleton className="h-10 w-10 rounded-[10px] shrink-0" /><div className="flex-1 space-y-2 min-w-0"><Skeleton className="h-4 w-2/5" /><Skeleton className="h-3 w-1/3" /></div><Skeleton className="h-4 w-16 shrink-0" /></div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
