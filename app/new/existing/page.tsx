import { redirect } from "next/navigation"
import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { ExistingBusinessWizard } from "@/components/existing-business/intake-wizard"
import { CreateWorkspaceShell } from "@/components/new-project/create-shell"
import { getCurrentUser } from "@/lib/auth/session"
import { BUSINESS_OBJECTIVES } from "@/lib/existing-business/objectives"

export const metadata = {
  title: "Connect your existing business · Atai",
}

export default async function NewExistingBusinessPage() {
  const user = await getCurrentUser()
  if (!user) redirect(`/login?next=${encodeURIComponent("/new/existing")}`)

  return (
    <DashboardShell title="Connect your existing business">
      <CreateWorkspaceShell
        kicker="Already running something real"
        title="Connect the business you already run."
        description="Your application stays where it is — nothing is rebuilt or redeployed. Atai reads your public pages and your own words, then writes an honest first read of the business."
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
