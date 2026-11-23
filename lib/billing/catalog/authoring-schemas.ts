import { z } from "zod"
import { AppError } from "@/lib/errors"
import type { BillingInterval } from "@/lib/billing/billing-types"
import type { EntitlementSet } from "@/lib/billing/entitlements/types"
import type {
  CatalogCreditTerms,
  CatalogEntitlementTemplate,
  CatalogInfrastructureTerms,
  CatalogProductType,
  CatalogSaleMode,
} from "./types"

const nonNegativeInt = z.number().int().min(0)
const nullableNonNegativeInt = nonNegativeInt.nullable()

const creditTermsSchema = z
  .object({
    creditType: z.enum(["subscription", "permanent", "promotional"]).optional(),
    monthlyGrant: nullableNonNegativeInt.optional(),
    oneTimeGrant: nullableNonNegativeInt.optional(),
    annualTotalCredits: nullableNonNegativeInt.optional(),
    annualMonths: z.number().int().min(0).max(120).nullable().optional(),
    annualIssuance: z.enum(["monthly", "upfront"]).nullable().optional(),
    expiresAfterDays: z.number().int().min(0).nullable().optional(),
    bonusCredits: nullableNonNegativeInt.optional(),
  })
  .strict()

const entitlementSchema = z
  .object({
    templateId: z.string().trim().min(1).max(200),
    version: z.string().trim().min(1).max(100),
    snapshot: z.record(z.string(), z.unknown()),
  })
  .strict()

const infrastructureSchema = z
  .object({
    purchaseModel: z.enum(["credit_funded", "direct_purchase"]),
    durationDays: z.number().int().min(1).max(3_650),
    renewal: z.enum(["manual", "auto", "none"]),
    storageLabel: z.string().trim().min(1).max(120),
    storageBytes: nullableNonNegativeInt.optional(),
    totalumInfrastructureCredits: nullableNonNegativeInt.optional(),
    creditCharge: nullableNonNegativeInt.optional(),
    includedResources: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

export const versionFieldsSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(2_000),
    tagline: z.string().trim().max(200).optional(),
    saleMode: z.enum(["self_serve", "free", "contact"]),
    currency: z.string().trim().regex(/^[A-Z]{3}$/, "Currency must be a three-letter ISO code."),
    priceMinor: nullableNonNegativeInt,
    annualPriceMinor: nullableNonNegativeInt,
    billingIntervals: z
      .array(z.enum(["monthly", "annual"]))
      .max(2)
      .refine((values) => new Set(values).size === values.length, "Billing intervals must be unique."),
    credits: creditTermsSchema.nullable(),
    entitlement: entitlementSchema.nullable(),
    infrastructure: infrastructureSchema.optional(),
    changeSummary: z.string().trim().min(1).max(500),
    notes: z.string().trim().max(2_000).optional(),
  })
  .strict()

export const createProductSchema = versionFieldsSchema
  .extend({
    type: z.enum(["subscription", "credit_pack", "infrastructure"]),
    slug: z
      .string()
      .trim()
      .min(2)
      .max(64)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase words separated by hyphens."),
  })
  .strict()

export const versionMutationSchema = versionFieldsSchema
  .partial()
  .extend({
    expectedUpdatedAt: z.number().int().min(0),
    changeSummary: z.string().trim().min(1).max(500),
  })
  .strict()
  .refine(
    (value) =>
      Object.keys(value).some((key) => key !== "expectedUpdatedAt" && key !== "changeSummary"),
    "Provide at least one version field to change.",
  )

export const createVersionSchema = versionMutationSchema

export const publishSchema = z
  .object({ expectedUpdatedAt: z.number().int().min(0) })
  .strict()

export const archiveSchema = z
  .object({ expectedUpdatedAt: z.number().int().min(0) })
  .strict()

export const activatePublicationSchema = z
  .object({ expectedChecksum: z.string().trim().min(1).max(128) })
  .strict()

export type CreateProductInput = z.infer<typeof createProductSchema>
export type VersionMutationInput = z.infer<typeof versionMutationSchema>
export type PublishInput = z.infer<typeof publishSchema>
export type ArchiveInput = z.infer<typeof archiveSchema>
export type ActivatePublicationInput = z.infer<typeof activatePublicationSchema>

