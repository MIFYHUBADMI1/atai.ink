import { AppError } from "@/lib/errors"
import { logger } from "@/lib/logging/logger"
import {
  PERMANENT_CREDIT_PACKS,
  getPermanentCreditPacks,
  type PermanentCreditPack,
  type SubscriptionPlan,
} from "@/lib/billing/config"
import {
  getCommercialPlanById,
  getCommercialPlans,
} from "@/lib/billing/entitlements/commercial-plans"
import {
  ALL_PLAN_ORDER,
  INFRASTRUCTURE_PLANS,
  type InfrastructurePlanId,
} from "@/lib/infrastructure/plans"
import {
  buildCodeCatalogSnapshot,
  catalogPublicationChecksum,
  versionChecksum,
} from "./code-catalog"
import { mongoCatalogSeedStore, type CatalogSeedStore } from "./seed"
import {
  getCatalogSource,
  isCatalogDbPublicReadEnabled,
  type CatalogSource,
} from "./source"
import type {
  CatalogInfrastructurePurchaseModel,
  CatalogInfrastructureRenewal,
  CatalogSaleMode,
  CommercialCatalogVersionDoc,
  CommercialProductDoc,
  CommercialProductVersionDoc,
} from "./types"

export type PublishedCatalogAudience = "internal" | "public"

export type PublishedCatalogErrorReason =
  | "DB_UNAVAILABLE"
  | "NO_ACTIVE_PUBLICATION"
  | "MULTIPLE_ACTIVE_PUBLICATIONS"
  | "PUBLICATION_NOT_EFFECTIVE"
  | "PUBLICATION_CHECKSUM_INVALID"
  | "PUBLICATION_MEMBERSHIP_INVALID"
  | "NO_EFFECTIVE_PRODUCTS"
  | "VERSION_MISSING"
  | "VERSION_NOT_PUBLISHED"
  | "VERSION_CHECKSUM_INVALID"
  | "PRODUCT_MISSING"
  | "PRODUCT_NOT_PUBLISHED"
  | "PRODUCT_VERSION_MISMATCH"
  | "CHECKOUT_INCOMPATIBLE"

/**
 * Safe external failure for a selected but unusable database catalog. The
 * reason stays server-side; the browser receives CATALOG_UNAVAILABLE and no
 * substitute prices.
 */
export class PublishedCatalogError extends AppError {
  readonly reason: PublishedCatalogErrorReason
  readonly detail?: Record<string, unknown>

  constructor(reason: PublishedCatalogErrorReason, detail?: Record<string, unknown>) {
    super("CATALOG_UNAVAILABLE")
    this.name = "PublishedCatalogError"
    this.reason = reason
    this.detail = detail
  }
}

export interface PublishedCatalogEntry {
  product: CommercialProductDoc
  version: CommercialProductVersionDoc
}

export interface PublishedInfrastructureProduct {
  id: string
  productId: string
  versionId: string
  name: string
  description: string
  storageLabel: string
  storageBytes: number | null
  totalumInfrastructureCredits: number | null
  creditCharge: number | null
  purchaseModel: CatalogInfrastructurePurchaseModel
  durationDays: number
  renewal: CatalogInfrastructureRenewal
  saleMode: CatalogSaleMode
}

export interface CatalogDifference {
  path: string
  expected: unknown
  actual: unknown
}

export interface ResolvedCommercialCatalog {
  source: CatalogSource
  requestedSource: CatalogSource
  publicReadsEnabled: boolean
  gated: boolean
  publication: CommercialCatalogVersionDoc | null
  entries: PublishedCatalogEntry[]
  plans: SubscriptionPlan[]
  packs: PermanentCreditPack[]
  infrastructure: PublishedInfrastructureProduct[]
  shadow: {
    compared: boolean
    differences: CatalogDifference[]
  }
}

export interface ResolveCatalogOptions {
  env?: NodeJS.ProcessEnv
  now?: number
  store?: CatalogSeedStore
  audience?: PublishedCatalogAudience
}

const PLAN_ORDER = ["explorer", "starter", "growth", "scale", "enterprise"]
let publicGateNoticeLogged = false

function catalogFailure(
  reason: PublishedCatalogErrorReason,
  detail?: Record<string, unknown>,
): never {
  logger.error("billing.catalog.resolve", "published catalog validation failed", {
    reason,
    ...detail,
  })
  throw new PublishedCatalogError(reason, detail)
}

