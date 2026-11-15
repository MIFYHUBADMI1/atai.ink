import Link from "next/link"

export function BlogPagination({
  page,
  totalPages,
  basePath,
  searchParams,
}: {
  page: number
  totalPages: number
  basePath: string
  searchParams?: Record<string, string>
}) {
  if (totalPages <= 1) return null
  function href(target: number) {
    const params = new URLSearchParams(searchParams ?? {})
    if (target > 1) params.set("page", String(target))
    else params.delete("page")
    const query = params.toString()
    return `${basePath}${query ? `?${query}` : ""}`
  }
  const pages = Array.from({ length: totalPages }, (_, index) => index + 1).filter(
    (target) => target === 1 || target === totalPages || Math.abs(target - page) <= 1,
  )
  return (
    <nav aria-label="Blog pages" className="mt-10 flex flex-wrap items-center justify-center gap-2">
      {page > 1 ? (
        <Link href={href(page - 1)} className="rounded-lg border border-border bg-card px-3 py-2 text-sm hover:bg-accent">
          Previous
        </Link>
      ) : null}
      {pages.map((target, index) => (
        <span key={target} className="flex items-center gap-2">
          {index > 0 && target - pages[index - 1] > 1 ? <span className="text-muted-foreground">…</span> : null}
          <Link
            href={href(target)}
            aria-current={target === page ? "page" : undefined}
            className={`rounded-lg border px-3 py-2 text-sm ${
              target === page
                ? "border-primary bg-primary/10 font-medium text-primary"
                : "border-border bg-card hover:bg-accent"
            }`}
          >
            {target}
          </Link>
        </span>
      ))}
      {page < totalPages ? (
        <Link href={href(page + 1)} className="rounded-lg border border-border bg-card px-3 py-2 text-sm hover:bg-accent">
          Next
        </Link>
      ) : null}
    </nav>
  )
}