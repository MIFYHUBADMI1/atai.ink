import { beforeEach, describe, expect, it, vi } from "vitest"
import type { BusinessDomainDoc } from "@/lib/types/business-intake"
import { RECHECK_MIN_INTERVAL_MS, recheckVerifiedDomains } from "./recheck"

type Doc = Record<string, unknown>

const col = vi.hoisted(() => ({ docs: [] as Doc[] }))

vi.mock("@/lib/db/collections", () => ({
  businessDomainsCol: vi.fn(async () => ({
    find: (filter: Doc) => {
      let rows = col.docs.filter((doc) => matches(doc, filter))
      const chain = {
        sort(spec: Doc) {
          const [key, direction] = Object.entries(spec)[0]
          rows = [...rows].sort((a, b) => {
            const left = (a[key] as number | undefined) ?? 0
            const right = (b[key] as number | undefined) ?? 0
            return direction === 1 ? left - right : right - left
          })
          return chain
        },
        limit(count: number) {
          rows = rows.slice(0, count)
          return chain
        },
        toArray: async () => rows,
      }
      return chain
    },
  })),
}))

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === "$or") return (cond as Doc[]).some((branch) => matches(doc, branch))
    if (cond && typeof cond === "object" && "$exists" in (cond as Doc)) {
      return (cond as { $exists: boolean }).$exists ? doc[key] !== undefined : doc[key] === undefined
    }
    if (cond && typeof cond === "object" && "$lt" in (cond as Doc)) {
      return typeof doc[key] === "number" && (doc[key] as number) < (cond as { $lt: number }).$lt
    }
    return doc[key] === cond
  })
}

const NOW = 1_700_000_000_000

function domain(overrides: Partial<BusinessDomainDoc> = {}): BusinessDomainDoc {
  return {
    id: "d1",
    projectId: "p1",
    userId: "u1",
    hostname: "bakery.example",
    canonicalHostname: "bakery.example",
    registrableDomain: "bakery.example",
    submittedUrl: "https://bakery.example",
    status: "verified",
    verifiedAt: NOW - 90 * 24 * 60 * 60_000,
    lastCheckedAt: NOW - 3 * 24 * 60 * 60_000,
    createdAt: NOW - 100 * 24 * 60 * 60_000,
    updatedAt: NOW - 3 * 24 * 60 * 60_000,
    ...overrides,
  }
}

beforeEach(() => {
  col.docs = []
})

describe("recheckVerifiedDomains", () => {
  it("checks verified domains that are due, oldest check first", async () => {
    col.docs = [
      domain({ id: "recent", lastCheckedAt: NOW - 60 * 60_000 }),
      domain({ id: "older", hostname: "older.example", lastCheckedAt: NOW - 5 * 24 * 60 * 60_000 }),
      domain({ id: "never", hostname: "never.example", lastCheckedAt: undefined }),
    ]
    const verify = vi.fn(async (input: { domainId: string }) => ({
      doc: { ...domain({ id: input.domainId }), status: "verified" as const },
    }))

    const report = await recheckVerifiedDomains({ now: NOW, verify, refresh: vi.fn() })

    expect(verify.mock.calls.map(([input]) => input.domainId)).toEqual(["never", "older"])
    expect(report).toMatchObject({ scanned: 2, checked: 2, stillVerified: 2, needsAttention: 0, expired: 0 })
  })

  it("never checks a released or unverified domain", async () => {
    col.docs = [
      domain({ id: "released", releasedAt: NOW - 1000 }),
      domain({ id: "pending", status: "pending", verifiedAt: undefined }),
    ]
    const verify = vi.fn()

    const report = await recheckVerifiedDomains({ now: NOW, verify, refresh: vi.fn() })

    expect(verify).not.toHaveBeenCalled()
    expect(report.scanned).toBe(0)
  })

  it("checks a verified alias too — it is an exact host with its own proof", async () => {
    col.docs = [domain({ id: "alias", aliasOf: "primary", hostname: "www.bakery.example" })]
    const verify = vi.fn(async () => ({ doc: domain({ id: "alias" }) }))

    const report = await recheckVerifiedDomains({ now: NOW, verify, refresh: vi.fn() })

    expect(verify).toHaveBeenCalledTimes(1)
    expect(report.checked).toBe(1)
  })

  it("respects the daily interval instead of hammering a site", async () => {
    col.docs = [domain({ lastCheckedAt: NOW - RECHECK_MIN_INTERVAL_MS + 60_000 })]
    const verify = vi.fn()

    await recheckVerifiedDomains({ now: NOW, verify, refresh: vi.fn() })

    expect(verify).not.toHaveBeenCalled()
  })

  it("counts attention and expiry separately from a clean pass", async () => {
    col.docs = [
      domain({ id: "attention" }),
      domain({ id: "expired", hostname: "expired.example" }),
    ]
    const verify = vi.fn(async (input: { domainId: string }) =>
      input.domainId === "expired"
        ? { doc: { ...domain({ id: "expired" }), status: "expired" as const } }
        : { doc: { ...domain({ id: "attention" }), needsAttention: true } },
    )
    const refresh = vi.fn()

    const report = await recheckVerifiedDomains({ now: NOW, verify, refresh })

    expect(report).toMatchObject({ checked: 2, stillVerified: 0, needsAttention: 1, expired: 1 })
    // Only the domain that actually lost verified status changes the connection.
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledWith("p1")
  })

  it("keeps going when one check throws, and reports it", async () => {
    col.docs = [domain({ id: "boom" }), domain({ id: "fine", hostname: "fine.example" })]
    const verify = vi.fn(async (input: { domainId: string }) => {
      if (input.domainId === "boom") throw new Error("fetch exploded")
      return { doc: domain({ id: "fine" }) }
    })

    const report = await recheckVerifiedDomains({ now: NOW, verify, refresh: vi.fn() })

    expect(report.checked).toBe(1)
    expect(report.errors).toEqual([{ domainId: "boom", hostname: "bakery.example", error: "fetch exploded" }])
  })

  it("never releases a claim from the sweep itself", async () => {
    col.docs = [domain()]
    const verify = vi.fn(async () => ({ doc: domain({ needsAttention: true }) }))

    await recheckVerifiedDomains({ now: NOW, verify, refresh: vi.fn() })

    expect(col.docs[0].releasedAt).toBeUndefined()
    expect(col.docs[0].status).toBe("verified")
  })
})