function minorToUsd(value: number | null): number {
  return value === null ? 0 : value / 100
}

function usdToMinor(value: number | null | undefined): number | null {
  return value === null || value === undefined ? null : Math.round(value * 100)
}

function annualSavingsPct(monthly: number, annual: number | null): number | null {
  if (!annual || monthly <= 0) return null
  const twelveMonths = monthly * 12
  if (twelveMonths <= annual) return null
  return Math.round(((twelveMonths - annual) / twelveMonths) * 100)
}

function productAlias(product: CommercialProductDoc): string {
  for (const prefix of ["prod_subscription_", "prod_pack_", "prod_infra_", "prod_legacy_"]) {
    if (product.id.startsWith(prefix)) return product.id.slice(prefix.length)
  }
  return product.id
}

function toSubscriptionPlan(
  product: CommercialProductDoc,
  version: CommercialProductVersionDoc,
): SubscriptionPlan {
  const alias = productAlias(product)
  const codePlan = getCommercialPlanById(alias)
  const custom = version.saleMode === "contact"
  const free = version.saleMode === "free"
  const monthly = minorToUsd(version.priceMinor)
  const annual = version.annualPriceMinor === null ? null : minorToUsd(version.annualPriceMinor)
  const annualAvailable =
    annual !== null && version.billingIntervals.includes("annual")
  const mirrorCredits = version.credits?.monthlyGrant ?? 0

  return {
    id: alias,
    name: version.name,
    tagline: version.tagline ?? version.description,
    priceUSD: monthly,
    mirrorCredits,
    interval: "monthly",
    active: true,
    custom: custom || undefined,
    popular: codePlan?.popular,
    features: codePlan?.features ?? (version.description ? [version.description] : []),
    notIncluded: codePlan?.notIncluded,
    dodoProductId: version.dodo?.monthlyProductId,
    purchaseState: custom ? "contact" : "available",
    availability: codePlan?.availability ?? {
      agents: false,
      marketingAutomation: false,
      knowledgeBase: false,
    },
    provisionalCredits: codePlan?.provisionalCredits ?? false,
    annualPriceUSD: annual,
    annualSavingsPct: annualSavingsPct(monthly, annual),
    annualDodoProductId: version.dodo?.annualProductId,
    annualPurchaseState: custom
      ? "contact"
      : free || annualAvailable
        ? "available"
        : "soon",
    commercialPlanId: codePlan?.commercialPlanId,
  }
}

function toCreditPack(
  product: CommercialProductDoc,
  version: CommercialProductVersionDoc,
): PermanentCreditPack {
  const alias = productAlias(product)
  const codePack = PERMANENT_CREDIT_PACKS.find((pack) => pack.id === alias)
  return {
    id: alias,
    credits: version.credits?.oneTimeGrant ?? 0,
    priceUSD: minorToUsd(version.priceMinor),
    label: version.name,
    popular: codePack?.popular,
    dodoProductId: version.dodo?.oneTimeProductId,
  }
}

function toInfrastructure(
  product: CommercialProductDoc,
  version: CommercialProductVersionDoc,
): PublishedInfrastructureProduct {
  const alias = productAlias(product)
  const codePlan = INFRASTRUCTURE_PLANS[alias as InfrastructurePlanId]
  const terms = version.infrastructure
  return {
    id: alias,
    productId: product.id,
    versionId: version.id,
    name: version.name,
    description: version.description,
    storageLabel: terms?.storageLabel ?? codePlan?.storageLabel ?? "",
    storageBytes: terms
      ? terms.storageBytes
      : codePlan && Number.isFinite(codePlan.storageBytes)
        ? codePlan.storageBytes
        : null,
    totalumInfrastructureCredits: terms
      ? terms.totalumInfrastructureCredits
      : codePlan?.id === "enterprise"
        ? null
        : codePlan?.totalumInfrastructureCredits ?? null,
    creditCharge: terms ? terms.creditCharge : codePlan?.AtaiPrice ?? null,
    purchaseModel: terms?.purchaseModel ?? "credit_funded",
    durationDays: terms?.durationDays ?? 30,
    renewal: terms?.renewal ?? "manual",
    saleMode: version.saleMode,
  }
}

