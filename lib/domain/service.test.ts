import { randomUUID } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { BusinessDomainDoc } from "@/lib/types/business-intake"
import { canonicalBusinessHost } from "./host"

// The dev database is a shared remote cluster; these tests run against an
// in-memory collection that emulates the unique-hostname index and the
// $set/$unset/$push semantics the service actually uses.
type Doc = Record<string, unknown>

function makeCol() {
  const docs: Doc[] = []
  const matches = (doc: Doc, filter: Doc): boolean =>
    Object.entries(filter).every(([key, cond]) => {
      if (cond && typeof cond === "object" && "$exists" in (cond as Doc)) {
        return (cond as { $exists: boolean }).$exists ? doc[key] !== undefined : doc[key] === undefined
      }
      if (cond && typeof cond === "object" && "$in" in (cond as Doc)) {
        return (cond as { $in: unknown[] }).$in.includes(doc[key])
      }
      return doc[key] === cond
    })
  return {
    docs,
    async findOne(filter: Doc) {
      return docs.find((d) => matches(d, filter)) ?? null
    },
    async insertOne(doc: Doc) {
      const canonical = (d: Doc) =>
        (d.canonicalHostname as string | undefined) ?? canonicalBusinessHost(String(d.hostname))
      if (
        docs.some(
          (d) =>
            d.releasedAt === undefined &&
            (d.hostname === doc.hostname ||
              (!d.aliasOf && !doc.aliasOf && canonical(d) === canonical(doc))),
        )
      ) {
        throw Object.assign(new Error("E11000 duplicate key error"), { code: 11000 })
      }
      docs.push({ ...doc })
      return { insertedId: doc._id }
    },
    async updateOne(filter: Doc, update: Doc) {
      const doc = docs.find((d) => matches(d, filter))
      if (!doc) return { matchedCount: 0 }
      if (update.$set) Object.assign(doc, update.$set)
      if (update.$unset) for (const key of Object.keys(update.$unset as Doc)) delete doc[key]
      if (update.$push) {
        for (const [key, raw] of Object.entries(update.$push as Record<string, Doc>)) {
          const spec = raw as { $each?: unknown[]; $position?: number; $slice?: number }
          const arr = ((doc[key] as unknown[] | undefined) ?? []).slice()
          const items = spec.$each ?? [raw]
          arr.splice(spec.$position ?? arr.length, 0, ...items)
          doc[key] = typeof spec.$slice === "number"
            ? spec.$slice >= 0 ? arr.slice(0, spec.$slice) : arr.slice(spec.$slice)
            : arr
        }
      }
      return { matchedCount: 1 }
    },
    async updateMany(filter: Doc, update: Doc) {
      const hits = docs.filter((d) => matches(d, filter))
      for (const doc of hits) {
        if (update.$set) Object.assign(doc, update.$set)
        if (update.$unset) for (const key of Object.keys(update.$unset as Doc)) delete doc[key]
        if (update.$push) {
          for (const [key, raw] of Object.entries(update.$push as Record<string, Doc>)) {
            const spec = raw as { $each?: unknown[]; $position?: number; $slice?: number }
            const arr = ((doc[key] as unknown[] | undefined) ?? []).slice()
            arr.splice(spec.$position ?? arr.length, 0, ...(spec.$each ?? [raw]))
            doc[key] = typeof spec.$slice === "number" ? arr.slice(0, spec.$slice) : arr
          }
        }
      }
      return { matchedCount: hits.length, modifiedCount: hits.length }
    },
    find(filter: Doc) {
      const toArray = async () => docs.filter((d) => matches(d, filter))
      return { toArray, sort: () => ({ toArray }) }
    },
  }
}

const col = makeCol()

vi.mock("@/lib/db/collections", () => ({
  businessDomainsCol: vi.fn(async () => col),
}))
vi.mock("@/lib/store/store", () => ({
  cryptoId: () => randomUUID(),
  store: { appendEvent: vi.fn(async () => undefined) },
}))
vi.mock("@/lib/auth/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => undefined),
}))
vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock("@/lib/connected-business/service", () => ({
  refreshConnectionStatus: vi.fn(async () => "not_connected"),
}))
vi.mock("./secure-fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./secure-fetch")>()),
  safeFetchDocument: vi.fn(),
}))

