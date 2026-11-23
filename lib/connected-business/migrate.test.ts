import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db/collections", async () => {
  const { fakeCollection } = await import("@/lib/business/testing/fake-collections")
  const projects = fakeCollection()
  const businesses = fakeCollection({
    unique: [
      {
        keys: ["legacyProjectId"],
        when: (doc: { legacyProjectId?: string }) => typeof doc.legacyProjectId === "string",
      },
    ],
  })
  const members = fakeCollection({
    unique: [
      ["businessId", "userId"],
      {
        keys: ["businessId"],
        when: (doc: { role?: string; status?: string }) => doc.role === "owner" && doc.status === "active",
      },
    ],
  })
  const applications = fakeCollection()
  const domains = fakeCollection()
  return {
    businessesCol: async () => businesses,
    businessMembersCol: async () => members,
    connectedApplicationsCol: async () => applications,
    businessDomainsCol: async () => domains,
    projectsCol: async () => projects,
    __fakes: { projects, businesses, members, applications, domains },
  }
})

vi.mock("@/lib/db/mongodb", async () => {
  const { fakeSession } = await import("@/lib/business/testing/fake-collections")
  return { getMongoClient: async () => ({ startSession: () => fakeSession() }) }
})

import type { BusinessDoc, BusinessMemberDoc, ConnectedApplicationDoc } from "@/lib/types/business"
import type { MirrorProject } from "@/lib/types/project"
import type { FakeCollection } from "@/lib/business/testing/fake-collections"
import * as db from "@/lib/db/collections"
import { applicationIdentityFrom, migrateConnectedBusinesses } from "./migrate"

interface Fakes {
  projects: FakeCollection<MirrorProject & object>
  businesses: FakeCollection<BusinessDoc>
  members: FakeCollection<BusinessMemberDoc>
  applications: FakeCollection<ConnectedApplicationDoc>
  domains: FakeCollection<{ id: string; projectId: string; hostname: string; businessId?: string }>
}

const fakes = (db as unknown as { __fakes: Fakes }).__fakes

function project(overrides: Partial<MirrorProject> = {}): MirrorProject {
  return {
    id: "p1",
    userId: "u1",
    name: "Bakery",
    state: "created",
    mode: "scratch",
    createdAt: 10,
    updatedAt: 20,
    sourceUrl: "https://example.com/shop",
    ...overrides,
  } as MirrorProject
}

beforeEach(() => {
  fakes.projects.docs.length = 0
  fakes.businesses.docs.length = 0
  fakes.members.docs.length = 0
  fakes.applications.docs.length = 0
  fakes.domains.docs.length = 0
})

describe("application identity", () => {
  it("derives canonical identity from a project address", () => {
    expect(applicationIdentityFrom("HTTPS://Example.COM/shop/")).toEqual({
      hostname: "example.com",
      basePath: "/shop",
      primaryUrl: "https://example.com/shop",
    })
  })

  it("returns null for a missing, credentialed or non-http address", () => {
    expect(applicationIdentityFrom(undefined)).toBeNull()
    expect(applicationIdentityFrom("https://user:pass@example.com")).toBeNull()
    expect(applicationIdentityFrom("ftp://example.com")).toBeNull()
    expect(applicationIdentityFrom("localhost")).toBeNull()
  })
})

describe("migration", () => {
  it("plans without writing", async () => {
    fakes.projects.docs.push(project())

    const report = await migrateConnectedBusinesses({ mode: "dry-run", runId: "run-1", now: 100 })

    expect(report.planned).toBe(1)
    expect(report.created).toBe(0)
    expect(fakes.businesses.docs).toHaveLength(0)
    expect(fakes.members.docs).toHaveLength(0)
  })

  it("creates the business, its owner and its application under one run", async () => {
    fakes.projects.docs.push(project())
    fakes.domains.docs.push({ id: "d1", projectId: "p1", hostname: "example.com" })

    const report = await migrateConnectedBusinesses({ mode: "apply", runId: "run-1", now: 100 })

    expect(report.created).toBe(1)
    expect(fakes.businesses.docs).toHaveLength(1)
    expect(fakes.members.docs).toHaveLength(1)
    expect(fakes.applications.docs).toHaveLength(1)

    const business = fakes.businesses.docs[0]
    expect(business.legacyProjectId).toBe("p1")
    expect(business.ownerId).toBe("u1")
    expect(business.migration?.runId).toBe("run-1")
    expect(fakes.members.docs[0].migration?.runId).toBe("run-1")
    expect(fakes.members.docs[0].role).toBe("owner")
    expect(fakes.applications.docs[0].migration?.runId).toBe("run-1")
    expect(fakes.applications.docs[0].hostname).toBe("example.com")
    expect(fakes.domains.docs[0].businessId).toBe(business.id)
    expect(fakes.domains.docs[0].migration?.runId).toBe("run-1")
  })

  it("never re-points a domain claim that already has an owner", async () => {
    fakes.projects.docs.push(project())
    fakes.domains.docs.push({ id: "d1", projectId: "p1", hostname: "example.com", businessId: "biz_other" })

    const report = await migrateConnectedBusinesses({ mode: "apply", runId: "run-1", now: 100 })

    expect(report.created).toBe(1)
    expect(fakes.domains.docs[0].businessId).toBe("biz_other")
    expect(fakes.domains.docs[0].migration).toBeUndefined()
    expect(report.items[0].warning).toMatch(/already owned/)
  })

  it("is idempotent across runs", async () => {
    fakes.projects.docs.push(project())

    await migrateConnectedBusinesses({ mode: "apply", runId: "run-1", now: 100 })
    const second = await migrateConnectedBusinesses({ mode: "apply", runId: "run-2", now: 200 })

    expect(second.skipped).toBe(1)
    expect(fakes.businesses.docs).toHaveLength(1)
  })

  it("migrates a project without a usable address as a business only", async () => {
    fakes.projects.docs.push(project({ sourceUrl: undefined }))

    const report = await migrateConnectedBusinesses({ mode: "apply", runId: "run-1", now: 100 })

    expect(report.created).toBe(1)
    expect(fakes.businesses.docs).toHaveLength(1)
    expect(fakes.applications.docs).toHaveLength(0)
    expect(report.items[0].warning).toMatch(/no usable site address/)
  })

  it("scopes a run to the given projects", async () => {
    fakes.projects.docs.push(project({ id: "p1" }), project({ id: "p2", userId: "u2" }))

    const report = await migrateConnectedBusinesses({
      mode: "dry-run",
      runId: "run-1",
      projectIds: ["p2"],
      now: 100,
    })

    expect(report.total).toBe(1)
    expect(report.items[0].projectId).toBe("p2")
  })
})