function codeInfrastructure(): PublishedInfrastructureProduct[] {
  return ALL_PLAN_ORDER.map((id) => {
    const plan = INFRASTRUCTURE_PLANS[id]
    const custom = plan.id === "enterprise"
    return {
      id: plan.id,
      productId: `prod_infra_${plan.id}`,
      versionId: `prod_infra_${plan.id}_v1`,
      name: plan.name,
      description: plan.description,
      storageLabel: plan.storageLabel,
      storageBytes: Number.isFinite(plan.storageBytes) ? plan.storageBytes : null,
      totalumInfrastructureCredits: custom ? null : plan.totalumInfrastructureCredits,
      creditCharge: plan.AtaiPrice,
      purchaseModel: "credit_funded",
      durationDays: 30,
      renewal: "manual",
      saleMode: plan.id === "testing" ? "free" : custom ? "contact" : "self_serve",
    }
  })
}

function codeEntries(now: number, env: NodeJS.ProcessEnv): PublishedCatalogEntry[] {
  const snapshot = buildCodeCatalogSnapshot({ now, env })
  const versions = new Map(snapshot.versions.map((version) => [version.id, version]))
  return snapshot.products
    .filter((product) => product.status === "published" && product.currentVersionId)
    .flatMap((product) => {
      const version = product.currentVersionId ? versions.get(product.currentVersionId) : undefined
      return version ? [{ product, version }] : []
    })
}

function resolveCodeCatalog(now: number, env: NodeJS.ProcessEnv): ResolvedCommercialCatalog {
  return {
    source: "code",
    requestedSource: "code",
    publicReadsEnabled: false,
    gated: false,
    publication: null,
    entries: codeEntries(now, env),
    plans: getCommercialPlans(env),
    packs: getPermanentCreditPacks(env),
    infrastructure: codeInfrastructure(),
    shadow: { compared: false, differences: [] },
  }
}

function validatePublication(
  publication: CommercialCatalogVersionDoc,
  now: number,
): void {
  if (publication.publishedAt > now) {
    catalogFailure("PUBLICATION_NOT_EFFECTIVE", {
      publication: publication.version,
      publishedAt: publication.publishedAt,
    })
  }
  const expectedChecksum = catalogPublicationChecksum({
    version: publication.version,
    productVersionIds: publication.productVersionIds,
    priceBookVersion: publication.priceBookVersion,
    entitlementVersion: publication.entitlementVersion,
  })
  if (publication.checksum !== expectedChecksum) {
    catalogFailure("PUBLICATION_CHECKSUM_INVALID", {
      publication: publication.version,
    })
  }
  if (publication.productVersionIds.length === 0) {
    catalogFailure("PUBLICATION_MEMBERSHIP_INVALID", {
      publication: publication.version,
      reason: "empty",
    })
  }
  if (new Set(publication.productVersionIds).size !== publication.productVersionIds.length) {
    catalogFailure("PUBLICATION_MEMBERSHIP_INVALID", {
      publication: publication.version,
      reason: "duplicate_version",
    })
  }
}

/**
 * Resolve one publication document against the product/version documents.
 * Exported for admin preview and activation, which must use exactly the same
 * validation and projection as the customer read path.
 */
