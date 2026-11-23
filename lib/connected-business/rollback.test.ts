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

import type { FakeCollection } from "@/lib/business/testing/fake-collections"
import * as db from "@/lib/db/collections"
import { rollbackMigration } from "./rollback"

const RUN = "run-1"
const stamp = { id: "mig_1", runId: RUN, createdAt: 100 }

interface Fakes {
  businesses: FakeCollection<{ id: string; name?: string; updatedAt?: number; migration?: { runId: string; createdAt: number } }>
  members: FakeCollection<{
    id: string
    businessId: string
    status?: string
    updatedAt?: number
    migration?: { runId: string }
  }>
  applications: FakeCollection<{
    id: string
    businessId: string
    archivedAt?: number
    updatedAt?: number
    migration?: { runId: string }
  }>
  domains: FakeCollection<{ id: string; hostname: string; businessId?: string; applicationId?: string; migration?: { runId: string } }>
}

const fakes = (db as unknown as { __fakes: Fakes }).__fakes

/** A business exactly as the migration leaves it: untouched since creation. */
function seedMigratedBusiness(overrides: { updatedAt?: number } = {}) {
  fakes.businesses.docs.push({
    id: "biz_1",
    name: "Migrated",
    updatedAt: overrides.updatedAt ?? 100,
    migration: stamp,
  })
  fakes.members.docs.push({
    id: "mem_1",
    businessId: "biz_1",
    status: "active",
    updatedAt: 100,
    migration: { runId: RUN },
  })
  fakes.applications.docs.push({
    id: "app_1",
    businessId: "biz_1",
    updatedAt: 100,
    migration: { runId: RUN },
  })
  fakes.domains.docs.push({ id: "d1", hostname: "example.com", businessId: "biz_1", applicationId: "app_1", migration: { runId: RUN } })
}

beforeEach(() => {
  fakes.businesses.docs.length = 0
  fakes.members.docs.length = 0
  fakes.applications.docs.length = 0
  fakes.domains.docs.length = 0
})

describe("rollback of an untouched run", () => {
  it("reports without deleting in dry-run", async () => {
    seedMigratedBusiness()

    const report = await rollbackMigration({ runId: RUN, mode: "dry-run" })

    expect(report).toMatchObject({ businesses: 1, memberships: 1, applications: 1, domains: 1, blocked: false, applied: false })
    expect(fakes.businesses.docs).toHaveLength(1)
    expect(fakes.domains.docs[0].businessId).toBe("biz_1")
  })

  it("removes only the rows stamped with the run", async () => {
    seedMigratedBusiness()
    fakes.businesses.docs.push({ id: "biz_2", name: "Founder-made" })

    const report = await rollbackMigration({ runId: RUN, mode: "apply" })

    expect(report.applied).toBe(true)
    expect(fakes.businesses.docs.map((doc) => doc.id)).toEqual(["biz_2"])
    expect(fakes.members.docs).toHaveLength(0)
    expect(fakes.applications.docs).toHaveLength(0)
    expect(fakes.domains.docs[0].businessId).toBeUndefined()
    expect(fakes.domains.docs[0].migration).toBeUndefined()
  })

  it("is safe to run twice", async () => {
    seedMigratedBusiness()
    await rollbackMigration({ runId: RUN, mode: "apply" })
    const second = await rollbackMigration({ runId: RUN, mode: "apply" })

    expect(second).toMatchObject({ businesses: 0, applications: 0, memberships: 0, domains: 0, applied: true })
  })
})

describe("rollback refuses to destroy work a founder has done", () => {
  it("blocks when the business was renamed after migration", async () => {
    seedMigratedBusiness({ updatedAt: 500 })

    const report = await rollbackMigration({ runId: RUN, mode: "apply" })

    expect(report.blocked).toBe(true)
    expect(report.applied).toBe(false)
    expect(report.impact[0].modified).toBe(true)
    expect(fakes.businesses.docs).toHaveLength(1)
    expect(fakes.members.docs).toHaveLength(1)
    expect(fakes.applications.docs).toHaveLength(1)
  })

  it("blocks when a person was added after migration", async () => {
    seedMigratedBusiness()
    fakes.members.docs.push({ id: "mem_2", businessId: "biz_1", status: "active", updatedAt: 400 })

    const report = await rollbackMigration({ runId: RUN, mode: "apply" })

    expect(report.blocked).toBe(true)
    expect(report.applied).toBe(false)
    expect(report.impact[0].foreignMemberships).toBe(1)
    expect(fakes.members.docs).toHaveLength(2)
  })

  it("blocks when an application was connected after migration", async () => {
    seedMigratedBusiness()
    fakes.applications.docs.push({ id: "app_2", businessId: "biz_1", updatedAt: 400 })

    const report = await rollbackMigration({ runId: RUN, mode: "apply" })

    expect(report.blocked).toBe(true)
    expect(report.impact[0].foreignApplications).toBe(1)
    expect(fakes.applications.docs).toHaveLength(2)
  })

  it("blocks when a migrated application was archived", async () => {
    seedMigratedBusiness()
    fakes.applications.docs[0].archivedAt = 400

    const report = await rollbackMigration({ runId: RUN, mode: "apply" })

    expect(report.blocked).toBe(true)
    expect(report.impact[0].changedChildren).toBe(1)
  })

  it("blocks when a migrated member was removed", async () => {
    seedMigratedBusiness()
    fakes.members.docs.push({ id: "mem_2", businessId: "biz_1", status: "removed", updatedAt: 400, migration: { runId: RUN } })

    const report = await rollbackMigration({ runId: RUN, mode: "apply" })

    expect(report.blocked).toBe(true)
  })

  it("proceeds only with the explicit recovery flag, and reports what it orphans", async () => {
    seedMigratedBusiness({ updatedAt: 500 })
    fakes.members.docs.push({ id: "mem_2", businessId: "biz_1", status: "active", updatedAt: 400 })

    const report = await rollbackMigration({ runId: RUN, mode: "apply", allowInUse: true })

    expect(report.applied).toBe(true)
    expect(report.blocked).toBe(true)
    expect(report.orphanedMemberships).toBe(1)
    expect(fakes.businesses.docs).toHaveLength(0)
    // The founder's own member row is never deleted, only orphaned.
    expect(fakes.members.docs.map((doc) => doc.id)).toEqual(["mem_2"])
  })
})

describe("domain detachment is run-scoped", () => {
  it("leaves a claim the founder connected after the migration", async () => {
    seedMigratedBusiness()
    fakes.domains.docs.push({ id: "d2", hostname: "later.example", businessId: "biz_1" })

    const report = await rollbackMigration({ runId: RUN, mode: "apply" })

    expect(report.domains).toBe(1)
    expect(fakes.domains.docs.find((doc) => doc.id === "d2")?.businessId).toBe("biz_1")
    expect(fakes.domains.docs.find((doc) => doc.id === "d1")?.businessId).toBeUndefined()
  })

  it("leaves a stamped claim that was re-pointed to another business", async () => {
    seedMigratedBusiness()
    fakes.domains.docs[0].businessId = "biz_other"

    await rollbackMigration({ runId: RUN, mode: "apply" })

    expect(fakes.domains.docs[0].businessId).toBe("biz_other")
  })
})
