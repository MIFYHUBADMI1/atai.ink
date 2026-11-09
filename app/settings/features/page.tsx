import Link from "next/link"
import { redirect } from "next/navigation"
import { AppHeader } from "@/components/app-header"
import { FeatureToggles, type FeatureToggleState } from "@/components/settings/feature-toggles"
import { getCurrentUser } from "@/lib/auth/session"
import {
  isCampaignsEnabledForUser,
  isCampaignsEnvBlocked,
  isGrowthTasksEnabledForUser,
  isGrowthTasksEnvBlocked,
  isLessonsEnabledForUser,
  isLessonsEnvBlocked,
  isSeoAuditEnabledForUser,
  isSeoAuditEnvBlocked,
} from "@/lib/marketing/feature-flags"
import { getSeoAuditAffordability } from "@/lib/marketing/seo/credits"
import { getLessonsPackAffordability } from "@/lib/lessons/credits"

/**
 * Founder-owned feature switches. The operator (admin) keeps pricing and the
 * env kill switches; everything else — whether these optional features exist
 * in this founder's workspace — is decided here, by the founder, and the
 * change takes effect immediately (every flag call site reads the user doc
 * fresh).
 */
export default async function SettingsFeaturesPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login?next=%2Fsettings%2Ffeatures")

  const prefs = user.featurePreferences ?? {}

  let seoCost: number | null = null
  try {
    const { cost } = await getSeoAuditAffordability(user.id)
    seoCost = cost
  } catch {
    seoCost = null
  }

  let lessonsCost: number | null = null
  try {
    const { cost } = await getLessonsPackAffordability(user.id)
    lessonsCost = cost
  } catch {
    lessonsCost = null
  }

  const seoBlocked = isSeoAuditEnvBlocked()
  const tasksBlocked = isGrowthTasksEnvBlocked()
  const campaignsBlocked = isCampaignsEnvBlocked()
  const lessonsBlocked = isLessonsEnvBlocked()
  const lockedNote =
    "Temporarily unavailable on this deployment. Your switch is kept, but the feature can't be turned on right now."

  const features: FeatureToggleState[] = [
    {
      key: "seoAudit",
      title: "SEO visibility audits",
      description:
        "Crawl your live site the way search engines see it and draft a prioritized fix list — indexing, headings, metadata, mobile readiness. Every audit is an AI draft for you to act on; nothing is changed or published for you.",
      costNote:
        seoCost !== null
          ? `Each audit run costs ${seoCost} credit${seoCost === 1 ? "" : "s"} from your balance.`
          : "Each audit run costs credits at the current rate.",
      blocked: seoBlocked,
      blockedNote: lockedNote,
      enabled: isSeoAuditEnabledForUser(user.id, prefs),
    },
    {
      key: "growthTasks",
      title: "Growth tasks",
      description:
        "Turn your project's next steps into a real task list. Atai proposes tasks and drafts the detail; you approve each one before it exists, and you tick them off yourself.",
      blocked: tasksBlocked,
      blockedNote: lockedNote,
      enabled: isGrowthTasksEnabledForUser(user.id, prefs),
    },
    {
      key: "campaigns",
      title: "Campaign planning",
      description:
        "Plan campaigns on paper — audience, message, channels, timing — drafted from your marketing plan. Plans only: nothing is scheduled, posted, or executed anywhere.",
      blocked: campaignsBlocked,
      blockedNote: lockedNote,
      enabled: isCampaignsEnabledForUser(user.id, prefs),
    },
    {
      key: "lessons",
      title: "Business lessons",
      description:
        "A stage-aware curriculum for your business: the core lessons every founder needs, lessons published by Atai, and AI-written personal lessons that read where your business actually stands — what is done, what remains, and how to move forward. Generation can be refreshed whenever your business moves.",
      costNote:
        lessonsCost !== null
          ? `Each personal lesson pack costs ${lessonsCost} credit${lessonsCost === 1 ? "" : "s"} from your balance. The core curriculum is free.`
          : "Personal lesson packs cost credits at the current rate. The core curriculum is free.",
      blocked: lessonsBlocked,
      blockedNote: lockedNote,
      enabled: isLessonsEnabledForUser(user.id, prefs),
    },
  ]

  return (
    <main className="min-h-svh bg-background text-foreground">
      <AppHeader />
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-10">
        <Link
          href="/settings"
          className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-all hover:border-primary/30 hover:bg-accent hover:text-foreground"
        >
          ← Settings
        </Link>

        <header>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Market &amp; grow</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Feature switches</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            These optional features stay out of your workspace until you turn them on. Flip them here any time — the
            change applies immediately, and nothing has ever run without you asking first.
          </p>
        </header>

        <FeatureToggles features={features} />
      </div>
    </main>
  )
}