export function resolvePublicationCatalog(input: {
  publication: CommercialCatalogVersionDoc
  products: CommercialProductDoc[]
  versions: CommercialProductVersionDoc[]
  now: number
  requestedSource: CatalogSource
  publicReadsEnabled: boolean
  env?: NodeJS.ProcessEnv
}): ResolvedCommercialCatalog {
  const { publication, products, versions, now, requestedSource, publicReadsEnabled } = input
  validatePublication(publication, now)

  const productById = new Map(products.map((product) => [product.id, product]))
  const versionById = new Map(versions.map((version) => [version.id, version]))
  const seenProducts = new Set<string>()
  const entries: PublishedCatalogEntry[] = []

  for (const versionId of publication.productVersionIds) {
    const version = versionById.get(versionId)
    if (!version) {
      catalogFailure("VERSION_MISSING", { versionId })
    }
    if (version.status !== "published") {
      catalogFailure("VERSION_NOT_PUBLISHED", { versionId, status: version.status })
    }
    if (version.saleMode === "legacy_renewal_only") {
      catalogFailure("PUBLICATION_MEMBERSHIP_INVALID", {
        publication: publication.version,
        versionId,
        reason: "legacy_renewal_only",
      })
    }
    if (version.checksum !== versionChecksum(version)) {
      catalogFailure("VERSION_CHECKSUM_INVALID", { versionId })
    }

    const product = productById.get(version.productId)
    if (!product) {
      catalogFailure("PRODUCT_MISSING", { versionId, productId: version.productId })
    }
    if (product.status !== "published") {
      catalogFailure("PRODUCT_NOT_PUBLISHED", {
        productId: product.id,
        status: product.status,
      })
    }
    if (product.currentVersionId !== version.id) {
      catalogFailure("PRODUCT_VERSION_MISMATCH", {
        productId: product.id,
        currentVersionId: product.currentVersionId,
        publicationVersionId: version.id,
      })
    }
    if (seenProducts.has(product.id)) {
      catalogFailure("PUBLICATION_MEMBERSHIP_INVALID", {
        publication: publication.version,
        productId: product.id,
        reason: "duplicate_product",
      })
    }
    seenProducts.add(product.id)
    if (version.effectiveAt > now) continue
    entries.push({ product, version })
  }

  if (entries.length === 0) {
    catalogFailure("NO_EFFECTIVE_PRODUCTS", { publication: publication.version })
  }

  const plans = entries
    .filter((entry) => entry.product.type === "subscription")
    .map((entry) => toSubscriptionPlan(entry.product, entry.version))
    .sort((a, b) => {
      const ai = PLAN_ORDER.indexOf(a.id)
      const bi = PLAN_ORDER.indexOf(b.id)
      if (ai !== bi) return (ai === -1 ? PLAN_ORDER.length : ai) - (bi === -1 ? PLAN_ORDER.length : bi)
      return a.id.localeCompare(b.id)
    })

  const packs = entries
    .filter((entry) => entry.product.type === "credit_pack")
    .map((entry) => toCreditPack(entry.product, entry.version))
    .sort((a, b) => a.priceUSD - b.priceUSD || a.id.localeCompare(b.id))

  const infrastructure = entries
    .filter((entry) => entry.product.type === "infrastructure")
    .map((entry) => toInfrastructure(entry.product, entry.version))
    .sort((a, b) => {
      const ai = ALL_PLAN_ORDER.indexOf(a.id as InfrastructurePlanId)
      const bi = ALL_PLAN_ORDER.indexOf(b.id as InfrastructurePlanId)
      if (ai !== bi) return (ai === -1 ? ALL_PLAN_ORDER.length : ai) - (bi === -1 ? ALL_PLAN_ORDER.length : bi)
      return a.id.localeCompare(b.id)
    })

  const differences = compareCatalogToCode({ plans, packs, infrastructure }, input.env)
  if (differences.length > 0) {
    logger.warn("billing.catalog.shadow", "published catalog differs from code catalog", {
      publication: publication.version,
      total: differences.length,
      differences: differences.slice(0, 20),
    })
  }

  return {
    source: "db",
    requestedSource,
    publicReadsEnabled,
    gated: false,
    publication,
    entries,
    plans,
    packs,
    infrastructure,
    shadow: { compared: true, differences },
  }
}

async function resolveDatabaseCatalog(
  store: CatalogSeedStore,
  now: number,
  requestedSource: CatalogSource,
  publicReadsEnabled: boolean,
  env: NodeJS.ProcessEnv,
): Promise<ResolvedCommercialCatalog> {
  const [publications, products, versions] = await Promise.all([
    store.listCatalogVersions(),
    store.listProducts(),
    store.listVersions(),
  ])

  const active = publications.filter((publication) => publication.status === "active")
  if (active.length === 0) {
    catalogFailure("NO_ACTIVE_PUBLICATION")
  }
  if (active.length > 1) {
    catalogFailure("MULTIPLE_ACTIVE_PUBLICATIONS", { count: active.length })
  }

  return resolvePublicationCatalog({
    publication: active[0],
    products,
    versions,
    now,
    requestedSource,
    publicReadsEnabled,
    env,
  })
}

function diff(
  differences: CatalogDifference[],
  path: string,
  expected: unknown,
  actual: unknown,
): void {
  if (Object.is(expected, actual)) return
  differences.push({ path, expected, actual })
}

/**
 * Measures database-vs-code drift without changing what a customer receives.
 * The caller owns the customer output; this function only returns differences.
 */
