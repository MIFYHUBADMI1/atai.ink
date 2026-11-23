import "server-only"

import type { MirrorProject } from "@/lib/types/project"
import { verifiedHostnameForBusiness } from "./anchor"

/**
 * The one address Atai is allowed to audit for a project.
 *
 * A build project is audited at its recorded production URL, and only after a
 * successful deployment — the same rule the SEO tool has always used.
 *
 * A connected business has no deployment at all: it runs somewhere Atai does
 * not host. Its auditable address is the hostname the founder *proved*, never
 * a typed URL, so the audit cannot be pointed at a site the founder does not
 * own.
 */
export interface AuditableSite {
  url: string
  source: "deployment" | "business-domain"
}

export async function auditableSiteUrl(project: MirrorProject | null): Promise<AuditableSite | null> {
  if (!project) return null
  const deployment = project.deployment
  if (deployment?.status === "success" && deployment.productionUrl) {
    return { url: deployment.productionUrl, source: "deployment" }
  }
  if (!project.businessId) return null
  const hostname = await verifiedHostnameForBusiness(project.businessId)
  return hostname ? { url: `https://${hostname}`, source: "business-domain" } : null
}