export interface CatalogVersionFields {
  name: string
  description: string
  tagline?: string
  saleMode: CatalogSaleMode
  currency: string
  priceMinor: number | null
  annualPriceMinor: number | null
  billingIntervals: BillingInterval[]
  credits: CatalogCreditTerms | null
  entitlement: CatalogEntitlementTemplate | null
  infrastructure?: CatalogInfrastructureTerms
  changeSummary: string
  notes?: string
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (!result.success) {
    throw new AppError(
      "VALIDATION",
      result.error.issues[0]?.message ?? "Invalid catalog input.",
    )
  }
  return result.data
}

export function parseCreateProductInput(input: unknown): CreateProductInput {
  return parse(createProductSchema, input)
}

export function parseVersionMutationInput(input: unknown): VersionMutationInput {
  return parse(versionMutationSchema, input)
}

export function parseCreateVersionInput(input: unknown): VersionMutationInput {
  return parse(createVersionSchema, input)
}

export function parsePublishInput(input: unknown): PublishInput {
  return parse(publishSchema, input)
}

export function parseArchiveInput(input: unknown): ArchiveInput {
  return parse(archiveSchema, input)
}

export function parseActivatePublicationInput(input: unknown): ActivatePublicationInput {
  return parse(activatePublicationSchema, input)
}

function normalizeCredits(
  type: CatalogProductType,
  input: z.infer<typeof creditTermsSchema> | null | undefined,
): CatalogCreditTerms | null {
  if (input === null || input === undefined) return null
  const defaultType = type === "subscription" ? "subscription" : "permanent"
  return {
    creditType: input.creditType ?? defaultType,
    monthlyGrant: input.monthlyGrant ?? null,
    oneTimeGrant: input.oneTimeGrant ?? null,
    annualTotalCredits: input.annualTotalCredits ?? null,
    annualMonths: input.annualMonths ?? null,
    annualIssuance: input.annualIssuance ?? null,
    expiresAfterDays: input.expiresAfterDays ?? null,
    bonusCredits: input.bonusCredits ?? null,
  }
}

function normalizeInfrastructure(
  input: z.infer<typeof infrastructureSchema> | undefined,
): CatalogInfrastructureTerms | undefined {
  if (!input) return undefined
  return {
    purchaseModel: input.purchaseModel,
    durationDays: input.durationDays,
    renewal: input.renewal,
    storageLabel: input.storageLabel,
    storageBytes: input.storageBytes ?? null,
    totalumInfrastructureCredits: input.totalumInfrastructureCredits ?? null,
    creditCharge: input.creditCharge ?? null,
    includedResources: input.includedResources ?? {},
  }
}

export function normalizeVersionFields(
  type: CatalogProductType,
  input: z.infer<typeof versionFieldsSchema>,
): CatalogVersionFields {
  return {
    name: input.name,
    description: input.description,
    tagline: input.tagline,
    saleMode: input.saleMode,
    currency: input.currency,
    priceMinor: input.priceMinor,
    annualPriceMinor: input.annualPriceMinor,
    billingIntervals: [...input.billingIntervals],
    credits: normalizeCredits(type, input.credits),
    entitlement: input.entitlement
      ? {
          templateId: input.entitlement.templateId,
          version: input.entitlement.version,
          snapshot: input.entitlement.snapshot as unknown as EntitlementSet,
        }
      : null,
    infrastructure: normalizeInfrastructure(input.infrastructure),
    changeSummary: input.changeSummary,
    notes: input.notes,
  }
}

/**
 * Merge a partial authoring payload over an existing version. Credits and
 * infrastructure are merged one level deep so an admin can change a single
 * rate without re-sending the whole object.
 */
