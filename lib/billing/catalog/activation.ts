import { AppError } from "@/lib/errors"
import { logAuditAction } from "@/lib/infrastructure/audit"
import { parseActivatePublicationInput } from "./authoring-schemas"
import {
  mongoCatalogAuthoringStore,
  type CatalogActivationStore,
} from "./authoring-store"
import {
  assertCheckoutCompatible,
  PublishedCatalogError,
  resolvePublicationCatalog,
} from "./published-resolver"
import type { CatalogActor } from "./authoring"

export interface CatalogActivationResult {
  publicationVersion: string
  status: "active"
  activatedAt: number
  superseded: string[]
}

function conflict(message: string): never {
  throw new AppError("CATALOG_CONFLICT", message)
}

function validation(message: string): never {
  throw new AppError("VALIDATION", message, 422)
}

/**
 * Explicitly activate one candidate publication. The candidate must still
 * match the checksum the admin previewed, pass the same resolver used by
 * customer reads, and be checkout-compatible with the code catalog. The
 * previous active publication is superseded in the same transaction.
 *
 * Activation does not enable customer database reads. That remains gated by
 * CATALOG_SOURCE and CATALOG_DB_PUBLIC_READS.
 */
export async function activateCatalogPublication(input: {
  version: string
  body: unknown
  actor: CatalogActor
  store?: CatalogActivationStore
  now?: number
  env?: NodeJS.ProcessEnv
}): Promise<CatalogActivationResult> {
  const parsed = parseActivatePublicationInput(input.body)
  const store = input.store ?? (await mongoCatalogAuthoringStore())
  const now = input.now ?? Date.now()
  const env = input.env ?? process.env

  const [publications, products, versions] = await Promise.all([
    store.listCatalogVersions(),
    store.listProducts(),
    store.listVersions(),
  ])

  const candidate = publications.find((publication) => publication.version === input.version)
  if (!candidate) throw new AppError("NOT_FOUND", "Publication not found.", 404)
  if (candidate.status !== "candidate") {
    conflict("Only a candidate publication can be activated.")
  }
  if (candidate.checksum !== parsed.expectedChecksum) {
    conflict("The publication changed since it was previewed. Preview and try again.")
  }

  const futureVersions = versions.filter(
    (version) =>
      candidate.productVersionIds.includes(version.id) && version.effectiveAt > now,
  )
  if (futureVersions.length > 0) {
    validation("The candidate contains versions effective in the future. Activate it when they are due.")
  }

  try {
    const resolved = resolvePublicationCatalog({
      publication: candidate,
      products,
      versions,
      now,
      requestedSource: "db",
      publicReadsEnabled: true,
      env,
    })
    assertCheckoutCompatible(resolved, env)
  } catch (error) {
    if (error instanceof PublishedCatalogError) {
      validation(`The publication is not activatable: ${error.reason}.`)
    }
    throw error
  }

  const outcome = await store.activatePublication({
    version: candidate.version,
    expectedChecksum: parsed.expectedChecksum,
    actorId: input.actor.id,
    now,
  })
  if (outcome === "conflict") {
    conflict("The publication changed while it was being activated. Preview and try again.")
  }
  const superseded = outcome.superseded

  await logAuditAction({
    adminUserId: input.actor.id,
    adminUserEmail: input.actor.email,
    action: "catalog.publication.activate",
    previousValue: superseded.length > 0 ? superseded.join(",") : "none",
    newValue: candidate.version,
    result: "success",
    metadata: {
      publicationVersion: candidate.version,
      productCount: candidate.productVersionIds.length,
      superseded,
      checksum: candidate.checksum,
    },
  })

  return {
    publicationVersion: candidate.version,
    status: "active",
    activatedAt: now,
    superseded,
  }
}
