import Link from "next/link"
import { Lock, Plus, ArrowRight } from "lucide-react"
import { AppHeader } from "@/components/app-header"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Shown when a signed-in founder reaches a business section that requires a
 * built application but none of their businesses has been built or launched
 * yet. Honest by design: it never renders the gated page's content behind the
 * lock — it explains the requirement and points to the next real step.
 */
export function BusinessLockedPage({
  section,
  primaryHref = "/new",
  primaryLabel = "Build an application",
  backHref = "/dashboard",
}: {
  section: string
  primaryHref?: string
  primaryLabel?: string
  backHref?: string
}) {
  return (
    <main className="min-h-svh bg-background text-foreground">
      <AppHeader />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-16">
        <span className="inline-flex size-12 items-center justify-center rounded-2xl border border-border bg-card">
          <Lock className="size-6 text-muted-foreground" aria-hidden />
        </span>
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{section} · Locked</p>
        <h1 className="text-3xl font-semibold tracking-tight text-balance">
          {section} unlocks when you have a built application.
        </h1>
        <p className="max-w-xl text-base leading-7 text-muted-foreground">
          This area works with a real business — its code, hosting, data and growth. It stays locked until one of your
          businesses has finished building or is live. Build one, and this section opens automatically.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href={primaryHref} className={cn(buttonVariants({ size: "lg" }), "gap-2")}>
            <Plus className="size-4" /> {primaryLabel}
          </Link>
          <Link href="/projects" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "gap-2")}>
            View my businesses <ArrowRight className="size-4" />
          </Link>
        </div>
        <Link href={backHref} className="inline-flex w-fit text-sm font-medium text-primary hover:underline">
          ← Dashboard
        </Link>
      </div>
    </main>
  )
}

/**
 * Project-scoped variant: the founder owns the business but it has not been
 * built yet, so the primary step is to go open that business and build it.
 */
export function BusinessLockedForProject({
  section,
  projectId,
}: {
  section: string
  projectId: string
}) {
  return (
    <BusinessLockedPage
      section={section}
      primaryHref={`/project/${projectId}`}
      primaryLabel="Continue building"
    />
  )
}
