import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { TourCenter } from "@/components/tour/tour-center"
import { getCurrentUser } from "@/lib/auth/session"
import { tourContextForUser, tourProgressForUser } from "@/lib/tour/server"

export const metadata: Metadata = {
  title: "Guided tours - Atai",
  description:
    "Interactive walkthroughs of Atai: start a business, launch it, run it and grow it — taught on the real product, one decision at a time.",
}

/**
 * The Tour Center. What is offered here is decided server-side, from the same
 * feature switches the pages themselves read — a tour of a switched-off feature
 * would be an advert, not guidance.
 */
export default async function ToursPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login?next=/tours")

  const [context, progress] = await Promise.all([
    tourContextForUser(user.id),
    tourProgressForUser(user.id),
  ])

  return (
    <DashboardShell title="Guided tours">
      <TourCenter context={context} progress={progress} />
    </DashboardShell>
  )
}