import { checkRateLimit } from "@/lib/auth/rate-limit"
import { store } from "@/lib/store/store"
import { safeFetchDocument, DomainFetchError } from "./secure-fetch"
import {
  BUSINESS_ALREADY_CONNECTED_MESSAGE,
  CLAIM_RESERVATION_TTL_MS,
  DOMAIN_TOKEN_TTL_MS,
  MAX_DOMAIN_HISTORY,
  REVERIFICATION_FAILURE_GRACE,
  DomainServiceError,
  fileNameForToken,
  fileContentForToken,
  hashDomainToken,
  registerDomain,
  getOwnedDomain,
  setDomainMethod,
  regenerateChallenge,
  verifyDomainOwnership,
  releaseDomain,
  toDomainView,
  canonicalClaimFor,
  claimIsActive,
  claimStateFor,
  releaseProjectClaims,
  reserveBusinessClaim,
} from "./service"
import { refreshConnectionStatus } from "@/lib/connected-business/service"
import { buildMetaTagSnippet } from "./html-meta"

const fetchMock = vi.mocked(safeFetchDocument)
const rateMock = vi.mocked(checkRateLimit)

const OWNER = { userId: "user-1", projectId: "proj-1" }

function storedDoc(id: string): Doc {
  const doc = col.docs.find((d) => d.id === id)
  if (!doc) throw new Error("doc vanished from fake collection")
  return doc
}

async function register(url = "https://example.com", method?: "meta_tag" | "html_file") {
  const { doc } = await registerDomain({ ...OWNER, rawUrl: url, method })
  return doc
}

function metaPage(token: string) {
  return {
    status: 200,
    body: `<html><head>${buildMetaTagSnippet(token)}</head><body></body></html>`,
    contentType: "text/html",
    hostname: "example.com",
    redirects: 0,
  }
}

beforeEach(() => {
  col.docs.length = 0
  fetchMock.mockReset()
  rateMock.mockClear()
})

describe("token primitives", () => {
  it("hashDomainToken is a stable sha256 hex digest", () => {
    const hash = hashDomainToken("abc")
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hashDomainToken("abc")).toBe(hash)
    expect(hashDomainToken("abd")).not.toBe(hash)
  })

  it("file name and content are derived from the token", () => {
    expect(fileNameForToken("tok")).toBe("atai-verification-tok.html")
    expect(fileContentForToken("tok")).toBe("atai-verification=tok\n")
  })
})

