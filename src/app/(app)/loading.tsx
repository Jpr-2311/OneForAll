import { Skeleton } from "@/components/ui/data";

// Instant skeleton while a workspace page streams in (layout, sidebar and top bar stay interactive).
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-6xl" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-3 w-48" />
      <Skeleton className="mt-5 h-7 w-72" />
      <Skeleton className="mt-3 h-4 w-96 max-w-full" />
      <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="rounded-xl border border-border bg-surface p-5">
            <Skeleton className="size-8" />
            <Skeleton className="mt-4 h-4 w-2/3" />
            <Skeleton className="mt-2 h-3 w-full" />
            <Skeleton className="mt-1.5 h-3 w-4/5" />
          </div>
        ))}
      </div>
    </div>
  );
}