export function compareCatalogToCode(
  input: {
    plans: readonly SubscriptionPlan[]
    packs: readonly PermanentCreditPack[]
    infrastructure: readonly PublishedInfrastructureProduct[]
  },
  env: NodeJS.ProcessEnv = process.env,
): CatalogDifference[] {
  const differences: CatalogDifference[] = []
  const codePlans = getCommercialPlans(env)

  for (const code of codePlans) {
    const plan = input.plans.find((candidate) => candidate.id === code.id)
    if (!plan) {
      diff(differences, `plans.${code.id}`, "present", "missing")
      continue
    }
    diff(differences, `plans.${code.id}.name`, code.name, plan.name)
    diff(differences, `plans.${code.id}.tagline`, code.tagline, plan.tagline)
    diff(differences, `plans.${code.id}.priceMinor`, usdToMinor(code.priceUSD), usdToMinor(plan.priceUSD))
    diff(
      differences,
      `plans.${code.id}.annualPriceMinor`,
      usdToMinor(code.annualPriceUSD),
      usdToMinor(plan.annualPriceUSD),
    )
    diff(differences, `plans.${code.id}.mirrorCredits`, code.mirrorCredits, plan.mirrorCredits)
    diff(differences, `plans.${code.id}.custom`, Boolean(code.custom), Boolean(plan.custom))
    diff(differences, `plans.${code.id}.dodoProductId`, code.dodoProductId ?? null, plan.dodoProductId ?? null)
    diff(
      differences,
      `plans.${code.id}.annualDodoProductId`,
      code.annualDodoProductId ?? null,
      plan.annualDodoProductId ?? null,
    )
    diff(differences, `plans.${code.id}.purchaseState`, code.purchaseState, plan.purchaseState)
    diff(
      differences,
      `plans.${code.id}.annualPurchaseState`,
      code.annualPurchaseState,
      plan.annualPurchaseState,
    )
  }
  for (const plan of input.plans) {
    if (!codePlans.some((code) => code.id === plan.id)) {
      diff(differences, `plans.${plan.id}`, "missing", "present")
    }
  }

  const codePacks = getPermanentCreditPacks(env)
  for (const code of codePacks) {
    const pack = input.packs.find((candidate) => candidate.id === code.id)
    if (!pack) {
      diff(differences, `packs.${code.id}`, "present", "missing")
      continue
    }
    diff(differences, `packs.${code.id}.label`, code.label, pack.label)
    diff(differences, `packs.${code.id}.credits`, code.credits, pack.credits)
    diff(differences, `packs.${code.id}.priceMinor`, usdToMinor(code.priceUSD), usdToMinor(pack.priceUSD))
    diff(differences, `packs.${code.id}.popular`, Boolean(code.popular), Boolean(pack.popular))
    diff(differences, `packs.${code.id}.dodoProductId`, code.dodoProductId ?? null, pack.dodoProductId ?? null)
  }
  for (const pack of input.packs) {
    if (!codePacks.some((code) => code.id === pack.id)) {
      diff(differences, `packs.${pack.id}`, "missing", "present")
    }
  }

  const codeInfra = codeInfrastructure()
  for (const code of codeInfra) {
    const item = input.infrastructure.find((candidate) => candidate.id === code.id)
    if (!item) {
      diff(differences, `infrastructure.${code.id}`, "present", "missing")
      continue
    }
    diff(differences, `infrastructure.${code.id}.name`, code.name, item.name)
    diff(differences, `infrastructure.${code.id}.storageLabel`, code.storageLabel, item.storageLabel)
    diff(differences, `infrastructure.${code.id}.storageBytes`, code.storageBytes, item.storageBytes)
    diff(
      differences,
      `infrastructure.${code.id}.totalumInfrastructureCredits`,
      code.totalumInfrastructureCredits,
      item.totalumInfrastructureCredits,
    )
    diff(differences, `infrastructure.${code.id}.creditCharge`, code.creditCharge, item.creditCharge)
  }
  for (const item of input.infrastructure) {
    if (!codeInfra.some((code) => code.id === item.id)) {
      diff(differences, `infrastructure.${item.id}`, "missing", "present")
    }
  }

  return differences
}

/**
 * Public DB reads are only safe while checkout still reads code constants.
 * Every advertised database product must therefore exist in the code checkout
 * catalog with the same price and credit grant. A DB-only product or a changed
 * price fails closed; it is never displayed and then charged differently.
 */
