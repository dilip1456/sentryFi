import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" data-ui="skeleton" className={cn("skeleton rounded-md", className)} {...props} />;
}

export { Skeleton };
