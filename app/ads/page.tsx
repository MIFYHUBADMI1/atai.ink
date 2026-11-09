import Link from "next/link"
import { Megaphone } from "lucide-react"
import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { ComingSoonPage } from "@/components/workspace/coming-soon"
import { getCurrentUser } from "@/lib/auth/session"
import { isMarketStudioEnabled } from "@/lib/marketing/feature-flags"
import { store } from "@/lib/store/store"
import { STATE_LABELS } from "@/lib/types/project"

/**
 * Platform-level Ads & growth entry. It is the honest index over the real
 * per-project Ads benches: pick the business, get its bench and its market
 * hub. Nothing here places, manages, or publishes ads — Atai does not run ads.
 */
export default async function AdsPage() {
  const user = await getCurrentUser()

  if (!isMarketStudioEnabled()) {
    return (
      <ComingSoonPage
        kicker="Business & growth"
        title="Plan, launch and manage campaigns."
        description="Ads & Marketing will help you bring customers to the business you are building — when you are ready to acquire, not while you are still shaping the product."
      />
    )
  }

  const projects = user ? await store.listProjects(user.id, 50) : []

  return (
    <DashboardShell title="Ads & growth">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 pb-12 pt-6 sm:gap-8 sm:px-6 sm:pt-8 lg:px-8 lg:pb-16">
        <header className="flex flex-col gap-2">
          <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            <Megaphone className="size-3.5 text-primary" aria-hidden /> Ads &amp; growth
          </p>
          <h1 className="break-words text-2xl font-semibold tracking-tight text-balance sm:text-3xl lg:text-4xl">
            Bring customers to the business you built
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Pick one of your businesses and draft ad copy and image creatives from its own plan — for Facebook,
            Instagram and TikTok, ready for you to review and place. Atai never runs, places, or publishes ads for
            you; every piece is a draft you control.
          </p>
        </header>

        {!user ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-center">
            <p className="text-sm font-medium">Sign in to see your businesses</p>
            <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">
              Your ads bench lives inside each business you are building. Sign in to pick one and start drafting.
            </p>
            <Link
              href="/login?next=%2Fads"
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
            >
              Sign in
            </Link>
          </div>
        ) : projects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-center">
            <p className="text-sm font-medium">No businesses yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">
              The ads bench drafts creatives from a business&apos;s own plan and offer. Create your first business and
              this page becomes the way into its bench.
            </p>
            <Link
              href="/dashboard"
              className="mt-4 inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-semibold transition-colors hover:bg-muted"
            >
              Go to your workspace
            </Link>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {projects.map((project) => {
              const live = project.deployment?.status === "success" && Boolean(project.deployment?.productionUrl)
              return (
                <li key={project.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">{project.name}</span>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      {STATE_LABELS[project.state] ?? project.state}
                    </span>
                  </div>
                  <p className="break-all text-xs text-muted-foreground">
                    {live && project.deployment?.productionUrl
                      ? project.deployment.productionUrl
                      : "Not deployed yet — the bench still drafts, but a live URL makes the ads stronger."}
                  </p>
                  <div className="mt-auto flex flex-wrap items-center gap-2">
                    <Link
                      href={`/project/${project.id}/ads`}
                      className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                    >
                      <Megaphone className="size-3.5" aria-hidden /> Open ads bench
                    </Link>
                    <Link
                      href={`/project/${project.id}/market`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Market &amp; grow <span aria-hidden>→</span>
                    </Link>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </DashboardShell>
  )
}
