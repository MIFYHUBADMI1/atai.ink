import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db/collections", async () => {
  const { fakeCollection } = await import("@/lib/business/testing/fake-collections")
  const businesses = fakeCollection()
  const members = fakeCollection()
  const applications = fakeCollection()
  const domains = fakeCollection()
  return {
    businessesCol: async () => businesses,
    businessMembersCol: async () => members,
    connectedApplicationsCol: async () => applications,
    businessDomainsCol: async () => domains,
    __fakes: { businesses, members, applications, domains },
  }
})

import type { BusinessDoc, BusinessMemberDoc, ConnectedApplicationDoc } from "@/lib/types/business"
import type { FakeCollection } from "@/lib/business/testing/fake-collections"
import * as db from "@/lib/db/collections"
import { verifyConnectedBusinesses } from "./verify"

interface Fakes {
  businesses: FakeCollection<BusinessDoc>
  members: FakeCollection<BusinessMemberDoc>
  applications: FakeCollection<ConnectedApplicationDoc>
  domains: FakeCollection<{ id: string; hostname: string; businessId?: string }>
}

const fakes = (db as unknown as { __fakes: Fakes }).__fakes

function business(id: string): BusinessDoc {
  return {
    id,
    ownerId: `u_${id}`,
    name: id,
    status: "active",
    schemaVersion: 1,
    createdAt: 1,
    updatedAt: 1,
  }
}

function owner(businessId: string, userId = `u_${businessId}`): BusinessMemberDoc {
  return {
    id: `mem_${businessId}_${userId}`,
    businessId,
    userId,
    role: "owner",
    status: "active",
    scope: { kind: "all" },
    createdAt: 1,
    updatedAt: 1,
  }
}

function application(overrides: Partial<ConnectedApplicationDoc> & { id: string; businessId: string }): ConnectedApplicationDoc {
  return {
    name: "app",
    kind: "other",
    primaryUrl: "https://example.com",
    hostname: "example.com",
    basePath: "/",
    trustDomain: "example.com",
    hostVerified: false,
    connection: {},
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

beforeEach(() => {
  fakes.businesses.docs.length = 0
  fakes.members.docs.length = 0
  fakes.applications.docs.length = 0
  fakes.domains.docs.length = 0
})

describe("verification", () => {
  it("reports nothing for a clean model", async () => {
    fakes.businesses.docs.push(business("biz_1"))
    fakes.members.docs.push(owner("biz_1"))
    fakes.applications.docs.push(application({ id: "app_1", businessId: "biz_1" }))

    const report = await verifyConnectedBusinesses()

    expect(report.problems).toEqual([])
    expect(report.warnings).toEqual([])
  })

  it("accepts an archived application and its replacement on the same origin", async () => {
    fakes.businesses.docs.push(business("biz_1"))
    fakes.members.docs.push(owner("biz_1"))
    fakes.applications.docs.push(application({ id: "app_old", businessId: "biz_1", archivedAt: 5 }))
    fakes.applications.docs.push(application({ id: "app_new", businessId: "biz_1" }))

    const report = await verifyConnectedBusinesses()

    expect(report.problems).toEqual([])
  })

  it("warns, but does not fail, when two businesses claim one origin", async () => {
    fakes.businesses.docs.push(business("biz_1"), business("biz_2"))
    fakes.members.docs.push(owner("biz_1"), owner("biz_2"))
    fakes.applications.docs.push(
      application({ id: "app_1", businessId: "biz_1" }),
      application({ id: "app_2", businessId: "biz_2" }),
    )

    const report = await verifyConnectedBusinesses()

    expect(report.problems).toEqual([])
    expect(report.warnings.join(" ")).toMatch(/claimed by 2 businesses/)
  })

  it("fails when one business claims the same origin twice", async () => {
    fakes.businesses.docs.push(business("biz_1"))
    fakes.members.docs.push(owner("biz_1"))
    fakes.applications.docs.push(
      application({ id: "app_1", businessId: "biz_1" }),
      application({ id: "app_2", businessId: "biz_1" }),
    )

    const report = await verifyConnectedBusinesses()

    expect(report.problems.join(" ")).toMatch(/claimed twice within biz_1/)
  })

  it("fails when a business does not have exactly one active owner", async () => {
    fakes.businesses.docs.push(business("biz_1"))
    fakes.members.docs.push(owner("biz_1", "u_a"), owner("biz_1", "u_b"))

    const report = await verifyConnectedBusinesses()

    expect(report.problems.join(" ")).toMatch(/has 2 active owners/)
  })

  it("fails on a dangling reference", async () => {
    fakes.businesses.docs.push(business("biz_1"))
    fakes.members.docs.push(owner("biz_1"), { ...owner("biz_gone"), id: "mem_gone" })
    fakes.domains.docs.push({ id: "d1", hostname: "example.com", businessId: "biz_gone" })

    const report = await verifyConnectedBusinesses()

    expect(report.problems.join(" ")).toMatch(/missing business biz_gone/)
    expect(report.problems.filter((problem) => problem.includes("biz_gone")).length).toBeGreaterThanOrEqual(2)
  })
})
