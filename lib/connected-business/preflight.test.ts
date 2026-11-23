import { beforeEach, describe, expect, it, vi } from "vitest"

const { state } = vi.hoisted(() => ({
  state: {
    setName: "rs0" as string | undefined,
    indexes: {} as Record<string, string[]>,
  },
}))

vi.mock("@/lib/db/collections", async () => {
  const { fakeCollection } = await import("@/lib/business/testing/fake-collections")
  const projects = fakeCollection()
  const businesses = fakeCollection()
  const applications = fakeCollection()
  const members = fakeCollection()
  const domains = fakeCollection()
  return {
    ensureIndexes: async () => {},
    projectsCol: async () => projects,
    businessesCol: async () => businesses,
    connectedApplicationsCol: async () => applications,
    businessMembersCol: async () => members,
    businessDomainsCol: async () => domains,
    __fakes: { projects, businesses, applications, members, domains },
  }
})

vi.mock("@/lib/db/mongodb", () => ({
  getMongoClient: async () => ({
    db: () => ({
      admin: () => ({ command: async () => ({ setName: state.setName }) }),
      collection: (name: string) => ({
        listIndexes: () => ({
          toArray: async () => (state.indexes[name] ?? []).map((indexName) => ({ name: indexName })),
        }),
      }),
    }),
  }),
}))

import * as db from "@/lib/db/collections"
import type { FakeCollection } from "@/lib/business/testing/fake-collections"
import { REQUIRED_INDEXES, preflightConnectedBusinessMigration } from "./preflight"

const fakes = (db as unknown as { __fakes: Record<string, FakeCollection<Record<string, unknown>>> }).__fakes

const ALL_INDEXES = Object.fromEntries(
  REQUIRED_INDEXES.reduce<[string, string[]][]>((groups, required) => {
    const existing = groups.find(([name]) => name === required.collection)
    if (existing) existing[1].push(required.name)
    else groups.push([required.collection, [required.name]])
    return groups
  }, []),
)

beforeEach(() => {
  for (const collection of Object.values(fakes)) collection.docs.length = 0
  state.setName = "rs0"
  state.indexes = structuredClone(ALL_INDEXES)
})

describe("preflightConnectedBusinessMigration", () => {
  it("is a go on a ready replica set, and counts what it saw", async () => {
    fakes.projects.docs.push(
      { id: "p1", userId: "u1", name: "One", sourceUrl: "https://one.example" },
      { id: "p2", userId: "u2", name: "Two", sourceUrl: "https://two.example" },
    )
    fakes.businesses.docs.push({ id: "b1", legacyProjectId: "p1" })
    fakes.members.docs.push({ id: "m1", businessId: "b1", userId: "u1", role: "owner", status: "active" })
    fakes.domains.docs.push({ id: "d1", projectId: "p1" })

    const report = await preflightConnectedBusinessMigration()

    expect(report.verdict).toBe("go")
    expect(report.blocking).toEqual([])
    expect(report.transactions).toBe(true)
    expect(report.totals).toMatchObject({
      projects: 2,
      eligible: 1,
      alreadyMigrated: 1,
      domainClaims: 1,
      domainClaimsAlreadyOwned: 0,
    })
  })

  it("blocks when the deployment cannot run transactions", async () => {
    state.setName = undefined

    const report = await preflightConnectedBusinessMigration()

    expect(report.verdict).toBe("no-go")
    expect(report.blocking.join(" ")).toMatch(/not a replica set/)
  })

  it("blocks when a unique index is missing, and names it", async () => {
    state.indexes = { ...ALL_INDEXES, connected_applications: ["connected_applications_origin_unique"] }

    const report = await preflightConnectedBusinessMigration()

    expect(report.verdict).toBe("no-go")
    expect(report.missingIndexes).toEqual(["connected_applications.connected_applications_legacy_unique"])
    expect(report.blocking.join(" ")).toMatch(/connected_applications_legacy_unique/)
  })

  it("warns about ownerless projects but stays a go", async () => {
    fakes.projects.docs.push({ id: "p1", userId: "u1" }, { id: "p2" })

    const report = await preflightConnectedBusinessMigration()

    expect(report.verdict).toBe("go")
    expect(report.totals.withoutOwner).toBe(1)
    expect(report.totals.eligible).toBe(1)
    expect(report.warnings.join(" ")).toMatch(/no owner/)
  })

  it("warns about applications whose project is gone", async () => {
    fakes.applications.docs.push({ id: "a1", legacyProjectId: "deleted-project" })

    const report = await preflightConnectedBusinessMigration()

    expect(report.verdict).toBe("go")
    expect(report.totals.orphanApplications).toBe(1)
    expect(report.warnings.join(" ")).toMatch(/no longer exists/)
  })

  it("warns about domain claims it will leave untouched", async () => {
    fakes.businesses.docs.push({ id: "b_existing" })
    fakes.domains.docs.push({ id: "d1", projectId: "p1", businessId: "b_existing" })

    const report = await preflightConnectedBusinessMigration()

    expect(report.totals.domainClaimsAlreadyOwned).toBe(1)
    expect(report.warnings.join(" ")).toMatch(/left untouched/)
  })

  it("warns about domain claims pointing at a business that does not exist", async () => {
    fakes.domains.docs.push({ id: "d1", projectId: "p1", hostname: "gone.example", businessId: "biz_missing" })

    const report = await preflightConnectedBusinessMigration()

    expect(report.verdict).toBe("go")
    expect(report.totals.danglingDomainClaims).toBe(1)
    expect(report.warnings.join(" ")).toMatch(/does not exist/)
  })

  it("warns about migrated businesses with no owner member", async () => {
    fakes.businesses.docs.push({ id: "b1", legacyProjectId: "p1" })

    const report = await preflightConnectedBusinessMigration()

    expect(report.totals.ownerlessBusinesses).toBe(1)
    expect(report.warnings.join(" ")).toMatch(/no active owner/)
  })
})
