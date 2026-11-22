import { requireUser } from "@/lib/auth/session"
import { checkRateLimit } from "@/lib/auth/rate-limit"
import { fail, ok, handleRouteError } from "@/lib/api/respond"
import { claimStateFor } from "@/lib/domain/service"
import { DomainInputError, assertSiteUrl } from "@/lib/domain/host"

/**
 * Preflight for the connect flow: is this website already connected to another
 * Atai account? It answers with a state, never with the holder, and it takes
 * nothing on the founder's behalf — the claim itself happens at creation.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser()
    await checkRateLimit({ action: "business_claim_check", identifier: user.id, limit: 60, windowMs: 60 * 60_000 })

    const url = (new URL(req.url).searchParams.get("url") ?? "").trim()
    try {
      assertSiteUrl(url)
    } catch (error) {
      const message = error instanceof DomainInputError ? error.message : "That does not look like a website address."
      return fail("VALIDATION", message, 422, undefined, { available: false, reason: "invalid" })
    }

    const claim = await claimStateFor({ userId: user.id, rawUrl: url })
    return ok({
      hostname: claim.hostname,
      state: claim.state,
      available: claim.state !== "held_by_other",
      mine: claim.state === "yours",
    })
  } catch (error) {
    return handleRouteError("business.availability.get", error)
  }
}
