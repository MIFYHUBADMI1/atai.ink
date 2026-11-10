import { getDb } from "./mongodb"
import type { Db } from "mongodb"
import type {
  AdStrategyDoc,
  AdCampaignRequestDoc,
  AdRequestEventDoc,
  AdPricingPackageDoc,
  AdCampaignActivityDoc,
  AdCampaignPerformanceDoc,
} from "@/lib/types/ads"

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

/** Founder advertising requests ("Promote My Business with Atai"). */
export async function adCampaignRequestsCol() {
  return (await getAdsDb()).collection<AdCampaignRequestDoc>("ad_campaign_requests")
}

/** Append-only request timeline (status changes, notes, replies, events). */
export async function adRequestEventsCol() {
  return (await getAdsDb()).collection<AdRequestEventDoc>("ad_request_events")
}

/** Admin-configurable promotional packages (prices live here, not in the UI). */
export async function adPricingPackagesCol() {
  return (await getAdsDb()).collection<AdPricingPackageDoc>("ad_pricing_packages")
}

/** Manual execution checklist items for a paid campaign. */
export async function adCampaignActivitiesCol() {
  return (await getAdsDb()).collection<AdCampaignActivityDoc>("ad_campaign_activities")
}

/** Source-aware performance rows entered by admins (never fabricated). */
export async function adCampaignPerformanceCol() {
  return (await getAdsDb()).collection<AdCampaignPerformanceDoc>("ad_campaign_performance")
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
    // Requests — idempotent submission (retries with the same key return the
    // original doc), founder history, admin inbox scans by status/time.
    db
      .collection("ad_campaign_requests")
      .createIndex({ idempotencyKey: 1 }, { unique: true, name: "ad_requests_idempotency_unique" }),
    db
      .collection("ad_campaign_requests")
      .createIndex({ projectId: 1, createdAt: -1 }, { name: "ad_requests_project_created" }),
    db
      .collection("ad_campaign_requests")
      .createIndex({ userId: 1, createdAt: -1 }, { name: "ad_requests_user_created" }),
    db
      .collection("ad_campaign_requests")
      .createIndex({ status: 1, createdAt: -1 }, { name: "ad_requests_status_created" }),
    // Timeline reads are always request-scoped and chronological.
    db
      .collection("ad_request_events")
      .createIndex({ requestId: 1, createdAt: 1 }, { name: "ad_request_events_request_created" }),
    db
      .collection("ad_pricing_packages")
      .createIndex({ active: 1, createdAt: -1 }, { name: "ad_packages_active_created" }),
    db
      .collection("ad_campaign_activities")
      .createIndex({ requestId: 1, createdAt: 1 }, { name: "ad_activities_request_created" }),
    db
      .collection("ad_campaign_performance")
      .createIndex({ requestId: 1, reportedAt: -1 }, { name: "ad_performance_request_reported" }),
  ])
}