export function assertCheckoutCompatible(
  input: {
    plans: readonly SubscriptionPlan[]
    packs: readonly PermanentCreditPack[]
    infrastructure: readonly PublishedInfrastructureProduct[]
  },
  env: NodeJS.ProcessEnv = process.env,
): void {
  const codePlans = getCommercialPlans(env)
  for (const code of codePlans) {
    if (!input.plans.some((plan) => plan.id === code.id)) {
      catalogFailure("CHECKOUT_INCOMPATIBLE", {
        productId: code.id,
        reason: "missing_from_publication",
      })
    }
  }
  for (const plan of input.plans) {
    const code = codePlans.find((candidate) => candidate.id === plan.id)
    if (!code) {
      catalogFailure("CHECKOUT_INCOMPATIBLE", { productId: plan.id, reason: "not_in_checkout" })
    }
    if (usdToMinor(plan.priceUSD) !== usdToMinor(code.priceUSD)) {
      catalogFailure("CHECKOUT_INCOMPATIBLE", { productId: plan.id, field: "priceMinor" })
    }
    if (usdToMinor(plan.annualPriceUSD) !== usdToMinor(code.annualPriceUSD)) {
      catalogFailure("CHECKOUT_INCOMPATIBLE", { productId: plan.id, field: "annualPriceMinor" })
    }
    if (plan.mirrorCredits !== code.mirrorCredits) {
      catalogFailure("CHECKOUT_INCOMPATIBLE", { productId: plan.id, field: "mirrorCredits" })
    }
    if ((plan.dodoProductId ?? null) !== (code.dodoProductId ?? null)) {
      catalogFailure("CHECKOUT_INCOMPATIBLE", { productId: plan.id, field: "dodoProductId" })
    }
    if ((plan.annualDodoProductId ?? null) !== (code.annualDodoProductId ?? null)) {
      catalogFailure("CHECKOUT_INCOMPATIBLE", {
        productId: plan.id,
        field: "annualDodoProductId",
      })
    }
    if (Boolean(plan.custom) !== Boolean(code.custom)) {
      catalogFailure("CHECKOUT_INCOMPATIBLE", { productId: plan.id, field: "custom" })
    }
    if (plan.purchaseState !== code.purchaseState) {
      catalogFailure("CHECKOUT_INCOMPATIBLE", { productId: plan.id, field: "purchaseState" })
    }
    if (plan.annualPurchaseState !== code.annualPurchaseState) {
      catalogFailure("CHECKOUT_INCOMPATIBLE", {
        productId: plan.id,
        field: "annualPurchaseState",
      })
    }
  }

  const codePacks = getPermanentCreditPacks(env)
  for (const code of codePacks) {
    if (!input.packs.some((pack) => pack.id === code.id)) {
      catalogFailure("CHECKOUT_INCOMPATIBLE", {
        productId: code.id,
        reason: "missing_from_publication",
      })
    }
  }
  for (const pack of input.packs) {
    const code = codePacks.find((candidate) => candidate.id === pack.id)
    if (!code) {
      catalogFailure("CHECKOUT_INCOMPATIBLE", { productId: pack.id, reason: "not_in_checkout" })
    }
    if (usdToMinor(pack.priceUSD) !== usdToMinor(code.priceUSD)) {
      catalogFailure("CHECKOUT_INCOMPATIBLE", { productId: pack.id, field: "priceMinor" })
    }
    if (pack.credits !== code.credits) {
      catalogFailure("CHECKOUT_INCOMPATIBLE", { productId: pack.id, field: "credits" })
    }
    if ((pack.dodoProductId ?? null) !== (code.dodoProductId ?? null)) {
      catalogFailure("CHECKOUT_INCOMPATIBLE", { productId: pack.id, field: "dodoProductId" })
    }
  }

  const codeInfra = codeInfrastructure()
  for (const code of codeInfra) {
    if (!input.infrastructure.some((item) => item.id === code.id)) {
      catalogFailure("CHECKOUT_INCOMPATIBLE", {
        productId: code.id,
        reason: "missing_from_publication",
      })
    }
  }
  for (const item of input.infrastructure) {
    const code = codeInfra.find((candidate) => candidate.id === item.id)
    if (!code) {
      catalogFailure("CHECKOUT_INCOMPATIBLE", { productId: item.id, reason: "not_in_checkout" })
    }
    if (item.creditCharge !== code.creditCharge) {
      catalogFailure("CHECKOUT_INCOMPATIBLE", { productId: item.id, field: "creditCharge" })
    }
    if (item.purchaseModel !== code.purchaseModel) {
      catalogFailure("CHECKOUT_INCOMPATIBLE", { productId: item.id, field: "purchaseModel" })
    }
    if (item.durationDays !== code.durationDays) {
      catalogFailure("CHECKOUT_INCOMPATIBLE", { productId: item.id, field: "durationDays" })
    }
    if (item.renewal !== code.renewal) {
      catalogFailure("CHECKOUT_INCOMPATIBLE", { productId: item.id, field: "renewal" })
    }
  }
}

