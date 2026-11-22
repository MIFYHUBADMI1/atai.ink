import { beforeEach, describe, expect, it, vi } from "vitest"
import type { BusinessDomainDoc } from "@/lib/types/business-intake"
import { listBusinessClaims, releaseBusinessClaimForSupport } from "./claims-admin"

type Doc = Record<string, unknown>
const db = vi.hoisted(() => ({ domains: [] as Doc[], projects: [] as Doc[], users: [] as Doc[] }))

function collection(rows: Doc[]) {
  return {
    find: (filter: Doc) => {
      let found = rows.filter((row) => matches(row, filter))
      const chain = {
        sort: () => chain,
        limit: (count: number) => {
          found = found.slice(0, count)
          return chain
        },
        toArray: async () => found,
      }
      return chain
    },
    updateOne: async (filter: Doc, update: Doc) => {
      const row = rows.find((candidate) => matches(candidate, filter))
      if (row && update.$set) Object.assign(row, update.$set)
      if (row && update.$unset) for (const key of Object.keys(update.$unset as Doc)) delete row[key]
      if (row && update.$push) {
        const spec = (update.$push as Record<string, Doc>).history
        row.history = [...((spec.$each as unknown[]) ?? []), ...((row.history as unknown[]) ?? [])]
      }
      return { matchedCount: row ? 1 : 0 }
    },
  }
}

vi.mock("@/lib/db/collections", () => ({
  businessDomainsCol: vi.fn(async () => collection(db.domains)),
  projectsCol: vi.fn(async () => collection(db.projects)),
  usersCol: vi.fn(async () => collection(db.users)),
}))

function matches(row: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (cond && typeof cond === "object") {
      const c = cond as Record<string, unknown>
      if ("$exists" in c) return c.$exists ? row[key] !== undefined : row[key] === undefined
      if ("$in" in c) return (c.$in as unknown[]).includes(row[key])
    }
    return row[key] === cond
  })
}

const NOW = 1_700_000_000_000

function claim(overrides: Partial<BusinessDomainDoc> = {}): BusinessDomainDoc {
  return {
    id: "d1",
    projectId: "p1",
    userId: "u1",
    hostname: "bakery.example",
    canonicalHostname: "bakery.example",
    registrableDomain: "bakery.example",
    submittedUrl: "https://bakery.example",
    status: "verified",
    verifiedAt: NOW - 1000,
    token: "atai_live_secret",
    tokenHash: "hash",
    createdAt: NOW - 5000,
    updatedAt: NOW - 1000,
    ...overrides,
  }
}

beforeEach(() => {
  db.domains = []
  db.projects = [{ id: "p1", name: "Corner Bakery" }]
  db.users = [{ id: "u1", email: "owner@example.com" }]
})

describe("listBusinessClaims", () => {
  it("folds apex and www into one business and names the owner", async () => {
    db.domains = [claim(), claim({ id: "d2", hostname: "www.bakery.example", aliasOf: "d1", status: "pending", verifiedAt: undefined })]

    const rows = await listBusinessClaims()

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      canonicalHostname: "bakery.example",
      state: "verified",
      projectName: "Corner Bakery",
      ownerEmail: "owner@example.com",
    })
    expect(rows[0].hostnames.sort()).toEqual(["bakery.example", "www.bakery.example"])
  })

  it("never lists a released claim", async () => {
    db.domains = [claim({ releasedAt: NOW - 1000 })]

    expect(await listBusinessClaims()).toEqual([])
  })

  it("shows the expiry deadline for an unverified claim", async () => {
    db.domains = [claim({ status: "pending", verifiedAt: undefined, claimExpiresAt: NOW + 3600_000 })]

    const [row] = await listBusinessClaims()

    expect(row.state).toBe("pending")
    expect(row.claimExpiresAt).toBe(NOW + 3600_000)
  })
})

describe("releaseBusinessClaimForSupport", () => {
  it("releases every record for the business and keeps an audit entry", async () => {
    db.domains = [claim(), claim({ id: "d2", hostname: "www.bakery.example", aliasOf: "d1" })]

    const result = await releaseBusinessClaimForSupport({
      hostname: "bakery.example",
      reason: "owner lost access to the old account",
      actorId: "admin-7",
    })

    expect(result.released).toHaveLength(2)
    for (const doc of db.domains) {
      expect(doc.releasedAt).toBeTypeOf("number")
      expect(doc.status).toBe("revoked")
      expect(doc.token).toBeUndefined()
      expect(doc.tokenHash).toBeUndefined()
      const [entry] = doc.history as Array<{ detail: string }>
      expect(entry.detail).toBe("released by support (admin-7): owner lost access to the old account")
    }
  })

  it("requires a reason", async () => {
    db.domains = [claim()]

    await expect(
      releaseBusinessClaimForSupport({ hostname: "bakery.example", reason: "  ", actorId: "admin-7" }),
    ).rejects.toThrow(/reason/i)
    expect(db.domains[0].releasedAt).toBeUndefined()
  })

  it("reports nothing released for a host that is not claimed", async () => {
    db.domains = []

    const result = await releaseBusinessClaimForSupport({
      hostname: "other.example",
      reason: "owner request",
      actorId: "admin-7",
    })

    expect(result.released).toEqual([])
  })
})
