/**
 * Domain ownership verification service (Phase 1.5).
 *
 * Native only: no third-party verification API, no DNS provider access, no
 * hosting credentials. Atai proves "this founder put our token on this site"
 * and nothing more — it is NOT Google Search Console verification and the UI
 * must never imply that it is.
 *
 * Token model
 * -----------
 * A challenge token is 256 bits of `randomBytes` via the existing
 * `generateToken()` (never Math.random, never derived from ids or time).
 * Comparison is done on its SHA-256 hash with a constant-time equal, so the
 * stored `tokenHash` is the authoritative secret. The display copy is kept
 * because the founder must be able to come back after a page reload and still
 * see the tag to paste — it is served only from the session-authenticated,
 * ownership-gated domain endpoint and is never logged. See "Known
 * limitations" in the engineering report for the encryption-at-rest follow-up.
 */
import { createHash } from "node:crypto"
import { ObjectId, type ClientSession } from "mongodb"
import { businessDomainsCol } from "@/lib/db/collections"
import { cryptoId, store } from "@/lib/store/store"
import { generateToken } from "@/lib/auth/crypto"
import { checkRateLimit } from "@/lib/auth/rate-limit"
import { logger } from "@/lib/logging/logger"
import { decryptDomainToken, encryptDomainToken } from "@/lib/domain/token-cipher"
import { DomainInputError, assertSiteUrl, canonicalBusinessHost, normalizeHostname, registrableDomainOf } from "./host"
import {
  BUSINESS_ALREADY_CONNECTED_MESSAGE,
  BUSINESS_ALREADY_CONNECTED_MESSAGE_SAME_ACCOUNT,
  type BusinessClaimState,
} from "./claim-copy"
import { DomainFetchError, safeFetchDocument } from "./secure-fetch"
import { buildMetaTagSnippet, diagnoseVerificationMeta } from "./html-meta"
import type { BusinessDomainDoc, BusinessDomainMethod, BusinessDomainStatus } from "@/lib/types/business-intake"

export const DOMAIN_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** How long an unverified claim keeps a business out of other accounts' reach.
 * Anti-squatting: reserve, then prove it. A verified claim never expires. */
export const CLAIM_RESERVATION_TTL_MS = 72 * 60 * 60 * 1000

export {
  BUSINESS_ALREADY_CONNECTED_MESSAGE,
  BUSINESS_ALREADY_CONNECTED_MESSAGE_SAME_ACCOUNT,
  type BusinessClaimState,
} from "./claim-copy"
export const MAX_DOMAIN_HISTORY = 20
/** Consecutive failed checks on an already-verified domain before we stop
 * calling it verified. The first failure only raises an attention flag — a
 * transient outage must not cost the founder their ownership record. */
export const REVERIFICATION_FAILURE_GRACE = 3

const META_PATH = "/"
const FILE_CONTENT_PREFIX = "atai-verification="

export class DomainServiceError extends Error {
  code: string
  status: number
  constructor(code: string, message: string, status = 400) {
    super(message)
    this.name = "DomainServiceError"
    this.code = code
    this.status = status
  }
}

export function hashDomainToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

/** Filename is derived from the token so every challenge is unique, and it is
 * fixed at generation time so a founder cannot be talked into fetching an
 * arbitrary path. */
export function fileNameForToken(token: string): string {
  return `atai-verification-${token}.html`
}

export function fileContentForToken(token: string): string {
  return `${FILE_CONTENT_PREFIX}${token}\n`
}

function pushHistory(doc: Pick<BusinessDomainDoc, "history">, status: BusinessDomainStatus, detail?: string) {
  const entry = { status, at: Date.now(), ...(detail ? { detail } : {}) }
  return [entry, ...(doc.history ?? [])].slice(0, MAX_DOMAIN_HISTORY)
}

export interface DomainView {
  id: string
  hostname: string
  registrableDomain: string
  submittedUrl: string
  status: BusinessDomainStatus
  method: BusinessDomainMethod | null
  /** Owner-only display copy. Never appears in logs or public responses. */
  token: string | null
  metaSnippet: string | null
  fileName: string | null
  tokenExpiresAt: number | null
  attempts: number
  lastAttemptAt: number | null
  /** When a check actually ran, successful or not. Null until the first check. */
  lastCheckedAt: number | null
  /** Deadline on an unverified claim, so the profile can show the clock. Null
   * once verified — a proven business does not expire. */
  claimExpiresAt: number | null
  verifiedAt: number | null
  verifiedMethod: BusinessDomainMethod | null
  needsAttention: boolean
  lastFailure: { code: string; message: string; at: number } | null
  history: BusinessDomainDoc["history"]
  createdAt: number
  updatedAt: number
}