export async function resolveCommercialCatalog(
  options: ResolveCatalogOptions = {},
): Promise<ResolvedCommercialCatalog> {
  const env = options.env ?? process.env
  const now = options.now ?? Date.now()
  const requestedSource = getCatalogSource(env)
  const audience = options.audience ?? "internal"
  const publicReadsEnabled = isCatalogDbPublicReadEnabled(env)

  if (requestedSource === "code") {
    return resolveCodeCatalog(now, env)
  }

  if (audience === "public" && !publicReadsEnabled) {
    if (!publicGateNoticeLogged) {
      publicGateNoticeLogged = true
      logger.info(
        "billing.catalog.public_reads",
        "database catalog selected but public reads are gated to the code catalog",
        { source: requestedSource, gate: "CATALOG_DB_PUBLIC_READS" },
      )
    }
    return {
      ...resolveCodeCatalog(now, env),
      requestedSource,
      publicReadsEnabled: false,
      gated: true,
    }
  }

  try {
    const store = options.store ?? (await mongoCatalogSeedStore())
    const resolved = await resolveDatabaseCatalog(
      store,
      now,
      requestedSource,
      publicReadsEnabled,
      env,
    )
    if (audience === "public") assertCheckoutCompatible(resolved, env)
    return resolved
  } catch (error) {
    if (error instanceof PublishedCatalogError) throw error
    logger.error("billing.catalog.resolve", "database catalog unavailable", {
      source: requestedSource,
      message: error instanceof Error ? error.message : String(error),
    })
    throw new PublishedCatalogError("DB_UNAVAILABLE", { source: requestedSource })
  }
}

/** Customer-facing entry point. Requires the explicit A7.1 rollout gate. */
export async function resolvePublicCommercialCatalog(
  options: Omit<ResolveCatalogOptions, "audience"> = {},
): Promise<ResolvedCommercialCatalog> {
  return resolveCommercialCatalog({ ...options, audience: "public" })
}

/**
 * Historical lookup by product/version. It deliberately bypasses publication
 * membership so archived legacy products can still resolve the terms a
 * customer purchased. It never makes those products sellable.
 */
export async function resolveHistoricalCatalogEntry(input: {
  productId: string
  versionId?: string
  env?: NodeJS.ProcessEnv
  now?: number
  store?: CatalogSeedStore
}): Promise<PublishedCatalogEntry | null> {
  const env = input.env ?? process.env
  const now = input.now ?? Date.now()

  if (!input.store && getCatalogSource(env) === "code") {
    const snapshot = buildCodeCatalogSnapshot({ now, env })
    const product = snapshot.products.find((candidate) => candidate.id === input.productId)
    if (!product) return null
    const version = input.versionId
      ? snapshot.versions.find((candidate) => candidate.id === input.versionId && candidate.productId === product.id)
      : snapshot.versions
          .filter((candidate) => candidate.productId === product.id)
          .sort((a, b) => b.version - a.version)[0]
    return version ? { product, version } : null
  }

  try {
    const store = input.store ?? (await mongoCatalogSeedStore())
    const [products, versions] = await Promise.all([store.listProducts(), store.listVersions()])
    const product = products.find((candidate) => candidate.id === input.productId)
    if (!product) return null
    const version = input.versionId
      ? versions.find((candidate) => candidate.id === input.versionId && candidate.productId === product.id)
      : versions
          .filter((candidate) => candidate.productId === product.id)
          .sort((a, b) => b.version - a.version)[0]
    if (!version) return null
    if (version.checksum !== versionChecksum(version)) {
      catalogFailure("VERSION_CHECKSUM_INVALID", {
        productId: input.productId,
        versionId: version.id,
      })
    }
    return { product, version }
  } catch (error) {
    logger.error("billing.catalog.historical", "historical catalog lookup failed", {
      message: error instanceof Error ? error.message : String(error),
    })
    throw new PublishedCatalogError("DB_UNAVAILABLE", { productId: input.productId })
  }
}
