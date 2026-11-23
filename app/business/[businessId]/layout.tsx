import { notFound, redirect } from "next/navigation"

import { BusinessShell } from "@/components/connected-business/business-shell"
import { getCurrentUser } from "@/lib/auth/session"
import { requireBusinessAccess } from "@/lib/business/access"
import { businessWorkspaceAccess } from "@/lib/business/flags"
import { userActor } from "@/lib/business/permissions"
import { AppError } from "@/lib/errors"

export const dynamic = "force-dynamic"

/**
 * The connected-business workspace.
 *
 * Two gates, in order: the surface must be open for the account
 * (`businessWorkspaceAccess` — an active member is always inside), and the
 * caller must hold `business.read` on this specific business. A non-member gets
 * 404, never 403, so the workspace never discloses that a business exists.
 *
 * Each page repeats the authorisation call: a layout gate does not excuse a
 * page gate, because pages are also reachable through other render paths.
 */
export default async function BusinessLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ businessId: string }>
}) {
  const { businessId } = await params
  const user = await getCurrentUser()
  if (!user) redirect(`/login?next=${encodeURIComponent(`/business/${businessId}`)}`)

  const surface = await businessWorkspaceAccess(user.id)
  if (!surface.enabled) notFound()

  let business
  try {
    const access = await requireBusinessAccess({
      businessId,
      actor: userActor(user.id),
      permission: "business.read",
    })
    business = access.business
  } catch (error) {
    if (error instanceof AppError) notFound()
    throw error
  }

  return (
    <BusinessShell businessId={business.id} businessName={business.name} status={business.status}>
      {children}
    </BusinessShell>
  )
}
