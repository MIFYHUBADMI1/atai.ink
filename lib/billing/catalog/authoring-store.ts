import type { ClientSession } from "mongodb"
import {
  commercialCatalogVersionsCol,
  commercialProductVersionsCol,
  commercialProductsCol,
  ensureIndexes,
} from "@/lib/db/collections"
import { getMongoClient } from "@/lib/db/mongodb"
import type {
  CommercialCatalogVersionDoc,
  CommercialProductDoc,
  CommercialProductVersionDoc,
} from "./types"

export type CreateProductOutcome = "inserted" | "duplicate"
export type ReplaceDraftOutcome = "ok" | "conflict" | "duplicate_version"
export type PublishOutcome = "ok" | "conflict" | "duplicate_publication"
export type ActivatePublicationOutcome = "ok" | "conflict"

export interface ProductPatch {
  status?: CommercialProductDoc["status"]
  currentVersionId?: string | null
  updatedAt?: number
  archivedBy?: string
  archivedAt?: number
}

export interface VersionPatch {
  status?: CommercialProductVersionDoc["status"]
  effectiveAt?: number
  publishedBy?: string
  publishedAt?: number
  checksum?: string
  notes?: string
}

export interface CatalogActivationStore {
  listProducts(): Promise<CommercialProductDoc[]>
  listVersions(): Promise<CommercialProductVersionDoc[]>
  listCatalogVersions(): Promise<CommercialCatalogVersionDoc[]>
  activatePublication(input: {
    version: string
    expectedChecksum: string
    actorId: string
    now: number
  }): Promise<ActivatePublicationOutcome>
}

export interface CatalogAuthoringStore {
  listProducts(): Promise<CommercialProductDoc[]>
  listVersions(): Promise<CommercialProductVersionDoc[]>
  listCatalogVersions(): Promise<CommercialCatalogVersionDoc[]>
  createProductWithVersion(
    product: CommercialProductDoc,
    version: CommercialProductVersionDoc,
  ): Promise<CreateProductOutcome>
  replaceDraftVersion(input: {
    productId: string
    expectedUpdatedAt: number
    productPatch: ProductPatch
    oldDraft?: { id: string; checksum: string; patch: VersionPatch }
    newVersion: CommercialProductVersionDoc
  }): Promise<ReplaceDraftOutcome>
  publishVersion(input: {
    productId: string
    expectedUpdatedAt: number
    versionId: string
    versionPatch: VersionPatch
    productPatch: ProductPatch
    publication: CommercialCatalogVersionDoc
  }): Promise<PublishOutcome>
  archiveProduct(input: {
    productId: string
    expectedUpdatedAt: number
    productPatch: ProductPatch
  }): Promise<"ok" | "conflict">
}

class AbortWrite extends Error {
  constructor(readonly outcome: string) {
    super(outcome)
  }
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  )
}

export async function mongoCatalogAuthoringStore(): Promise<
  CatalogAuthoringStore & CatalogActivationStore
> {
  const products = await commercialProductsCol()
  const versions = await commercialProductVersionsCol()
  const catalogVersions = await commercialCatalogVersionsCol()
  await ensureIndexes()

  async function inTransaction<T extends string>(
    run: (session: ClientSession) => Promise<void>,
  ): Promise<T | null> {
    const client = await getMongoClient()
    const session = client.startSession()
    try {
      await session.withTransaction(async () => {
        await run(session)
      })
      return null
    } catch (error) {
      if (error instanceof AbortWrite) return error.outcome as T
      throw error
    } finally {
      await session.endSession()
    }
  }

  return {
    async listProducts() {
      return products.find({}).sort({ type: 1, id: 1 }).toArray()
    },
    async listVersions() {
      return versions.find({}).sort({ productId: 1, version: 1 }).toArray()
    },
    async listCatalogVersions() {
      return catalogVersions.find({}).sort({ publishedAt: -1 }).toArray()
    },

    async createProductWithVersion(product, version) {
      const outcome = await inTransaction<CreateProductOutcome>(async (session) => {
        try {
          await products.insertOne(product, { session })
        } catch (error) {
          if (isDuplicateKey(error)) throw new AbortWrite("duplicate")
          throw error
        }
        try {
          await versions.insertOne(version, { session })
        } catch (error) {
          if (isDuplicateKey(error)) throw new AbortWrite("duplicate")
          throw error
        }
      })
      return outcome ?? "inserted"
    },

    async replaceDraftVersion(input) {
      const outcome = await inTransaction<ReplaceDraftOutcome>(async (session) => {
        const productResult = await products.updateOne(
          {
            id: input.productId,
            updatedAt: input.expectedUpdatedAt,
            status: { $ne: "archived" },
          },
          { $set: input.productPatch },
          { session },
        )
        if (productResult.matchedCount === 0) throw new AbortWrite("conflict")

        if (input.oldDraft) {
          const draftResult = await versions.updateOne(
            {
              id: input.oldDraft.id,
              productId: input.productId,
              status: "draft",
              checksum: input.oldDraft.checksum,
            },
            { $set: input.oldDraft.patch },
            { session },
          )
          if (draftResult.matchedCount === 0) throw new AbortWrite("conflict")
        }

        try {
          await versions.insertOne(input.newVersion, { session })
        } catch (error) {
          if (isDuplicateKey(error)) throw new AbortWrite("duplicate_version")
          throw error
        }
      })
      return outcome ?? "ok"
    },

    async publishVersion(input) {
      const outcome = await inTransaction<PublishOutcome>(async (session) => {
        const versionResult = await versions.updateOne(
          { id: input.versionId, productId: input.productId, status: "draft" },
          { $set: input.versionPatch },
          { session },
        )
        if (versionResult.matchedCount === 0) throw new AbortWrite("conflict")

        const productResult = await products.updateOne(
          {
            id: input.productId,
            updatedAt: input.expectedUpdatedAt,
            status: { $ne: "archived" },
          },
          { $set: input.productPatch },
          { session },
        )
        if (productResult.matchedCount === 0) throw new AbortWrite("conflict")

        try {
          await catalogVersions.insertOne(input.publication, { session })
        } catch (error) {
          if (isDuplicateKey(error)) throw new AbortWrite("duplicate_publication")
          throw error
        }
      })
      return outcome ?? "ok"
    },

    async archiveProduct(input) {
      const outcome = await inTransaction<"conflict">(async (session) => {
        const result = await products.updateOne(
          {
            id: input.productId,
            updatedAt: input.expectedUpdatedAt,
            status: { $ne: "archived" },
          },
          { $set: input.productPatch },
          { session },
        )
        if (result.matchedCount === 0) throw new AbortWrite("conflict")
      })
      return outcome ?? "ok"
    },

    async activatePublication(input) {
      const outcome = await inTransaction<"conflict">(async (session) => {
        await catalogVersions.updateMany(
          { status: "active", version: { $ne: input.version } },
          {
            $set: {
              status: "superseded",
              supersededBy: input.actorId,
              supersededAt: input.now,
            },
          },
          { session },
        )
        const result = await catalogVersions.updateOne(
          {
            version: input.version,
            status: "candidate",
            checksum: input.expectedChecksum,
          },
          {
            $set: {
              status: "active",
              activatedBy: input.actorId,
              activatedAt: input.now,
            },
          },
          { session },
        )
        if (result.matchedCount === 0) throw new AbortWrite("conflict")
      })
      return outcome ?? "ok"
    },
  }
}
