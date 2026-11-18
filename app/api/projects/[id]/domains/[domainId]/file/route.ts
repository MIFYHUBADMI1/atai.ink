import { requireUser } from "@/lib/auth/session"
import { store } from "@/lib/store/store"
import { fail, handleRouteError } from "@/lib/api/respond"
import { DomainServiceError, fileContentForToken, getOwnedDomain } from "@/lib/domain/service"

/**
 * Download the generated verification file for the html_file method. Each
 * challenge has its own filename and token; this serves exactly that file to
 * the authenticated owner and nobody else. The founder uploads it to their
 * own website root — Atai never touches their hosting.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; domainId: string }> }) {
  try {
    const user = await requireUser()
    const { id, domainId } = await params
    const project = await store.getProject(id)
    if (!project || project.userId !== user.id) {
      return fail("UNAUTHORIZED_PROJECT_ACCESS", "We couldn't find this business.", 404)
    }
    const doc = await getOwnedDomain({ userId: user.id, projectId: id, domainId })
    if (doc.status === "revoked" || !doc.token || !doc.fileName) {
      return fail("CHALLENGE_MISSING", "This domain needs a new verification token before it can be checked.", 409)
    }
    return new Response(fileContentForToken(doc.token), {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-disposition": `attachment; filename="${doc.fileName}"`,
        "cache-control": "no-store",
      },
    })
  } catch (error) {
    if (error instanceof DomainServiceError) {
      return fail(error.code, error.message, error.status)
    }
    return handleRouteError("projects.domains.file", error)
  }
}