export function mergeVersionFields(
  base: CatalogVersionFields,
  patch: Partial<z.infer<typeof versionFieldsSchema>>,
  type: CatalogProductType,
): CatalogVersionFields {
  const mergedCredits =
    patch.credits === undefined
      ? base.credits
      : patch.credits === null
        ? null
        : normalizeCredits(type, { ...(base.credits ?? {}), ...patch.credits })
  const mergedInfrastructure = (
    patch.infrastructure === undefined
      ? base.infrastructure
      : {
          ...(base.infrastructure ?? {}),
          ...normalizeInfrastructure(patch.infrastructure),
          includedResources:
            patch.infrastructure.includedResources ??
            base.infrastructure?.includedResources ??
            {},
        }
  ) as CatalogInfrastructureTerms | undefined

  return {
    name: patch.name ?? base.name,
    description: patch.description ?? base.description,
    tagline: patch.tagline ?? base.tagline,
    saleMode: patch.saleMode ?? base.saleMode,
    currency: patch.currency ?? base.currency,
    priceMinor: patch.priceMinor !== undefined ? patch.priceMinor : base.priceMinor,
    annualPriceMinor:
      patch.annualPriceMinor !== undefined ? patch.annualPriceMinor : base.annualPriceMinor,
    billingIntervals: patch.billingIntervals
      ? [...patch.billingIntervals]
      : [...base.billingIntervals],
    credits: mergedCredits,
    entitlement:
      patch.entitlement === undefined
        ? base.entitlement
        : patch.entitlement === null
          ? null
          : {
              templateId: patch.entitlement.templateId,
              version: patch.entitlement.version,
              snapshot: patch.entitlement.snapshot as unknown as EntitlementSet,
            },
    infrastructure:
      mergedInfrastructure && Object.keys(mergedInfrastructure).length > 0
        ? mergedInfrastructure
        : undefined,
    changeSummary: patch.changeSummary ?? base.changeSummary,
    notes: patch.notes ?? base.notes,
  }
}

export function validateVersionFields(
  type: CatalogProductType,
  fields: CatalogVersionFields,
): string | null {
  if (fields.currency !== fields.currency.toUpperCase()) {
    return "Currency must be uppercase."
  }
  if (new Set(fields.billingIntervals).size !== fields.billingIntervals.length) {
    return "Billing intervals must be unique."
  }
  if (fields.billingIntervals.includes("annual") && fields.annualPriceMinor === null) {
    return "Annual billing requires an annual price."
  }
  if (!fields.billingIntervals.includes("annual") && fields.annualPriceMinor !== null) {
    return "An annual price requires annual billing."
  }
  if (fields.saleMode === "free" && (fields.priceMinor ?? 0) !== 0) {
    return "A free product must have a zero price."
  }

  if (type === "subscription") {
    if (!fields.credits) return "A subscription requires credit terms."
    if (fields.credits.creditType !== "subscription") {
      return "A subscription must use subscription credits."
    }
    if (fields.credits.monthlyGrant === null && fields.saleMode !== "contact") {
      return "A subscription requires a monthly credit grant."
    }
    if (fields.saleMode === "self_serve" && fields.priceMinor === null) {
      return "A self-serve subscription requires a monthly price."
    }
    if (fields.infrastructure) return "A subscription cannot carry infrastructure terms."
    if (fields.saleMode !== "contact" && !fields.billingIntervals.includes("monthly")) {
      return "A purchasable subscription requires monthly billing."
    }
  }

  if (type === "credit_pack") {
    if (!fields.credits) return "A credit pack requires credit terms."
    if (fields.credits.creditType !== "permanent") {
      return "A credit pack must use permanent credits."
    }
    if (fields.credits.oneTimeGrant === null || fields.credits.oneTimeGrant <= 0) {
      return "A credit pack requires a positive one-time grant."
    }
    if (fields.billingIntervals.length > 0) {
      return "A credit pack cannot have billing intervals."
    }
    if (fields.saleMode !== "self_serve") return "A credit pack must be self-serve."
    if (fields.priceMinor === null || fields.priceMinor <= 0) {
      return "A credit pack requires a positive price."
    }
    if (fields.infrastructure) return "A credit pack cannot carry infrastructure terms."
  }

  if (type === "infrastructure") {
    if (!fields.infrastructure) return "An infrastructure product requires infrastructure terms."
    if (fields.credits) return "An infrastructure product cannot carry credit grants."
    if (fields.entitlement) return "An infrastructure product cannot carry an entitlement template."
    if (fields.billingIntervals.length > 0) {
      return "An infrastructure product cannot have billing intervals."
    }
    if (fields.priceMinor === null || fields.priceMinor < 0) {
      return "Infrastructure requires an explicit fiat price (0 for credit-funded)."
    }
    if (fields.infrastructure.purchaseModel === "credit_funded") {
      if (fields.infrastructure.creditCharge === null) {
        return "Credit-funded infrastructure requires a credit charge."
      }
    }
  }

  if (fields.entitlement && !fields.entitlement.templateId.trim()) {
    return "Entitlement template id is required."
  }
  return null
}