describe("registerDomain", () => {
  it("creates a pending challenge with a 256-bit random token, hashed copy and 7-day expiry", async () => {
    const before = Date.now()
    const doc = await register()
    expect(doc.status).toBe("pending")
    expect(doc.token).toMatch(/^[A-Za-z0-9_-]{43}$/) // base64url of 32 bytes
    expect(doc.tokenHash).toBe(hashDomainToken(doc.token!))
    expect(doc.fileName).toBe(fileNameForToken(doc.token!))
    expect(doc.tokenExpiresAt).toBeGreaterThanOrEqual(before + DOMAIN_TOKEN_TTL_MS)
    expect(doc.tokenGeneration).toBe(1)
    expect(doc.registrableDomain).toBe("example.com")
    expect(doc.history?.[0]?.status).toBe("pending")
  })

  it("mints a distinct token for every challenge", async () => {
    const a = await register("https://one.com")
    const b = await register("https://two.com")
    expect(a.token).not.toBe(b.token)
  })

  it("is idempotent per (project, hostname): no second row, same token", async () => {
    const first = await register()
    const second = await registerDomain({ ...OWNER, rawUrl: "https://example.com/" })
    expect(second.created).toBe(false)
    expect(second.doc.id).toBe(first.id)
    expect(second.doc.token).toBe(first.token)
    expect(col.docs).toHaveLength(1)
  })

  it("refuses a hostname held by another business without disclosing the holder", async () => {
    await register()
    const promise = registerDomain({ userId: "user-2", projectId: "proj-2", rawUrl: "https://example.com" })
    await expect(promise).rejects.toMatchObject({ code: "DOMAIN_TAKEN", status: 409 })
    await expect(promise).rejects.not.toMatchObject({ message: expect.stringContaining("user-1") })
    await expect(promise).rejects.not.toMatchObject({ message: expect.stringContaining("proj-1") })
  })

  it("treats a unique-index race as DOMAIN_TAKEN, not a server fault", async () => {
    await register()
    const spy = vi.spyOn(col, "findOne").mockResolvedValue(null)
    try {
      await expect(
        registerDomain({ userId: "user-2", projectId: "proj-2", rawUrl: "https://example.com" }),
      ).rejects.toMatchObject({ code: "DOMAIN_TAKEN", status: 409 })
    } finally {
      spy.mockRestore()
    }
  })

  it("normalizes www and case to the same hostname claim", async () => {
    const first = await register("https://Example.com")
    const second = await registerDomain({ ...OWNER, rawUrl: "https://example.com" })
    expect(second.doc.id).toBe(first.id)
  })

  it("keeps subdomains distinct from the apex", async () => {
    await register("https://example.com")
    const sub = await registerDomain({ ...OWNER, rawUrl: "https://shop.example.com" })
    expect(sub.created).toBe(true)
    expect(sub.doc.hostname).toBe("shop.example.com")
  })

  it("rejects a malformed address as a 422 validation error", async () => {
    await expect(registerDomain({ ...OWNER, rawUrl: "ftp://example.com" })).rejects.toMatchObject({
      code: "DOMAIN_SCHEME",
      status: 422,
    })
  })
})

describe("toDomainView", () => {
  it("hides the token unless explicitly owner-gated", async () => {
    const doc = await register()
    const publicView = toDomainView(doc)
    expect(publicView.token).toBeNull()
    expect(publicView.metaSnippet).toBeNull()
    expect(publicView.fileName).toBeNull()
    const ownerView = toDomainView(doc, { includeToken: true })
    expect(ownerView.token).toBe(doc.token)
    expect(ownerView.metaSnippet).toBe(buildMetaTagSnippet(doc.token!))
  })

  it("reports an elapsed pending challenge as expired", async () => {
    const doc = await register()
    const view = toDomainView({ ...doc, tokenExpiresAt: Date.now() - 1 })
    expect(view.status).toBe("expired")
  })

  it("carries when the last check ran, so the page can say it", async () => {
    const doc = await register()
    expect(toDomainView(doc).lastCheckedAt).toBeNull()
    expect(toDomainView({ ...doc, lastCheckedAt: 1_700_000_000_000 }).lastCheckedAt).toBe(1_700_000_000_000)
  })
})

describe("ownership gate", () => {
  it("returns a uniform not-found for another user's domain", async () => {
    const doc = await register()
    await expect(
      getOwnedDomain({ userId: "user-2", projectId: "proj-1", domainId: doc.id }),
    ).rejects.toMatchObject({ code: "DOMAIN_NOT_FOUND", status: 404 })
    await expect(
      getOwnedDomain({ userId: "user-1", projectId: "proj-2", domainId: doc.id }),
    ).rejects.toMatchObject({ code: "DOMAIN_NOT_FOUND", status: 404 })
  })
})

