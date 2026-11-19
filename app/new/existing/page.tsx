import { redirect } from "next/navigation"
import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { ExistingBusinessWizard } from "@/components/existing-business/intake-wizard"
import { CreateWorkspaceShell } from "@/components/new-project/create-shell"
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
      <CreateWorkspaceShell
        kicker="Already running something real"
        title="Bring your existing business to Atai."
        description="Keep running what you have. Atai reads what you share — a website or a repository, plus your own words — and your AI co-founder writes an honest first assessment with next steps inside your workspace. No rebuild, no second onboarding."
        backLabel="All starting points"
        heroTourTarget="existing-business-intro"
      >
        <ExistingBusinessWizard
          objectives={BUSINESS_OBJECTIVES.map((objective) => ({
            id: objective.id,
            label: objective.label,
            blurb: objective.blurb,
          }))}
        />
      </CreateWorkspaceShell>
    </DashboardShell>
  )
}
