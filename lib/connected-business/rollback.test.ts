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

interface Fakes {
  businesses: FakeCollection<{ id: string; migration?: { runId: string } }>
  members: FakeCollection<{ id: string; businessId: string; migration?: { runId: string } }>
  applications: FakeCollection<{ id: string; businessId: string; migration?: { runId: string } }>
  domains: FakeCollection<{ id: string; hostname: string; businessId?: string; applicationId?: string }>
}

const fakes = (db as unknown as { __fakes: Fakes }).__fakes

beforeEach(() => {
  fakes.businesses.docs.length = 0
  fakes.members.docs.length = 0
  fakes.applications.docs.length = 0
  fakes.domains.docs.length = 0
})

describe("rollback", () => {
  it("reports without deleting in dry-run", async () => {
    fakes.businesses.docs.push({ id: "biz_1", migration: { runId: "run-1" } })
    fakes.members.docs.push({ id: "mem_1", businessId: "biz_1", migration: { runId: "run-1" } })
    fakes.applications.docs.push({ id: "app_1", businessId: "biz_1", migration: { runId: "run-1" } })
    fakes.domains.docs.push({ id: "d1", hostname: "example.com", businessId: "biz_1" })

    const report = await rollbackMigration({ runId: "run-1", mode: "dry-run" })

    expect(report).toMatchObject({ businesses: 1, memberships: 1, applications: 1, domains: 1 })
    expect(fakes.businesses.docs).toHaveLength(1)
    expect(fakes.domains.docs[0].businessId).toBe("biz_1")
  })

  it("removes only the rows stamped with the run", async () => {
    fakes.businesses.docs.push({ id: "biz_1", migration: { runId: "run-1" } }, { id: "biz_2" })
    fakes.members.docs.push(
      { id: "mem_1", businessId: "biz_1", migration: { runId: "run-1" } },
      { id: "mem_2", businessId: "biz_2" },
    )
    fakes.applications.docs.push({ id: "app_1", businessId: "biz_1", migration: { runId: "run-1" } })
    fakes.domains.docs.push({ id: "d1", hostname: "example.com", businessId: "biz_1" })

    await rollbackMigration({ runId: "run-1", mode: "apply" })

    expect(fakes.businesses.docs.map((doc) => doc.id)).toEqual(["biz_2"])
    expect(fakes.members.docs.map((doc) => doc.id)).toEqual(["mem_2"])
    expect(fakes.applications.docs).toHaveLength(0)
    expect(fakes.domains.docs[0].businessId).toBeUndefined()
  })
})