describe("setDomainMethod / regenerateChallenge", () => {
  it("switches method without touching the challenge", async () => {
    const doc = await register()
    const next = await setDomainMethod({ ...OWNER, domainId: doc.id, method: "html_file" })
    expect(next.method).toBe("html_file")
    expect(next.token).toBe(doc.token)
    expect(storedDoc(doc.id).tokenHash).toBe(doc.tokenHash)
  })

  it("regeneration replaces the token and invalidates the previous one", async () => {
    const doc = await register()
    const oldToken = doc.token!
    const next = await regenerateChallenge({ ...OWNER, domainId: doc.id })
    expect(next.token).not.toBe(oldToken)
    expect(next.tokenGeneration).toBe(2)
    expect(next.tokenHash).toBe(hashDomainToken(next.token!))
    expect(storedDoc(doc.id).tokenHash).toBe(next.tokenHash)

    // The old tag no longer verifies.
    fetchMock.mockResolvedValue(metaPage(oldToken))
    const outcome = await verifyDomainOwnership({ ...OWNER, domainId: doc.id })
    expect(outcome.failure?.code).toBe("TOKEN_MISMATCH")
    expect(outcome.doc.status).toBe("failed")
  })
})

describe("verifyDomainOwnership — meta tag", () => {
  it("verifies when the exact token sits in a real meta element", async () => {
    const doc = await register()
    fetchMock.mockResolvedValue(metaPage(doc.token!))
    const outcome = await verifyDomainOwnership({ ...OWNER, domainId: doc.id })
    expect(outcome.failure).toBeUndefined()
    expect(outcome.doc.status).toBe("verified")
    expect(outcome.doc.verifiedMethod).toBe("meta_tag")
    expect(storedDoc(doc.id).status).toBe("verified")
    expect(storedDoc(doc.id).verifiedAt).toBeTypeOf("number")
    expect(fetchMock).toHaveBeenCalledWith(
      doc.submittedUrl,
      "/",
      expect.objectContaining({ acceptContentTypes: ["text/html"] }),
    )
    expect(rateMock).toHaveBeenCalledTimes(2)
  })

  it("reports META_MISSING when the homepage has no tag", async () => {
    const doc = await register()
    fetchMock.mockResolvedValue({ ...metaPage("x"), body: "<html><head></head></html>" })
    const outcome = await verifyDomainOwnership({ ...OWNER, domainId: doc.id })
    expect(outcome.failure?.code).toBe("META_MISSING")
    expect(outcome.doc.status).toBe("failed")
    expect(storedDoc(doc.id).status).toBe("failed")
  })

  it("reports TOKEN_MISMATCH for a tag with the wrong token", async () => {
    const doc = await register()
    fetchMock.mockResolvedValue(metaPage("someone-elses-token"))
    const outcome = await verifyDomainOwnership({ ...OWNER, domainId: doc.id })
    expect(outcome.failure?.code).toBe("TOKEN_MISMATCH")
  })

  it("never counts a token printed inside a script as verified", async () => {
    const doc = await register()
    fetchMock.mockResolvedValue({
      ...metaPage(doc.token!),
      body: `<html><head><script>var s = '${buildMetaTagSnippet(doc.token!)}'</script></head></html>`,
    })
    const outcome = await verifyDomainOwnership({ ...OWNER, domainId: doc.id })
    expect(outcome.failure?.code).toBe("META_MISSING")
  })

  it("refuses an expired challenge and persists the expired status", async () => {
    const doc = await register()
    storedDoc(doc.id).tokenExpiresAt = Date.now() - 1
    const outcome = await verifyDomainOwnership({ ...OWNER, domainId: doc.id })
    expect(outcome.failure?.code).toBe("EXPIRED")
    expect(storedDoc(doc.id).status).toBe("expired")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("refuses a revoked claim without fetching", async () => {
    const doc = await register()
    await releaseDomain({ ...OWNER, domainId: doc.id })
    const outcome = await verifyDomainOwnership({ ...OWNER, domainId: doc.id })
    expect(outcome.failure?.code).toBe("REVOKED")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("maps fetch failures to friendly codes without internals", async () => {
    const doc = await register()
    fetchMock.mockRejectedValue(new DomainFetchError("NOT_FOUND", "raw internal detail 10.0.0.9"))
    const outcome = await verifyDomainOwnership({ ...OWNER, domainId: doc.id })
    expect(outcome.failure?.code).toBe("NOT_FOUND")
    expect(outcome.failure?.message).not.toContain("10.0.0.9")
  })

  it("wraps unexpected errors as UNREACHABLE without leaking the message", async () => {
    const doc = await register()
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED 192.168.0.4:443"))
    const outcome = await verifyDomainOwnership({ ...OWNER, domainId: doc.id })
    expect(outcome.failure?.code).toBe("UNREACHABLE")
    expect(outcome.failure?.message).not.toContain("192.168.0.4")
  })

  it("propagates rate limiting before any fetch", async () => {
    const doc = await register()
    rateMock.mockRejectedValueOnce(Object.assign(new Error("Too many attempts"), { code: "RATE_LIMITED" }))
    await expect(verifyDomainOwnership({ ...OWNER, domainId: doc.id })).rejects.toThrow("Too many attempts")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("verifyDomainOwnership — html file", () => {
  it("verifies when the exact file content is served at the exact path", async () => {
    const doc = await register("https://example.com", "html_file")
    fetchMock.mockResolvedValue({
      status: 200,
      body: fileContentForToken(doc.token!),
      contentType: "text/plain",
      hostname: "example.com",
      redirects: 0,
    })
    const outcome = await verifyDomainOwnership({ ...OWNER, domainId: doc.id })
    expect(outcome.doc.status).toBe("verified")
    expect(outcome.doc.verifiedMethod).toBe("html_file")
    expect(fetchMock).toHaveBeenCalledWith(
      doc.submittedUrl,
      `/${doc.fileName}`,
      expect.objectContaining({ allowHostnameChange: false }),
    )
  })

  it("reports TOKEN_MISMATCH when the file exists with wrong content", async () => {
    const doc = await register("https://example.com", "html_file")
    fetchMock.mockResolvedValue({
      status: 200,
      body: "atai-verification=wrong\n",
      contentType: "text/plain",
      hostname: "example.com",
      redirects: 0,
    })
    const outcome = await verifyDomainOwnership({ ...OWNER, domainId: doc.id })
    expect(outcome.failure?.code).toBe("TOKEN_MISMATCH")
  })

  it("reports FILE_MISSING for an empty body", async () => {
    const doc = await register("https://example.com", "html_file")
    fetchMock.mockResolvedValue({ status: 200, body: "  ", contentType: "text/plain", hostname: "example.com", redirects: 0 })
    const outcome = await verifyDomainOwnership({ ...OWNER, domainId: doc.id })
    expect(outcome.failure?.code).toBe("FILE_MISSING")
  })
})

describe("re-verification grace policy", () => {
  async function verifiedDoc() {
    const doc = await register()
    fetchMock.mockResolvedValue(metaPage(doc.token!))
    await verifyDomainOwnership({ ...OWNER, domainId: doc.id })
    return doc
  }

  it("keeps verified status through the first failed re-checks and flags attention", async () => {
    const doc = await verifiedDoc()
    fetchMock.mockResolvedValue({ ...metaPage("x"), body: "<html></html>" })
    for (let i = 1; i < REVERIFICATION_FAILURE_GRACE; i++) {
      const outcome = await verifyDomainOwnership({ ...OWNER, domainId: doc.id, reverification: true })
      expect(outcome.doc.status).toBe("verified")
      expect(outcome.doc.failedChecks).toBe(i)
      expect(outcome.view.needsAttention).toBe(true)
      expect(storedDoc(doc.id).verifiedAt).toBeTypeOf("number")
    }
  })

  it("drops to expired only after the grace limit, never transferring ownership", async () => {
    const doc = await verifiedDoc()
    fetchMock.mockResolvedValue({ ...metaPage("x"), body: "<html></html>" })
    for (let i = 0; i < REVERIFICATION_FAILURE_GRACE; i++) {
      await verifyDomainOwnership({ ...OWNER, domainId: doc.id, reverification: true })
    }
    const stored = storedDoc(doc.id)
    expect(stored.status).toBe("expired")
    expect(stored.verifiedAt).toBeUndefined()
    expect(stored.userId).toBe("user-1")
    expect(stored.releasedAt).toBeUndefined()
  })

  it("a successful re-check clears the failure flag and counter", async () => {
    const doc = await verifiedDoc()
    fetchMock.mockResolvedValue({ ...metaPage("x"), body: "<html></html>" })
    await verifyDomainOwnership({ ...OWNER, domainId: doc.id, reverification: true })
    fetchMock.mockResolvedValue(metaPage(doc.token!))
    const outcome = await verifyDomainOwnership({ ...OWNER, domainId: doc.id, reverification: true })
    expect(outcome.doc.status).toBe("verified")
    expect(storedDoc(doc.id).failedChecks).toBe(0)
    expect(storedDoc(doc.id).lastFailure).toBeNull()
  })
})

describe("owner notifications on re-verification", () => {
  const appendEvent = () => store.appendEvent as ReturnType<typeof vi.fn>

  async function verifiedDoc() {
    const doc = await register()
    fetchMock.mockResolvedValue(metaPage(doc.token!))
    await verifyDomainOwnership({ ...OWNER, domainId: doc.id })
    appendEvent().mockClear()
    return doc
  }

  it("notifies the owner when a verified domain's tag or file disappears", async () => {
    const doc = await verifiedDoc()
    fetchMock.mockResolvedValue({ ...metaPage("x"), body: "<html></html>" })
    await verifyDomainOwnership({ ...OWNER, domainId: doc.id, reverification: true })
    expect(appendEvent()).toHaveBeenCalledTimes(1)
    const [projectId, event] = appendEvent().mock.calls[0]
    expect(projectId).toBe("proj-1")
    expect(event.stage).toBe("domain")
    expect(event.level).toBe("warn")
    expect(event.message).toContain(doc.hostname)
    expect(event.message).toContain("still stands")
  })

  it("notifies the owner when verification expires after the grace limit", async () => {
    const doc = await verifiedDoc()
    fetchMock.mockResolvedValue({ ...metaPage("x"), body: "<html></html>" })
    for (let i = 0; i < REVERIFICATION_FAILURE_GRACE; i++) {
      await verifyDomainOwnership({ ...OWNER, domainId: doc.id, reverification: true })
    }
    expect(appendEvent()).toHaveBeenCalledTimes(REVERIFICATION_FAILURE_GRACE)
    const last = appendEvent().mock.calls.at(-1)![1]
    expect(last.message).toContain("expired")
  })

  it("confirms recovery to the owner after attention was raised", async () => {
    const doc = await verifiedDoc()
    fetchMock.mockResolvedValue({ ...metaPage("x"), body: "<html></html>" })
    await verifyDomainOwnership({ ...OWNER, domainId: doc.id, reverification: true })
    appendEvent().mockClear()
    fetchMock.mockResolvedValue(metaPage(doc.token!))
    await verifyDomainOwnership({ ...OWNER, domainId: doc.id, reverification: true })
    expect(appendEvent()).toHaveBeenCalledTimes(1)
    expect(appendEvent().mock.calls[0][1].level).toBe("info")
    expect(appendEvent().mock.calls[0][1].message).toContain("confirmed again")
  })

  it("stays quiet on a first-time failure of a never-verified claim", async () => {
    const doc = await register()
    fetchMock.mockResolvedValue({ ...metaPage("x"), body: "<html></html>" })
    await verifyDomainOwnership({ ...OWNER, domainId: doc.id })
    expect(appendEvent()).not.toHaveBeenCalled()
  })
})

describe("releaseDomain", () => {
  it("revokes the claim and removes every usable secret", async () => {
    const doc = await register()
    const next = await releaseDomain({ ...OWNER, domainId: doc.id })
    expect(next.status).toBe("revoked")
    const stored = storedDoc(doc.id)
    expect(stored.status).toBe("revoked")
    expect(stored.token).toBeUndefined()
    expect(stored.tokenHash).toBeUndefined()
    expect(stored.releasedAt).toBeTypeOf("number")
  })

  it("frees the hostname for another business only after release", async () => {
    const doc = await register()
    await releaseDomain({ ...OWNER, domainId: doc.id })
    const other = await registerDomain({ userId: "user-2", projectId: "proj-2", rawUrl: "https://example.com" })
    expect(other.created).toBe(true)
    expect(other.doc.userId).toBe("user-2")
  })

  it("cannot be released by a non-owner", async () => {
    const doc = await register()
    await expect(
      releaseDomain({ userId: "user-2", projectId: "proj-1", domainId: doc.id }),
    ).rejects.toBeInstanceOf(DomainServiceError)
    expect(storedDoc(doc.id).status).toBe("pending")
  })
})

describe("bounded history", () => {
  it("keeps at most MAX_DOMAIN_HISTORY entries, newest first, in store and in memory", async () => {
    const doc = await register()
    fetchMock.mockResolvedValue({ ...metaPage("x"), body: "<html></html>" })
    for (let i = 0; i < MAX_DOMAIN_HISTORY + 5; i++) {
      await verifyDomainOwnership({ ...OWNER, domainId: doc.id })
    }
    const stored = storedDoc(doc.id)
    const history = stored.history as Array<{ status: string; detail?: string }>
    expect(history).toHaveLength(MAX_DOMAIN_HISTORY)
    expect(history[0].detail).toBe("META_MISSING") // newest survived the slice
    const view = toDomainView(stored as unknown as BusinessDomainDoc)
    expect(view.history).toHaveLength(MAX_DOMAIN_HISTORY)
  })
})

describe("business claims", () => {
  it("reserves a business for a new project and is idempotent for the same project", async () => {
    const first = await reserveBusinessClaim({ userId: "user-1", projectId: "proj-1", rawUrl: "https://example.com" })
    expect(first.state).toBe("reserved")
    if (first.state !== "reserved") return
    expect(first.created).toBe(true)
    expect(first.doc.canonicalHostname).toBe("example.com")
    expect(first.doc.token).toBeUndefined()

    const again = await reserveBusinessClaim({ userId: "user-1", projectId: "proj-1", rawUrl: "https://example.com/" })
    expect(again.state).toBe("reserved")
    if (again.state !== "reserved") return
    expect(again.created).toBe(false)
    expect(again.doc.id).toBe(first.doc.id)

    // The other exact host of the same business becomes an alias, not a rival claim.
    const alias = await reserveBusinessClaim({ userId: "user-1", projectId: "proj-1", rawUrl: "https://www.example.com/x" })
    expect(alias.state).toBe("reserved")
    if (alias.state !== "reserved") return
    expect(alias.doc.aliasOf).toBe(first.doc.id)
    expect(col.docs.filter((d) => d.releasedAt === undefined)).toHaveLength(2)
    expect(col.docs.filter((d) => d.aliasOf === undefined)).toHaveLength(1)
  })

  it("hands a second project of the same account back to the existing business", async () => {
    const first = await reserveBusinessClaim({ userId: "user-1", projectId: "proj-1", rawUrl: "https://example.com" })
    expect(first.state).toBe("reserved")
    const second = await reserveBusinessClaim({ userId: "user-1", projectId: "proj-2", rawUrl: "https://example.com" })
    expect(second).toEqual({ state: "reuse", projectId: "proj-1" })
  })

  it("refuses another account without disclosing who holds the business", async () => {
    await reserveBusinessClaim({ userId: "user-1", projectId: "proj-1", rawUrl: "https://example.com" })
    const refused = await reserveBusinessClaim({ userId: "user-2", projectId: "proj-2", rawUrl: "https://www.example.com" })
    expect(refused.state).toBe("refused")
    if (refused.state !== "refused") return
    expect(refused.code).toBe("BUSINESS_ALREADY_CONNECTED")
    expect(refused.status).toBe(409)
    expect(refused.message).toBe(BUSINESS_ALREADY_CONNECTED_MESSAGE)
    expect(refused.message).not.toContain("user-1")
    expect(refused.message).not.toContain("proj-1")
    expect(col.docs.filter((d) => d.projectId === "proj-2")).toHaveLength(0)
  })

  it("treats apex and www as one business but keeps subdomains apart", async () => {
    await reserveBusinessClaim({ userId: "user-1", projectId: "proj-1", rawUrl: "https://example.com" })
    const www = await reserveBusinessClaim({ userId: "user-2", projectId: "proj-2", rawUrl: "https://www.example.com" })
    expect(www.state).toBe("refused")
    const shop = await reserveBusinessClaim({ userId: "user-2", projectId: "proj-2", rawUrl: "https://shop.example.com" })
    expect(shop.state).toBe("reserved")
  })

  it("stops blocking once an unverified reservation expires", async () => {
    const now = Date.now()
    const first = await reserveBusinessClaim({ userId: "user-1", projectId: "proj-1", rawUrl: "https://example.com", now })
    expect(first.state).toBe("reserved")
    const later = now + CLAIM_RESERVATION_TTL_MS + 1
    expect(claimIsActive(col.docs[0] as BusinessDomainDoc, later)).toBe(false)
    expect(await canonicalClaimFor("https://example.com", later)).toBeNull()
    const second = await reserveBusinessClaim({ userId: "user-2", projectId: "proj-2", rawUrl: "https://example.com", now: later })
    expect(second.state).toBe("reserved")
  })

  it("never expires a verified claim, even long after the reservation window", async () => {
    const doc = await register("https://example.com")
    await col.updateOne({ id: doc.id }, { $set: { status: "verified", verifiedAt: Date.now() } })
    const later = Date.now() + CLAIM_RESERVATION_TTL_MS * 10
    const stored = storedDoc(doc.id) as BusinessDomainDoc
    expect(claimIsActive(stored, later)).toBe(true)
    expect((await canonicalClaimFor("https://example.com", later))?.doc.id).toBe(doc.id)
  })

  it("frees the hostname when the claim is released", async () => {
    const doc = await register("https://example.com")
    await releaseDomain({ ...OWNER, domainId: doc.id })
    expect(await canonicalClaimFor("https://example.com")).toBeNull()
    const other = await reserveBusinessClaim({ userId: "user-2", projectId: "proj-2", rawUrl: "https://example.com" })
    expect(other.state).toBe("reserved")
    expect(refreshConnectionStatus).toHaveBeenCalledWith("proj-1")
  })

  it("releases every claim of a project at once", async () => {
    await register("https://example.com")
    await register("https://www.example.com")
    const released = await releaseProjectClaims("proj-1", "project deleted")
    expect(released).toBe(2)
    expect(col.docs.every((d) => d.releasedAt !== undefined)).toBe(true)
    expect(col.docs.every((d) => d.token === undefined && d.tokenHash === undefined)).toBe(true)
  })

  it("reports the claim state to the founder without naming the holder", async () => {
    expect(await claimStateFor({ userId: "user-1", rawUrl: "https://example.com" })).toEqual({
      hostname: "example.com",
      state: "unclaimed",
    })
    await reserveBusinessClaim({ userId: "user-1", projectId: "proj-1", rawUrl: "https://example.com" })
    expect(await claimStateFor({ userId: "user-1", projectId: "proj-1", rawUrl: "https://example.com" })).toEqual({
      hostname: "example.com",
      state: "yours",
    })
    expect(await claimStateFor({ userId: "user-2", rawUrl: "https://www.example.com" })).toEqual({
      hostname: "example.com",
      state: "held_by_other",
    })
  })

  it("turns a reservation into a verification challenge on demand", async () => {
    const reserved = await reserveBusinessClaim({ userId: "user-1", projectId: "proj-1", rawUrl: "https://example.com" })
    expect(reserved.state).toBe("reserved")
    if (reserved.state !== "reserved") return
    expect(reserved.doc.token).toBeUndefined()
    const { doc, created } = await registerDomain({ ...OWNER, rawUrl: "https://example.com" })
    expect(created).toBe(false)
    expect(doc.id).toBe(reserved.doc.id)
    expect(doc.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(col.docs).toHaveLength(1)
  })
})