export function toDomainView(doc: BusinessDomainDoc, opts: { includeToken?: boolean } = {}): DomainView {
  const expired = doc.status === "pending" && doc.tokenExpiresAt !== undefined && doc.tokenExpiresAt < Date.now()
  const status: BusinessDomainStatus = expired ? "expired" : doc.status
  const includeToken = opts.includeToken === true && Boolean(doc.token)
  return {
    id: doc.id,
    hostname: doc.hostname,
    registrableDomain: doc.registrableDomain,
    submittedUrl: doc.submittedUrl,
    status,
    method: doc.method ?? null,
    token: includeToken ? decryptDomainToken(doc.token as string) : null,
    metaSnippet: includeToken ? buildMetaTagSnippet(decryptDomainToken(doc.token as string)) : null,
    fileName: includeToken ? doc.fileName ?? null : null,
    tokenExpiresAt: doc.tokenExpiresAt ?? null,
    attempts: doc.attempts ?? 0,
    lastAttemptAt: doc.lastAttemptAt ?? null,
    lastCheckedAt: doc.lastCheckedAt ?? null,
    claimExpiresAt: doc.verifiedAt !== undefined ? null : doc.claimExpiresAt ?? null,
    verifiedAt: doc.verifiedAt ?? null,
    verifiedMethod: doc.verifiedMethod ?? null,
    needsAttention: Boolean(doc.lastFailure) && (doc.status === "verified" || doc.status === "failed"),
    lastFailure: doc.lastFailure ?? null,
    history: doc.history ?? [],
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}

/**
 * Claim a hostname for a business and open a verification challenge.
 * Idempotent per (project, hostname): re-submitting the same address returns
 * the existing record (and its existing token) instead of minting a new
 * challenge or a second row.
 */
export async function registerDomain(input: {
  userId: string
  projectId: string
  rawUrl: string
  method?: BusinessDomainMethod
}): Promise<{ doc: BusinessDomainDoc; created: boolean }> {
  let target
  try {
    target = assertSiteUrl(input.rawUrl)
  } catch (error) {
    // A bad address is a validation answer, not a server fault.
    const code = error instanceof DomainInputError ? error.code : "DOMAIN_INVALID"
    const message = error instanceof DomainInputError ? error.message : "That does not look like a website address."
    throw new DomainServiceError(code, message, 422)
  }
  const col = await businessDomainsCol()
  const now = Date.now()
  const canonicalHostname = canonicalBusinessHost(target.hostname)
  await expireStaleClaims(canonicalHostname, now)

  // A reservation made at creation time becomes a challenge here, so a founder
  // who never opened the domain step still gets a token when they do.
  const existing = (await col.findOne({
    projectId: input.projectId,
    hostname: target.hostname,
    releasedAt: { $exists: false },
  })) as BusinessDomainDoc | null
  if (existing) {
    return { doc: await ensureChallenge(existing, canonicalHostname, now), created: false }
  }

  // The canonical host decides "same business" — apex and `www` are one claim.
  const holder = await findActiveClaim(canonicalHostname, now)
  if (holder && holder.projectId !== input.projectId) {
    if (holder.userId === input.userId) {
      throw new DomainServiceError("BUSINESS_ALREADY_CONNECTED", BUSINESS_ALREADY_CONNECTED_MESSAGE_SAME_ACCOUNT, 409)
    }
    // Exact-host conflicts keep the historical code; an alias conflict is the
    // canonical case. Both are the same refusal to the founder.
    if (holder.hostname === target.hostname) {
      throw new DomainServiceError(
        "DOMAIN_TAKEN",
        "That domain is already associated with another Atai business. Contact support if you believe this is a mistake.",
        409,
      )
    }
    throw new DomainServiceError("BUSINESS_ALREADY_CONNECTED", BUSINESS_ALREADY_CONNECTED_MESSAGE, 409)
  }

  const token = generateToken()
  const method: BusinessDomainMethod = input.method === "html_file" ? "html_file" : "meta_tag"
  const doc: BusinessDomainDoc & { _id: ObjectId } = {
    _id: new ObjectId(),
    id: cryptoId(),
    projectId: input.projectId,
    userId: input.userId,
    hostname: target.hostname,
    canonicalHostname,
    // Same project, second exact host: an alias of the same business.
    ...(holder ? { aliasOf: holder.id } : {}),
    registrableDomain: registrableDomainOf(target.hostname),
    submittedUrl: target.homepageUrl,
    status: "pending",
    method,
    token,
    tokenHash: hashDomainToken(token),
    fileName: fileNameForToken(token),
    tokenGeneration: 1,
    tokenCreatedAt: now,
    tokenExpiresAt: now + DOMAIN_TOKEN_TTL_MS,
    claimExpiresAt: now + CLAIM_RESERVATION_TTL_MS,
    attempts: 0,
    history: [{ status: "pending" as BusinessDomainStatus, at: now, detail: "challenge created" }],
    createdAt: now,
    updatedAt: now,
  }

  try {
    await col.insertOne({ ...doc, token: encryptDomainToken(token) })
  } catch (error) {
    // The unique indexes are the authority on conflicts; a race lands here
    // rather than in the pre-check above.
    if (isDuplicateKeyError(error)) {
      const own = (await col.findOne({
        projectId: input.projectId,
        hostname: target.hostname,
        releasedAt: { $exists: false },
      })) as BusinessDomainDoc | null
      if (own) return { doc: withPlainToken(own), created: false }
      const raced = await findActiveClaim(canonicalHostname, now)
      if (raced && raced.hostname === target.hostname) {
        throw new DomainServiceError(
          "DOMAIN_TAKEN",
          "That domain is already associated with another Atai business. Contact support if you believe this is a mistake.",
          409,
        )
      }
      throw new DomainServiceError("BUSINESS_ALREADY_CONNECTED", BUSINESS_ALREADY_CONNECTED_MESSAGE, 409)
    }
    throw error
  }
  logger.info("domain.register", "hostname claimed", {
    projectId: input.projectId,
    hostname: target.hostname,
    alias: Boolean(holder),
  })
  return { doc, created: true }
}

/** Mint (or restore) the verification challenge on an existing claim without
 * ever weakening a verified one. */
async function ensureChallenge(doc: BusinessDomainDoc, canonicalHostname: string, now: number): Promise<BusinessDomainDoc> {
  const col = await businessDomainsCol()
  const setCanonical = doc.canonicalHostname ? {} : { canonicalHostname }
  const hasUsableToken = Boolean(doc.token) && doc.status !== "expired"
  if (hasUsableToken) {
    if (Object.keys(setCanonical).length) {
      await col.updateOne({ id: doc.id }, { $set: { ...setCanonical, updatedAt: now } })
    }
    return withPlainToken({ ...doc, ...setCanonical } as BusinessDomainDoc)
  }
  const token = generateToken()
  const next = {
    ...setCanonical,
    token: encryptDomainToken(token),
    tokenHash: hashDomainToken(token),
    fileName: fileNameForToken(token),
    tokenGeneration: (doc.tokenGeneration ?? 1) + 1,
    tokenCreatedAt: now,
    tokenExpiresAt: now + DOMAIN_TOKEN_TTL_MS,
    status: (doc.verifiedAt ? doc.status : "pending") as BusinessDomainStatus,
    attempts: 0,
    claimExpiresAt: doc.claimExpiresAt ?? now + CLAIM_RESERVATION_TTL_MS,
    updatedAt: now,
  }
  await col.updateOne({ id: doc.id }, { $set: next, $push: historyPush("pending", "challenge created") })
  logger.info("domain.register", "challenge restored on an existing claim", { projectId: doc.projectId, hostname: doc.hostname })
  return { ...doc, ...next, token } as BusinessDomainDoc
}

function isDuplicateKeyError(error: unknown): boolean {
  const code = (error as { code?: number })?.code
  return code === 11000 || String((error as Error)?.message ?? "").includes("E11000")
}

// ── Business claims ─────────────────────────────────────────────────────────
// "One business belongs to one account." A claim is the `business_domains`
// record itself — there is no second registry. The exact hostname stays the
// verification target; the canonical host is only the uniqueness key.

/** Canonical host for anything a founder can type: a URL, an origin or a bare
 * host. Returns "" when the input cannot be understood as a website. */
export function canonicalHostFromInput(rawUrlOrHost: string): string {
  const value = (rawUrlOrHost ?? "").trim()
  if (!value) return ""
  try {
    return canonicalBusinessHost(assertSiteUrl(value).hostname)
  } catch {
    try {
      return canonicalBusinessHost(normalizeHostname(value))
    } catch {
      return ""
    }
  }
}

/**
 * An active claim blocks other accounts. Verified claims never expire; an
 * unverified reservation stops blocking after its window (anti-squatting), and
 * a record written before `claimExpiresAt` existed falls back to its challenge
 * expiry so nothing blocks forever.
 */
export function claimIsActive(doc: BusinessDomainDoc, now = Date.now()): boolean {
  if (doc.releasedAt !== undefined) return false
  if (doc.verifiedAt !== undefined) return true
  if (doc.claimExpiresAt !== undefined) return doc.claimExpiresAt > now
  if (doc.tokenExpiresAt !== undefined) return doc.tokenExpiresAt > now
  return true
}

/** The active claim for a canonical business host, if any. Never returns who
 * holds it to a caller outside the service — callers decide what to disclose. */
export async function findActiveClaim(canonicalHostname: string, now = Date.now()): Promise<BusinessDomainDoc | null> {
  if (!canonicalHostname) return null
  const col = await businessDomainsCol()
  const candidates = (await col
    .find({
      releasedAt: { $exists: false },
      hostname: { $in: [canonicalHostname, `www.${canonicalHostname}`] },
    })
    .sort({ createdAt: 1 })
    .toArray()) as BusinessDomainDoc[]
  const active = candidates.filter(
    (doc) => canonicalBusinessHost(doc.hostname) === canonicalHostname && claimIsActive(doc, now),
  )
  // A primary claim is the authority; an alias only matters if its primary is gone.
  return active.find((doc) => !doc.aliasOf) ?? active[0] ?? null
}

/**
 * Release reservations whose window passed without verification. The unique
 * index knows nothing about time, so an expired reservation would otherwise
 * keep occupying the business forever — exactly the squatting the window exists
 * to prevent. Verified claims are never touched.
 */
async function expireStaleClaims(canonicalHostname: string, now: number): Promise<void> {
  if (!canonicalHostname) return
  const col = await businessDomainsCol()
  const candidates = (await col
    .find({
      releasedAt: { $exists: false },
      hostname: { $in: [canonicalHostname, `www.${canonicalHostname}`] },
    })
    .toArray()) as BusinessDomainDoc[]
  for (const doc of candidates) {
    if (doc.verifiedAt !== undefined || claimIsActive(doc, now)) continue
    await col.updateOne(
      { id: doc.id },
      {
        $set: {
          status: "revoked" as BusinessDomainStatus,
          releasedAt: now,
          // Distinguishes "the window closed" from "the founder released it",
          // so the notice sweep never emails someone about their own action.
          expiredUnverified: true,
          updatedAt: now,
        },
        $unset: { token: "", tokenHash: "", claimExpiresAt: "" },
        $push: historyPush("revoked", "reservation expired without verification"),
      },
    )
    logger.info("business.claim", "expired reservation released", { projectId: doc.projectId, hostname: doc.hostname })
  }
}

export async function canonicalClaimFor(
  rawUrlOrHost: string,
  now = Date.now(),
): Promise<{ doc: BusinessDomainDoc; canonicalHostname: string } | null> {
  const canonicalHostname = canonicalHostFromInput(rawUrlOrHost)
  if (!canonicalHostname) return null
  const doc = await findActiveClaim(canonicalHostname, now)
  return doc ? { doc, canonicalHostname } : null
}

export type ReserveClaimResult =
  | { state: "reserved"; doc: BusinessDomainDoc; created: boolean; canonicalHostname: string }
  | { state: "reuse"; projectId: string }
  | { state: "refused"; code: string; message: string; status: number }

function claimDoc(input: {
  userId: string
  projectId: string
  target: { hostname: string; homepageUrl: string }
  canonicalHostname: string
  now: number
  aliasOf?: string
}): BusinessDomainDoc & { _id: ObjectId } {
  return {
    _id: new ObjectId(),
    id: cryptoId(),
    projectId: input.projectId,
    userId: input.userId,
    hostname: input.target.hostname,
    canonicalHostname: input.canonicalHostname,
    ...(input.aliasOf ? { aliasOf: input.aliasOf } : {}),
    registrableDomain: registrableDomainOf(input.target.hostname),
    submittedUrl: input.target.homepageUrl,
    // No token yet: this is a reservation, not a challenge. `registerDomain`
    // mints the challenge when the founder actually reaches verification.
    status: "pending",
    attempts: 0,
    claimExpiresAt: input.now + CLAIM_RESERVATION_TTL_MS,
    history: [
      {
        status: "pending" as BusinessDomainStatus,
        at: input.now,
        detail: input.aliasOf ? "reserved as an alias of the same business" : "business reserved",
      },
    ],
    createdAt: input.now,
    updatedAt: input.now,
  }
}

/**
 * Reserve a business for a project before anything is created or charged.
 *
 * - Already reserved by this project for this exact host → idempotent.
 * - Held by another project of the same account → `reuse`, so the founder lands
 *   on the business they already have instead of a second one.
 * - Held by another account → `refused`; nothing about the holder is returned.
 */
export async function reserveBusinessClaim(input: {
  userId: string
  projectId: string
  rawUrl: string
  now?: number
}): Promise<ReserveClaimResult> {
  const now = input.now ?? Date.now()
  let target
  try {
    target = assertSiteUrl(input.rawUrl)
  } catch (error) {
    const code = error instanceof DomainInputError ? error.code : "DOMAIN_INVALID"
    const message = error instanceof DomainInputError ? error.message : "That does not look like a website address."
    return { state: "refused", code, message, status: 422 }
  }
  const canonicalHostname = canonicalBusinessHost(target.hostname)
  const col = await businessDomainsCol()
  await expireStaleClaims(canonicalHostname, now)

  const mine = (await col.findOne({
    projectId: input.projectId,
    hostname: target.hostname,
    releasedAt: { $exists: false },
  })) as BusinessDomainDoc | null
  if (mine) {
    if (!mine.canonicalHostname) {
      await col.updateOne({ id: mine.id }, { $set: { canonicalHostname, updatedAt: now } })
    }
    return { state: "reserved", doc: { ...mine, canonicalHostname }, created: false, canonicalHostname }
  }

  const holder = await findActiveClaim(canonicalHostname, now)
  if (holder && holder.projectId !== input.projectId) {
    if (holder.userId === input.userId) return { state: "reuse", projectId: holder.projectId }
    logger.info("business.claim", "refused", { projectId: input.projectId, userId: input.userId, hostname: target.hostname, reason: "held_by_other" })
    return { state: "refused", code: "BUSINESS_ALREADY_CONNECTED", message: BUSINESS_ALREADY_CONNECTED_MESSAGE, status: 409 }
  }

  try {
    const doc = claimDoc({
      userId: input.userId,
      projectId: input.projectId,
      target,
      canonicalHostname,
      now,
      // Same project, second exact host (apex + www): an alias, never a second business.
      ...(holder ? { aliasOf: holder.id } : {}),
    })
    await col.insertOne(doc)
    logger.info("business.claim", "reserved", {
      projectId: input.projectId,
      userId: input.userId,
      hostname: target.hostname,
      alias: Boolean(holder),
    })
    return { state: "reserved", doc, created: true, canonicalHostname }
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error
    // The unique index settled the race. Read back who won.
    const own = (await col.findOne({
      projectId: input.projectId,
      hostname: target.hostname,
      releasedAt: { $exists: false },
    })) as BusinessDomainDoc | null
    if (own) return { state: "reserved", doc: own, created: false, canonicalHostname }
    const raced = await findActiveClaim(canonicalHostname, now)
    if (raced && raced.userId === input.userId) return { state: "reuse", projectId: raced.projectId }
    logger.info("business.claim", "refused", { projectId: input.projectId, userId: input.userId, hostname: target.hostname, reason: "race" })
    return { state: "refused", code: "BUSINESS_ALREADY_CONNECTED", message: BUSINESS_ALREADY_CONNECTED_MESSAGE, status: 409 }
  }
}

/** Founder-facing claim state for a website, with no disclosure of the holder. */
export async function claimStateFor(input: {
  userId: string
  projectId?: string
  rawUrl?: string
  now?: number
}): Promise<{ hostname?: string; state: BusinessClaimState }> {
  const canonicalHostname = canonicalHostFromInput(input.rawUrl ?? "")
  if (!canonicalHostname) return { state: "unclaimed" }
  const holder = await findActiveClaim(canonicalHostname, input.now ?? Date.now())
  if (!holder) return { hostname: canonicalHostname, state: "unclaimed" }
  if (holder.userId !== input.userId) return { hostname: canonicalHostname, state: "held_by_other" }
  return { hostname: canonicalHostname, state: "yours" }
}

/**
 * Release every claim a project holds. Used by project deletion (inside its
 * transaction) and by support tooling. Released records keep their audit trail
 * and stop participating in the unique index.
 */
export async function releaseProjectClaims(
  projectId: string,
  reason: string,
  options: { session?: ClientSession; now?: number } = {},
): Promise<number> {
  const col = await businessDomainsCol()
  const now = options.now ?? Date.now()
  const result = await col.updateMany(
    { projectId, releasedAt: { $exists: false } },
    {
      $set: { status: "revoked" as BusinessDomainStatus, releasedAt: now, updatedAt: now },
      $unset: { token: "", tokenHash: "", claimExpiresAt: "" },
      $push: historyPush("revoked", reason),
    },
    options.session ? { session: options.session } : {},
  )
  const released = result.modifiedCount ?? 0
  if (released > 0) {
    logger.info("business.claim", "released", { projectId, count: released, reason })
  }
  return released
}

export async function listProjectDomains(projectId: string): Promise<BusinessDomainDoc[]> {
  const col = await businessDomainsCol()
  const docs = (await col.find({ projectId }).sort({ createdAt: -1 }).toArray()) as BusinessDomainDoc[]
  return docs.map(withPlainToken)
}

export async function getOwnedDomain(input: { userId: string; projectId: string; domainId: string }): Promise<BusinessDomainDoc> {
  const col = await businessDomainsCol()
  const doc = await col.findOne({ id: input.domainId })
  if (!doc || doc.projectId !== input.projectId || doc.userId !== input.userId) {
    // Uniform not-found: never confirm that the id exists under someone else.
    throw new DomainServiceError("DOMAIN_NOT_FOUND", "We couldn't find that domain.", 404)
  }
  return withPlainToken(doc as BusinessDomainDoc)
}

/** Choose/switch the verification method without invalidating the challenge. */
export async function setDomainMethod(input: {
  userId: string
  projectId: string
  domainId: string
  method: BusinessDomainMethod
}): Promise<BusinessDomainDoc> {
  const doc = await getOwnedDomain(input)
  const col = await businessDomainsCol()
  await col.updateOne(
    { id: doc.id },
    { $set: { method: input.method, updatedAt: Date.now() } },
  )
  return { ...doc, method: input.method, updatedAt: Date.now() } as BusinessDomainDoc
}

/**
 * Replace the challenge. The previous token stops working immediately because
 * both the hash and the generation change, so a tag the founder already
 * pasted can never validate after a regeneration.
 */
export async function regenerateChallenge(input: {
  userId: string
  projectId: string
  domainId: string
  method?: BusinessDomainMethod
}): Promise<BusinessDomainDoc> {
  const doc = await getOwnedDomain(input)
  const token = generateToken()
  const now = Date.now()
  const method = input.method ?? doc.method ?? "meta_tag"
  const next: Partial<Omit<BusinessDomainDoc, "_id">> = {
    token: encryptDomainToken(token),
    tokenHash: hashDomainToken(token),
    fileName: fileNameForToken(token),
    tokenGeneration: (doc.tokenGeneration ?? 1) + 1,
    tokenCreatedAt: now,
    tokenExpiresAt: now + DOMAIN_TOKEN_TTL_MS,
    method,
    status: doc.verifiedAt ? doc.status : "pending",
    attempts: 0,
    lastFailure: null as unknown as BusinessDomainDoc["lastFailure"],
    updatedAt: now,
  }
  const col = await businessDomainsCol()
  await col.updateOne(
    { id: doc.id },
    { $set: stripUndefined(next), $push: historyPush("pending", "challenge regenerated") },
  )
  logger.info("domain.regenerate", "challenge replaced", { domainId: doc.id, hostname: doc.hostname })
  return { ...doc, ...next, token, history: pushHistory(doc, "pending", "challenge regenerated") } as BusinessDomainDoc
}

/** Storage holds the token encrypted; service callers work with plaintext.
 * `decryptDomainToken` is a no-op for legacy unencrypted rows. */
function withPlainToken(doc: BusinessDomainDoc): BusinessDomainDoc {
  return doc.token ? { ...doc, token: decryptDomainToken(doc.token) } : doc
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>
}

export interface VerifyOutcome {
  doc: BusinessDomainDoc
  view: DomainView
  /** Stable, founder-actionable code when verification did not succeed. */
  failure?: { code: string; message: string }
}

/**
 * Run one verification attempt. Both methods read exactly one document:
 * the homepage for the meta tag, the exact generated file for the file method.
 */
export async function verifyDomainOwnership(input: {
  userId: string
  projectId: string
  domainId: string
  /** true = a periodic/manual re-check of an already-verified domain. */
  reverification?: boolean
  /** Scheduled sweep: our own cron, not a founder request, so the per-user and
   * per-domain attempt limits (which exist to stop a person hammering a check)
   * do not apply. The batch size is the real bound. */
  internal?: boolean
  limits?: { maxBytes?: number; totalTimeoutMs?: number }
}): Promise<VerifyOutcome> {
  const doc = await getOwnedDomain(input)
  const col = await businessDomainsCol()
  const now = Date.now()

  if (doc.status === "revoked") {
    return finished(doc, input, { code: "REVOKED", message: "This verification was revoked. Add the domain again to start a new challenge." })
  }
  if (doc.tokenExpiresAt !== undefined && doc.tokenExpiresAt < now && !doc.verifiedAt) {
    await col.updateOne({ id: doc.id }, { $set: { status: "expired", updatedAt: now }, $push: historyPush("expired", "challenge expired") })
    const expired = { ...doc, status: "expired" as BusinessDomainStatus, history: pushHistory(doc, "expired", "challenge expired") }
    return finished(expired, input, { code: "EXPIRED", message: "This verification request has expired. Generate a new verification token to continue." })
  }
  if (!doc.token || !doc.tokenHash) {
    throw new DomainServiceError("CHALLENGE_MISSING", "This domain needs a new verification token before it can be checked.", 409)
  }
  const token = doc.token

  // Abuse limits: per user, per domain, plus a cooldown between attempts.
  if (!input.internal) {
    await checkRateLimit({ action: "domain_verify_user", identifier: input.userId, limit: 20, windowMs: 60 * 60 * 1000 })
    await checkRateLimit({ action: "domain_verify_domain", identifier: doc.id, limit: 10, windowMs: 30 * 60 * 1000 })
  }

  const method = doc.method ?? "meta_tag"
  await col.updateOne({ id: doc.id }, { $set: { status: "in_progress", attempts: (doc.attempts ?? 0) + 1, lastAttemptAt: now, updatedAt: now } })

  let outcome: { ok: boolean; code?: string; message?: string }
  try {
    if (method === "html_file") {
      const path = `/${doc.fileName}`
      const page = await safeFetchDocument(
        doc.submittedUrl,
        path,
        {
          allowHostnameChange: false,
          allowSameSiteRedirects: true,
          acceptContentTypes: ["text/html", "text/plain", "application/octet-stream"],
          ...input.limits,
        },
      )
      const expected = fileContentForToken(token)
      const got = page.body
      const found = got.trim() === expected.trim() || got.includes(expected.trim())
      outcome = found
        ? { ok: true }
        : got.trim().length === 0
          ? { ok: false, code: "FILE_MISSING", message: "We couldn't find your verification file at the expected website location. Make sure it is uploaded to your website's root directory." }
          : { ok: false, code: "TOKEN_MISMATCH", message: "The verification file was found, but its token did not match this verification request." }
    } else {
      // A tag served on the same site (apex↔www, a sibling subdomain) still
      // proves this business. A tag that only appears after a hop to another
      // site proves control of that site, not this one.
      const page = await safeFetchDocument(doc.submittedUrl, META_PATH, {
        acceptContentTypes: ["text/html"],
        allowHostnameChange: false,
        allowSameSiteRedirects: true,
        ...input.limits,
      })
      const diagnosis = diagnoseVerificationMeta(page.body, token)
      outcome =
        diagnosis === "match"
          ? { ok: true }
          : diagnosis === "missing"
            ? {
                ok: false,
                code: "META_MISSING",
                message: "We couldn't find the Atai verification tag on your homepage. Confirm that it is inside your website's head section and try again.",
              }
            : { ok: false, code: "TOKEN_MISMATCH", message: "The verification tag was found, but its token did not match this verification request." }
    }
  } catch (error) {
    if (error instanceof DomainFetchError) {
      outcome = { ok: false, code: error.code, message: fetchFailureMessage(error.code) }
    } else if (error instanceof DomainInputError) {
      outcome = { ok: false, code: error.code, message: error.message }
    } else {
      // Never surface the underlying error: it can carry an internal address.
      logger.warn("domain.verify", "unexpected verification failure", { domainId: doc.id, hostname: doc.hostname })
      outcome = { ok: false, code: "UNREACHABLE", message: "We could not reach that website. Please try again." }
    }
  }

  if (outcome.ok) {
    const next: BusinessDomainDoc = {
      ...doc,
      status: "verified",
      verifiedAt: now,
      verifiedMethod: method,
      lastFailure: null,
      failedChecks: 0,
      updatedAt: now,
      history: pushHistory(doc, "verified", `${method} verified`),
    }
    await col.updateOne(
      { id: doc.id },
      { $set: { status: "verified", verifiedAt: now, verifiedMethod: method, lastFailure: null, failedChecks: 0, lastCheckedAt: now, updatedAt: now }, $push: historyPush("verified", `${method} verified`) },
    )
    if (doc.needsAttention || doc.lastFailure) {
      await notifyOwner(input.projectId, `Ownership of ${doc.hostname} is confirmed again.`, "info")
    }
    logger.info("domain.verify", "verified", { domainId: doc.id, hostname: doc.hostname, method })
    return { doc: next, view: toDomainView(next, { includeToken: true }) }
  }

  // Failure on an already-verified domain: record it, raise attention, and
  // only drop the verified status after the grace limit. A failed re-check
  // must never hand the domain to another account.
  if (doc.verifiedAt) {
    const failedChecks = (doc.failedChecks ?? 0) + 1
    const giveUp = failedChecks >= REVERIFICATION_FAILURE_GRACE
    const status: BusinessDomainStatus = giveUp ? "expired" : "verified"
    const next: BusinessDomainDoc = {
      ...doc,
      status,
      failedChecks,
      needsAttention: true,
      lastFailure: { code: outcome.code ?? "FAILED", message: outcome.message ?? "Verification check failed.", at: now },
      lastCheckedAt: now,
      updatedAt: now,
      history: pushHistory(doc, status, `re-check failed: ${outcome.code ?? "FAILED"}`),
    }
    await col.updateOne(
      { id: doc.id },
      {
        $set: { status, failedChecks, needsAttention: true, lastFailure: next.lastFailure, lastCheckedAt: now, updatedAt: now },
        ...(giveUp ? { $unset: { verifiedAt: "" } } : {}),
        $push: historyPush(status, `re-check failed: ${outcome.code ?? "FAILED"}`),
      },
    )
    await notifyOwner(
      input.projectId,
      giveUp
        ? `Ownership of ${doc.hostname} could not be re-confirmed after ${REVERIFICATION_FAILURE_GRACE} checks, so its verification expired. Re-verify from the business profile to restore it.`
        : `The verification tag or file on ${doc.hostname} was not found on a re-check. Ownership still stands for now — restore it and re-check from the business profile.`,
    )
    if (!giveUp) return { doc: next, view: toDomainView(next, { includeToken: true }) }
    return finished(next, input, { code: outcome.code ?? "FAILED", message: outcome.message ?? "Verification failed." })
  }

  const next: BusinessDomainDoc = {
    ...doc,
    status: "failed",
    lastFailure: { code: outcome.code ?? "FAILED", message: outcome.message ?? "Verification failed.", at: now },
    lastCheckedAt: now,
    updatedAt: now,
    history: pushHistory(doc, "failed", outcome.code ?? "FAILED"),
  }
  await col.updateOne(
    { id: doc.id },
    { $set: { status: "failed", lastFailure: next.lastFailure, lastCheckedAt: now, updatedAt: now }, $push: historyPush("failed", outcome.code ?? "FAILED") },
  )
  return finished(next, input, { code: outcome.code ?? "FAILED", message: outcome.message ?? "Verification failed." })
}

/** Owner notification through the existing project activity feed. Best-effort:
 * a notification failure must never change the verification outcome. */
async function notifyOwner(projectId: string, message: string, level: "info" | "warn" = "warn") {
  try {
    await store.appendEvent(projectId, { id: cryptoId(), at: Date.now(), level, stage: "domain", message })
  } catch {
    logger.warn("domain.notify", "owner notification not recorded", { projectId })
  }
}

async function finished(doc: BusinessDomainDoc, input: { userId: string; projectId: string; domainId: string; reverification?: boolean }, failure?: { code: string; message: string }): Promise<VerifyOutcome> {
  const view = toDomainView(doc, { includeToken: true })
  if (failure) {
    logger.info("domain.verify", "verification failed", { domainId: doc.id, hostname: doc.hostname, code: failure.code, reverification: input.reverification === true })
  }
  return { doc, view, ...(failure ? { failure } : {}) }
}

/** Complete `$push` value for `history`: newest first, bounded. `$position: 0`
 * prepends so the positive `$slice` keeps the NEWEST entries, matching
 * `pushHistory`'s in-memory ordering. */
function historyPush(status: BusinessDomainStatus, detail: string) {
  return { history: { $each: [{ status, at: Date.now(), detail }], $position: 0, $slice: MAX_DOMAIN_HISTORY } }
}

/**
 * Release a claim. Only the owning business (or its owner) can do this, and a
 * released record keeps its `releasedAt` so the hostname becomes available
 * while the audit trail survives. Verification never transfers silently.
 */
export async function releaseDomain(input: { userId: string; projectId: string; domainId: string; reason?: string }): Promise<BusinessDomainDoc> {
  const doc = await getOwnedDomain(input)
  const col = await businessDomainsCol()
  const now = Date.now()
  const next: BusinessDomainDoc = {
    ...doc,
    status: "revoked",
    releasedAt: now,
    updatedAt: now,
    token: undefined,
    tokenHash: undefined,
    history: pushHistory(doc, "revoked", input.reason ?? "released by owner"),
  }
  await col.updateOne(
    { id: doc.id },
    {
      $set: { status: "revoked", releasedAt: now, updatedAt: now },
      // A released claim keeps no usable secret, not even a display copy — and
      // no reservation window, because the hostname is free again immediately.
      $unset: { tokenHash: "", token: "", claimExpiresAt: "" },
      $push: historyPush("revoked", input.reason ?? "released by owner"),
    },
  )
  logger.info("domain.release", "claim released", { domainId: doc.id, hostname: doc.hostname })
  // Releasing the last verified domain must drop a cached "connected" status.
  try {
    const { refreshConnectionStatus } = await import("@/lib/connected-business/service")
    await refreshConnectionStatus(input.projectId)
  } catch (error) {
    logger.warn("domain.release", "connection status not refreshed", {
      projectId: input.projectId,
      message: error instanceof Error ? error.message : String(error),
    })
  }
  return next
}

function fetchFailureMessage(code: string): string {
  switch (code) {
    case "UNSAFE_DESTINATION":
      return "We cannot verify this website address because it does not resolve to a publicly accessible web destination."
    case "TIMEOUT":
      return "Your website did not respond within the verification time limit. Please try again."
    case "NOT_FOUND":
      return "We couldn't find your verification file at the expected website location. Make sure it is uploaded to your website's root directory."
    case "RESPONSE_TOO_LARGE":
      return "That page is larger than verification can read. Use the verification file method instead."
    case "CONTENT_TYPE":
      return "Your website did not return a web page we could read at that address."
    case "REDIRECT_HOST":
      return "This address redirects to a different domain, so a token found there would not prove you own this one. Connect the address that actually serves the page."
    case "DNS_NOT_FOUND":
    case "DNS_FAILED":
      return "We could not look up that website address. Check the spelling and try again."
    default:
      return "We could not reach that website. Please try again."
  }
}
