import { AdsBench } from "@/components/marketing/ads-bench"
import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { ProjectComingSoon } from "@/components/workspace/project-coming-soon"
import { getCurrentUser } from "@/lib/auth/session"
import { isMarketStudioEnabled } from "@/lib/marketing/feature-flags"
import { getAdsBenchData } from "@/lib/marketing/ads-bench-data"
import { requireOwnedProject } from "@/lib/workspace/require-owned-project"

/**
 * Ads bench route. The founder describes the offer once; the bench drafts
 * platform copy and image creatives through the studio's generation pipeline.
 * Generation is gated server-side on the studio flag and capability
 * availability; the page itself renders whenever the studio is on.
 *
 * Honesty: nothing here publishes, uploads, or runs anything on an ad
 * platform. Atai does not place or manage ads — every piece is a draft the
 * founder copies into their platforms by hand.
 */
export default async function ProjectAdsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const project = await requireOwnedProject(projectId, `/project/${projectId}/ads`)
  const user = await getCurrentUser()

  if (!user || !isMarketStudioEnabled()) {
    return (
      <ProjectComingSoon
        projectId={project.id}
        projectName={project.name}
        kicker="Ads & marketing"
        title={`Ads for ${project.name}`}
        description="This bench will draft your ad copy and creatives from the offer you describe — you copy them into your ad platforms yourself. The experience is not available yet."
      />
    )
  }

  const bench = await getAdsBenchData(user.id, project.id)

  return (
    <DashboardShell title={project.name} projectId={project.id}>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 pb-12 pt-6 sm:gap-8 sm:px-6 sm:pt-8 lg:px-8 lg:pb-16">
        <header className="flex flex-col gap-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Ads &amp; marketing</p>
          <h1 className="break-words text-2xl font-semibold tracking-tight text-balance sm:text-3xl lg:text-4xl">
            Ad creatives for {project.name}
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Describe what you are advertising and get platform-ready drafts — copy for Facebook, Instagram and TikTok,
            plus square and story image creatives. You review, copy, and place them yourself; Atai never runs ads or
            publishes anything on its own.
          </p>
        </header>
        <AdsBench
          projectId={project.id}
          slots={bench.slots}
          creditsAvailable={bench.creditsAvailable}
          textReady={bench.textReady}
          imageReady={bench.imageReady}
        />
      </div>
    </DashboardShell>
  )
}
