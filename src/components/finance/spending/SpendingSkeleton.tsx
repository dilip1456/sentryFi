import { Skeleton } from "@/components/ui/skeleton";

/**
 * Placeholder with the Spending tab's shape (header + period control,
 * overview card, transaction list) shown while accounts/transactions load,
 * instead of a lone spinner on an empty page that then jumps into layout.
 */
export function SpendingSkeleton() {
  return (
    <div role="status" aria-label="Loading spending" aria-busy="true" className="content-max px-4 md:px-8 pt-3 md:pt-6 pb-10 space-y-4">
      <div className="hidden md:block space-y-2">
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-10 w-72 rounded-xl" />
        <Skeleton className="h-10 w-48 rounded-xl" />
      </div>
      <div className="surface-card p-5 space-y-4">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-2 w-full rounded-full" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
        </div>
      </div>
      <div className="surface-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border/20 flex gap-2">
          <Skeleton className="h-9 flex-1 md:flex-none md:w-56 rounded-xl" />
          <Skeleton className="h-9 w-9 rounded-xl" />
          <Skeleton className="h-9 w-9 rounded-xl" />
        </div>
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-border/10 last:border-0">
            <Skeleton className="h-10 w-10 rounded-full shrink-0" />
            <div className="flex-1 space-y-2 min-w-0">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-1/4" />
            </div>
            <Skeleton className="h-4 w-16 shrink-0" />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export default SpendingSkeleton;
