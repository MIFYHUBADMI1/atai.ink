import { getDb } from "./mongodb"
import type { Db } from "mongodb"
import type { AdStrategyDoc } from "@/lib/types/ads"

/**
 * Ads & Growth Center — collection registration & indexes.
 *
 * Uses the same shared Mongo client (lib/db/mongodb.ts — no second client) and
 * the same idempotent-index pattern as lib/db/collections.ts. Lives in its own
 * module so the ads feature can grow without touching the shared collections
 * registry.
 *
 * @module lib/db/ads-collections
 */

const globalForAdsDb = globalThis as unknown as {
  __ataiAdsDb?: Db
  __ataiAdsIndexesPromise?: Promise<void>
  __ataiAdsIndexesReady?: boolean
  __ataiAdsIndexesRetryAt?: number
}

async function getAdsDb(): Promise<Db> {
  if (!globalForAdsDb.__ataiAdsDb) {
    globalForAdsDb.__ataiAdsDb = await getDb()
  }
  return globalForAdsDb.__ataiAdsDb
}

/** One advertising strategy per project (unique). */
export async function adStrategiesCol() {
  return (await getAdsDb()).collection<AdStrategyDoc>("ad_strategies")
}

const ADS_INDEX_RETRY_COOLDOWN_MS = 60_000

export async function ensureAdsIndexes(): Promise<void> {
  if (globalForAdsDb.__ataiAdsIndexesReady) return
  if (globalForAdsDb.__ataiAdsIndexesPromise) return globalForAdsDb.__ataiAdsIndexesPromise
  if (
    globalForAdsDb.__ataiAdsIndexesRetryAt &&
    Date.now() < globalForAdsDb.__ataiAdsIndexesRetryAt
  ) {
    return
  }

  globalForAdsDb.__ataiAdsIndexesPromise = runEnsureAdsIndexes()
    .then(() => {
      globalForAdsDb.__ataiAdsIndexesReady = true
    })
    .catch((error) => {
      console.error("[atai] ensureAdsIndexes: failed", error)
      globalForAdsDb.__ataiAdsIndexesRetryAt = Date.now() + ADS_INDEX_RETRY_COOLDOWN_MS
    })
    .finally(() => {
      globalForAdsDb.__ataiAdsIndexesPromise = undefined
    })
  return globalForAdsDb.__ataiAdsIndexesPromise
}

async function runEnsureAdsIndexes(): Promise<void> {
  const db = await getAdsDb()
  await Promise.all([
    db
      .collection("ad_strategies")
      .createIndex({ projectId: 1 }, { unique: true, name: "ad_strategies_project_unique" }),
  ])
}
