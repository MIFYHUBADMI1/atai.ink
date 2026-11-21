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
import { timingSafeEqual, createHash } from "node:crypto"
import { ObjectId } from "mongodb"
import { businessDomainsCol } from "@/lib/db/collections"
import { cryptoId, store } from "@/lib/store/store"
import { generateToken } from "@/lib/auth/crypto"
import { checkRateLimit } from "@/lib/auth/rate-limit"
import { logger } from "@/lib/logging/logger"
import { DomainInputError, assertSiteUrl, normalizeHostname, registrableDomainOf } from "./host"
import { DomainFetchError, safeFetchDocument } from "./secure-fetch"
import { buildMetaTagSnippet, diagnoseVerificationMeta } from "./html-meta"
import type { BusinessDomainDoc, BusinessDomainMethod, BusinessDomainStatus } from "@/lib/types/business-intake"

export const DOMAIN_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000
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

function tokensEqual(candidateToken: string, expectedHash: string): boolean {
  const candidate = hashDomainToken(candidateToken)
  const expected = expectedHash
  if (candidate.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(expected, "hex"))
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
    token: includeToken ? (doc.token as string) : null,
    metaSnippet: includeToken ? buildMetaTagSnippet(doc.token as string) : null,
    fileName: includeToken ? doc.fileName ?? null : null,
    tokenExpiresAt: doc.tokenExpiresAt ?? null,
    attempts: doc.attempts ?? 0,
    lastAttemptAt: doc.lastAttemptAt ?? null,
    lastCheckedAt: doc.lastCheckedAt ?? null,
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

  const existing = await col.findOne({ hostname: target.hostname, projectId: input.projectId })
  if (existing) {
    return { doc: existing as BusinessDomainDoc, created: false }
  }

  const holder = await col.findOne({ hostname: target.hostname, releasedAt: { $exists: false } })
  if (holder) {
    // Never reveal who owns it, or that a business by that name exists.
    throw new DomainServiceError(
      "DOMAIN_TAKEN",
      "That domain is already associated with another Atai business. Contact support if you believe this is a mistake.",
      409,
    )
  }

  const token = generateToken()
  const method: BusinessDomainMethod = input.method === "html_file" ? "html_file" : "meta_tag"
  const doc: BusinessDomainDoc & { _id: ObjectId } = {
    _id: new ObjectId(),
    id: cryptoId(),
    projectId: input.projectId,
    userId: input.userId,
    hostname: target.hostname,
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
    attempts: 0,
    history: [{ status: "pending" as BusinessDomainStatus, at: now, detail: "challenge created" }],
    createdAt: now,
    updatedAt: now,
  }

  try {
    await col.insertOne(doc)
  } catch (error) {
    // The unique hostname index is the authority on conflicts; a race lands
    // here rather than in the pre-check above.
    if (isDuplicateKeyError(error)) {
      throw new DomainServiceError(
        "DOMAIN_TAKEN",
        "That domain is already associated with another Atai business. Contact support if you believe this is a mistake.",
        409,
      )
    }
    throw error
  }
  logger.info("domain.register", "hostname claimed", { projectId: input.projectId, hostname: target.hostname })
  return { doc, created: true }
}

function isDuplicateKeyError(error: unknown): boolean {
  const code = (error as { code?: number })?.code
  return code === 11000 || String((error as Error)?.message ?? "").includes("E11000")
}

export async function listProjectDomains(projectId: string): Promise<BusinessDomainDoc[]> {
  const col = await businessDomainsCol()
  return (await col.find({ projectId }).sort({ createdAt: -1 }).toArray()) as BusinessDomainDoc[]
}

export async function getOwnedDomain(input: { userId: string; projectId: string; domainId: string }): Promise<BusinessDomainDoc> {
  const col = await businessDomainsCol()
  const doc = await col.findOne({ id: input.domainId })
  if (!doc || doc.projectId !== input.projectId || doc.userId !== input.userId) {
    // Uniform not-found: never confirm that the id exists under someone else.
    throw new DomainServiceError("DOMAIN_NOT_FOUND", "We couldn't find that domain.", 404)
  }
  return doc as BusinessDomainDoc
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
    token,
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
  return { ...doc, ...next, history: pushHistory(doc, "pending", "challenge regenerated") } as BusinessDomainDoc
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

  // Abuse limits: per user, per domain, plus a cooldown between attempts.
  await checkRateLimit({ action: "domain_verify_user", identifier: input.userId, limit: 20, windowMs: 60 * 60 * 1000 })
  await checkRateLimit({ action: "domain_verify_domain", identifier: doc.id, limit: 10, windowMs: 30 * 60 * 1000 })

  const method = doc.method ?? "meta_tag"
  await col.updateOne({ id: doc.id }, { $set: { status: "in_progress", attempts: (doc.attempts ?? 0) + 1, lastAttemptAt: now, updatedAt: now } })

  let outcome: { ok: boolean; code?: string; message?: string }
  try {
    if (method === "html_file") {
      const path = `/${doc.fileName}`
      const page = await safeFetchDocument(
        doc.submittedUrl,
        path,
        { allowHostnameChange: false, acceptContentTypes: ["text/html", "text/plain", "application/octet-stream"], ...input.limits },
      )
      const expected = fileContentForToken(doc.token)
      const got = page.body
      const found = got.trim() === expected.trim() || got.includes(expected.trim())
      outcome = found
        ? { ok: true }
        : got.trim().length === 0
          ? { ok: false, code: "FILE_MISSING", message: "We couldn't find your verification file at the expected website location. Make sure it is uploaded to your website's root directory." }
          : { ok: false, code: "TOKEN_MISMATCH", message: "The verification file was found, but its token did not match this verification request." }
    } else {
      const page = await safeFetchDocument(doc.submittedUrl, META_PATH, { acceptContentTypes: ["text/html"], ...input.limits })
      const diagnosis = diagnoseVerificationMeta(page.body, doc.token)
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
      // A released claim keeps no usable secret, not even a display copy.
      $unset: { tokenHash: "", token: "" },
      $push: historyPush("revoked", input.reason ?? "released by owner"),
    },
  )
  logger.info("domain.release", "claim released", { domainId: doc.id, hostname: doc.hostname })
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
      return "Your website redirected the verification file to a different domain. Keep the file on the exact domain you are verifying."
    case "DNS_NOT_FOUND":
    case "DNS_FAILED":
      return "We could not look up that website address. Check the spelling and try again."
    default:
      return "We could not reach that website. Please try again."
  }
}
