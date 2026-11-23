import "server-only"

import type { PermanentCreditPack, SubscriptionPlan } from "@/lib/billing/config"
import {
  resolveCommercialCatalog,
  PublishedCatalogError,
  type PublishedInfrastructureProduct,
  type ResolvedCommercialCatalog,
} from "./published-resolver"
import { getCatalogSource, isCatalogDbPublicReadEnabled } from "./source"
import type {
  AdminCatalogSourceView,
  AdminCheckoutSource,
} from "./admin-source-types"

export interface AdminCatalogSnapshot {
  source: AdminCatalogSourceView
  plans: SubscriptionPlan[]
  packs: PermanentCreditPack[]
  infrastructure: PublishedInfrastructureProduct[]
}

function errorText(error: unknown): string {
  if (error instanceof PublishedCatalogError) return error.reason
  return error instanceof Error ? error.message : "database catalog unavailable"
}

/**
 * One catalog read for every admin surface. It prefers the selected source,
 * falls back to code only so the admin can still operate, and records what
 * checkout will actually use. A database-selected public read that fails is
 * reported as `unavailable`, never silently presented as code prices.
 */
export async function resolveAdminCatalogSnapshot(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AdminCatalogSnapshot> {
  const requestedSource = getCatalogSource(env)
  const publicReadsEnabled = isCatalogDbPublicReadEnabled(env)

  let resolved: ResolvedCommercialCatalog
  let error: string | null = null

  try {
    resolved = await resolveCommercialCatalog({ env })
  } catch (e) {
    error = errorText(e)
    resolved = await resolveCommercialCatalog({
      env: { ...env, CATALOG_SOURCE: "code" },
    })
  }

  const checkoutSource: AdminCheckoutSource =
    requestedSource === "db" && publicReadsEnabled
      ? resolved.source === "db"
        ? "db"
        : "unavailable"
      : "code"

  const publication = resolved.publication
  return {
    source: {
      requestedSource,
      adminSource: resolved.source,
      checkoutSource,
      publicReadsEnabled,
      gated: requestedSource === "db" && !publicReadsEnabled,
      publication: publication
        ? {
            version: publication.version,
            publishedAt: publication.publishedAt,
            activatedAt: publication.activatedAt,
            productCount: publication.productVersionIds.length,
            checksum: publication.checksum,
          }
        : null,
      shadowDifferences: resolved.shadow.differences.length,
      error,
    },
    plans: resolved.plans,
    packs: resolved.packs,
    infrastructure: resolved.infrastructure,
  }
}
