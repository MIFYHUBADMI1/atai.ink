import { z } from "zod"

import { readAuthBody } from "@/lib/api/request-body"
import { fail, handleRouteError, ok } from "@/lib/api/respond"
import { verifyPassword } from "@/lib/auth/crypto"
import { checkRateLimit } from "@/lib/auth/rate-limit"
import { requireUser } from "@/lib/auth/session"
import { actorOf, requireWorkspace } from "@/lib/business/http"
import { deleteConnectedBusiness } from "@/lib/connected-business/deletion"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const DeleteSchema = z.object({
  confirmEmail: z.string().trim().min(1).max(320),
  currentPassword: z.string().max(1024).optional(),
})

/**
 * POST /api/businesses/[businessId]/delete
 *
 * Permanent deletion, not archiving — archive is `DELETE /api/businesses/:id`.
 * The founder re-authenticates with their account email and, for a password
 * account, their current password, because this frees the business's website
 * for any other Atai account.
 */
export async function POST(request: Request, { params }: { params: Promise<{ businessId: string }> }) {
  try {
    const user = await requireUser()
    await requireWorkspace(user.id, "write")
    const { businessId } = await params

    const parsed = DeleteSchema.safeParse(await readAuthBody(request))
    if (!parsed.success) {
      return fail("VALIDATION", "Enter your account email and password to confirm.", 422)
    }

    await checkRateLimit({
      action: "business_delete",
      identifier: user.id,
      limit: 3,
      windowMs: 60 * 60 * 1000,
    })

    const reauthFailed = async () => {
      await checkRateLimit({
        action: "business_delete_reauth_fail",
        identifier: user.id,
        limit: 5,
        windowMs: 24 * 60 * 60 * 1000,
      })
    }

    if (parsed.data.confirmEmail.toLowerCase() !== user.email.toLowerCase()) {
      await reauthFailed()
      return fail("VALIDATION", "That email does not match your account.", 422)
    }

    if (user.authProvider === "password") {
      if (!parsed.data.currentPassword) {
        return fail("VALIDATION", "Enter your current password to confirm.", 422)
      }
      if (!user.passwordHash || !(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
        await reauthFailed()
        return fail("VALIDATION", "Password is incorrect.", 422)
      }
    }

    const result = await deleteConnectedBusiness({ businessId, actor: actorOf(user) })

    return ok({
      deleted: true,
      ...result,
      warning:
        "The business, its applications, its people, its Atai ownership claim and its workspace data are removed. " +
        "The website can now be connected by another Atai account. Hosted apps, external files, DNS, domains and " +
        "subscriptions that run outside Atai are not removed or cancelled — shut them down separately. " +
        "Billing, refund and audit records are retained.",
    })
  } catch (error) {
    return handleRouteError("businesses.delete", error)
  }
}
