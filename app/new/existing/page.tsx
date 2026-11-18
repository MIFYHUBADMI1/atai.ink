import { redirect } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { ExistingBusinessWizard } from "@/components/existing-business/intake-wizard"
import { getCurrentUser } from "@/lib/auth/session"
import { BUSINESS_OBJECTIVES } from "@/lib/existing-business/objectives"

export const metadata = {
  title: "Bring your existing business · Atai",
}

export default async function NewExistingBusinessPage() {
  const user = await getCurrentUser()
  if (!user) redirect(`/login?next=${encodeURIComponent("/new/existing")}`)

  return (
    <DashboardShell title="Bring your existing business">
      <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <Link
          href="/new"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-3.5" />
          All starting points
        </Link>

        <section className="mx-auto mt-8 w-full max-w-3xl text-center" data-atai-tour="existing-business-intro">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Already running something real
          </p>
          <h1 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Bring your existing business to Atai.
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-pretty text-sm leading-6 text-muted-foreground">
            Keep running what you have. Atai reads what you share — your words, your website, your code — and your AI
            co-founder gives you an honest first assessment with next steps inside your workspace. No rebuild, no
            second onboarding.
          </p>
        </section>

        <div className="mt-10" data-atai-tour="existing-business-wizard">
          <ExistingBusinessWizard
            objectives={BUSINESS_OBJECTIVES.map((objective) => ({
              id: objective.id,
              label: objective.label,
              blurb: objective.blurb,
            }))}
          />
        </div>
      </div>
    </DashboardShell>
  )
}