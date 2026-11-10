import "server-only"

/**
 * Admin-configurable promotional packages. Prices live in Mongo — never in the
 * frontend. Empty collections are seeded with illustrative defaults the admin
 * can edit; those numbers are not claims about Atai's actual reach.
 */

import { ObjectId } from "mongodb"
import { cryptoId } from "@/lib/store/store"
import { adPricingPackagesCol, ensureAdsIndexes } from "@/lib/db/ads-collections"
import { AppError } from "@/lib/errors"
import type { AdPricingPackageDoc } from "@/lib/types/ads"
import { bounded, boundedList, clampInt } from "./lifecycle-rules"

const SEED: Array<Omit<AdPricingPackageDoc, "_id" | "id" | "createdAt" | "updatedAt">> = [
  {
    name: "Starter Promotion",
    description: "A short, focused promotional burst. Impression ranges are estimates, not guarantees.",
    durationDays: 3,
    creditsPrice: 1500,
    estimatedImpressionsMin: 1000,
    estimatedImpressionsMax: 3000,
    channels: ["Instagram", "Facebook"],
    active: true,
  },
  {
    name: "Growth Promotion",
    description: "A one-week campaign with a wider audience. Estimates only — not guaranteed delivery.",
    durationDays: 7,
    creditsPrice: 4000,
    estimatedImpressionsMin: 3000,
    estimatedImpressionsMax: 10000,
    channels: ["Instagram", "Facebook", "TikTok"],
    active: true,
  },
  {
    name: "Business Promotion",
    description: "A two-week campaign. Visibility ranges are planning estimates, not customers or sales.",
    durationDays: 14,
    creditsPrice: 9000,
    estimatedImpressionsMin: 10000,
    estimatedImpressionsMax: 30000,
    channels: ["Instagram", "Facebook", "TikTok", "LinkedIn"],
    active: true,
  },
  {
    name: "Extended Promotion",
    description: "A month-long campaign. Atai's team executes manually; ranges are not guaranteed.",
    durationDays: 30,
    creditsPrice: 18000,
    estimatedImpressionsMin: 30000,
    estimatedImpressionsMax: 100000,
    channels: ["Instagram", "Facebook", "TikTok", "LinkedIn", "YouTube"],
    active: true,
  },
]

export async function listPricingPackages(opts: { includeInactive?: boolean } = {}): Promise<AdPricingPackageDoc[]> {
  await ensureAdsIndexes()
  await seedPricingPackagesIfEmpty()
  const filter = opts.includeInactive ? {} : { active: true }
  return (await (await adPricingPackagesCol())
    .find(filter)
    .sort({ creditsPrice: 1 })
    .limit(50)
    .toArray()) as unknown as AdPricingPackageDoc[]
}

export async function getPricingPackage(id: string): Promise<AdPricingPackageDoc | null> {
  await ensureAdsIndexes()
  return (await (await adPricingPackagesCol()).findOne({ id })) as AdPricingPackageDoc | null
}

export async function upsertPricingPackage(input: {
  id?: string
  name: string
  description?: string
  durationDays: number
  creditsPrice: number
  estimatedImpressionsMin: number
  estimatedImpressionsMax: number
  channels?: string[]
  active?: boolean
}): Promise<AdPricingPackageDoc> {
  await ensureAdsIndexes()
  const name = bounded(input.name, 80)
  const creditsPrice = clampInt(input.creditsPrice, 1, 1_000_000)
  const durationDays = clampInt(input.durationDays, 1, 365)
  const min = clampInt(input.estimatedImpressionsMin, 0, 100_000_000) ?? 0
  const max = clampInt(input.estimatedImpressionsMax, 0, 100_000_000) ?? min
  if (!name || creditsPrice == null || durationDays == null) throw new AppError("VALIDATION")
  if (max < min) throw new AppError("VALIDATION")

  const now = Date.now()
  const col = await adPricingPackagesCol()
  if (input.id) {
    const updated = (await col.findOneAndUpdate(
      { id: input.id },
      {
        $set: {
          name,
          description: bounded(input.description, 800),
          durationDays,
          creditsPrice,
          estimatedImpressionsMin: min,
          estimatedImpressionsMax: max,
          channels: boundedList(input.channels, 12, 80),
          active: input.active !== false,
          updatedAt: now,
        },
      },
      { returnDocument: "after" },
    )) as AdPricingPackageDoc | null
    if (!updated) throw new AppError("VALIDATION", "That package was not found.", 404)
    return updated
  }

  const doc: AdPricingPackageDoc = {
    _id: new ObjectId(),
    id: `adpkg_${cryptoId()}`,
    name,
    description: bounded(input.description, 800),
    durationDays,
    creditsPrice,
    estimatedImpressionsMin: min,
    estimatedImpressionsMax: max,
    channels: boundedList(input.channels, 12, 80),
    active: input.active !== false,
    createdAt: now,
    updatedAt: now,
  }
  await col.insertOne(doc as never)
  return doc
}

async function seedPricingPackagesIfEmpty(): Promise<void> {
  const col = await adPricingPackagesCol()
  const count = await col.countDocuments({}, { limit: 1 })
  if (count > 0) return
  const now = Date.now()
  await col.insertMany(
    SEED.map((row) => ({
      _id: new ObjectId(),
      id: `adpkg_${cryptoId()}`,
      ...row,
      createdAt: now,
      updatedAt: now,
    })) as never[],
  )
}
