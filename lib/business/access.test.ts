import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db/collections", async () => {
  const { fakeCollection } = await import("@/lib/business/testing/fake-collections")
  const businesses = fakeCollection({
    unique: [
      {
        keys: ["legacyProjectId"],
        when: (doc: { legacyProjectId?: string }) => typeof doc.legacyProjectId === "string",
      },
    ],
  })
  const applications = fakeCollection({
    unique: [
      {
        keys: ["businessId", "hostname", "basePath"],
        when: (doc: { archivedAt?: number | null }) => doc.archivedAt == null,
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
  return {
    ensureIndexes: async () => {},
    businessesCol: async () => businesses,
    connectedApplicationsCol: async () => applications,
    businessMembersCol: async () => members,
    __fakes: { businesses, applications, members },
  }
})

import type { BusinessDoc, BusinessMemberDoc, ConnectedApplicationDoc } from "@/lib/types/business"
import type { FakeCollection } from "./testing/fake-collections"
import * as db from "@/lib/db/collections"
import { requireBusinessAccess } from "./access"
import { systemActor, userActor } from "./permissions"

interface Fakes {
  businesses: FakeCollection<BusinessDoc>
  applications: FakeCollection<ConnectedApplicationDoc>
  members: FakeCollection<BusinessMemberDoc>
}

const fakes = (db as unknown as { __fakes: Fakes }).__fakes
const NOW = 1_700_000_000_000

function makeBusiness(overrides: Partial<BusinessDoc> = {}): BusinessDoc {
  return {
    id: "biz_1",
    ownerId: "u_owner",
    name: "Acme",
    status: "draft",
    schemaVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeMember(overrides: Partial<BusinessMemberDoc> = {}): BusinessMemberDoc {
  return {
    id: "mem_owner",
    businessId: "biz_1",
    userId: "u_owner",
    role: "owner",
    status: "active",
    scope: { kind: "all" },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeApplication(overrides: Partial<ConnectedApplicationDoc> = {}): ConnectedApplicationDoc {
  return {
    id: "app_1",
    businessId: "biz_1",
    name: "Site",
    kind: "marketing_site",
    primaryUrl: "https://example.com",
    hostname: "example.com",
    basePath: "",
    trustDomain: "example.com",
    hostVerified: false,
    connection: {},
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

beforeEach(() => {
  fakes.businesses.docs.length = 0
  fakes.applications.docs.length = 0
  fakes.members.docs.length = 0
  fakes.businesses.docs.push(makeBusiness())
  fakes.members.docs.push(makeMember())
})

describe("requireBusinessAccess", () => {
  it("refuses an unknown business", async () => {
    await expect(
      requireBusinessAccess({ businessId: "biz_missing", actor: userActor("u_owner"), permission: "business.read" }),
    ).rejects.toMatchObject({ code: "BUSINESS_NOT_FOUND" })
  })

  it("tells a non-member nothing about the business", async () => {
    await expect(
      requireBusinessAccess({ businessId: "biz_1", actor: userActor("u_stranger"), permission: "business.read" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("refuses a permission the member's role does not hold", async () => {
    fakes.members.docs.push(makeMember({ id: "mem_viewer", userId: "u_viewer", role: "viewer" }))
    await expect(
      requireBusinessAccess({ businessId: "biz_1", actor: userActor("u_viewer"), permission: "apps.manage" }),
    ).rejects.toMatchObject({ code: "BUSINESS_FORBIDDEN" })
  })

  it("returns the member's role and permissions on success", async () => {
    const access = await requireBusinessAccess({
      businessId: "biz_1",
      actor: userActor("u_owner"),
      permission: "apps.manage",
    })
    expect(access.role).toBe("owner")
    expect(access.member?.userId).toBe("u_owner")
    expect(access.permissions.has("money.manage")).toBe(true)
  })

  it("enforces a member's application scope", async () => {
    fakes.applications.docs.push(
      makeApplication({ id: "app_shop", basePath: "/shop" }),
      makeApplication({ id: "app_dash", basePath: "/dashboard" }),
    )
    fakes.members.docs.push(
      makeMember({
        id: "mem_marketer",
        userId: "u_marketer",
        role: "marketer",
        scope: { kind: "applications", applicationIds: ["app_shop"] },
      }),
    )

    await expect(
      requireBusinessAccess({
        businessId: "biz_1",
        actor: userActor("u_marketer"),
        permission: "growth.publish",
        applicationId: "app_dash",
      }),
    ).rejects.toMatchObject({ code: "BUSINESS_FORBIDDEN" })

    const allowed = await requireBusinessAccess({
      businessId: "biz_1",
      actor: userActor("u_marketer"),
      permission: "growth.publish",
      applicationId: "app_shop",
    })
    expect(allowed.member?.id).toBe("mem_marketer")
  })

  it("never reaches another business's application", async () => {
    fakes.applications.docs.push(makeApplication({ id: "app_other", businessId: "biz_2" }))
    await expect(
      requireBusinessAccess({
        businessId: "biz_1",
        actor: userActor("u_owner"),
        permission: "apps.read",
        applicationId: "app_other",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("treats an archived application as gone", async () => {
    fakes.applications.docs.push(makeApplication({ id: "app_gone", archivedAt: NOW }))
    await expect(
      requireBusinessAccess({
        businessId: "biz_1",
        actor: userActor("u_owner"),
        permission: "apps.read",
        applicationId: "app_gone",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("allows reads but refuses writes on an archived business", async () => {
    fakes.businesses.docs[0].status = "archived"
    const access = await requireBusinessAccess({
      businessId: "biz_1",
      actor: userActor("u_owner"),
      permission: "business.read",
    })
    expect(access.business.status).toBe("archived")

    await expect(
      requireBusinessAccess({ businessId: "biz_1", actor: userActor("u_owner"), permission: "apps.manage" }),
    ).rejects.toMatchObject({ code: "BUSINESS_FORBIDDEN" })
  })

  it("lets an owner read a suspended business but not write to it", async () => {
    fakes.businesses.docs[0].status = "suspended"
    const access = await requireBusinessAccess({
      businessId: "biz_1",
      actor: userActor("u_owner"),
      permission: "business.read",
    })
    expect(access.role).toBe("owner")

    await expect(
      requireBusinessAccess({ businessId: "biz_1", actor: userActor("u_owner"), permission: "apps.manage" }),
    ).rejects.toMatchObject({ code: "BUSINESS_SUSPENDED" })
  })

  it("refuses even a read for a non-admin on a suspended business", async () => {
    fakes.businesses.docs[0].status = "suspended"
    fakes.members.docs.push(makeMember({ id: "mem_viewer", userId: "u_viewer", role: "viewer" }))
    await expect(
      requireBusinessAccess({ businessId: "biz_1", actor: userActor("u_viewer"), permission: "business.read" }),
    ).rejects.toMatchObject({ code: "BUSINESS_SUSPENDED" })
  })

  it("refuses a system actor every business-scoped permission", async () => {
    for (const permission of ["business.read", "business.manage", "apps.manage", "members.manage"] as const) {
      await expect(
        requireBusinessAccess({ businessId: "biz_1", actor: systemActor("migration"), permission }),
      ).rejects.toMatchObject({ code: "BUSINESS_FORBIDDEN" })
    }
  })

  it("keeps one response contract for every failure mode", async () => {
    fakes.members.docs.push(makeMember({ id: "mem_viewer", userId: "u_viewer", role: "viewer" }))
    fakes.applications.docs.push(makeApplication({ id: "app_1" }))
    fakes.members.docs.push(
      makeMember({
        id: "mem_scoped",
        userId: "u_scoped",
        role: "marketer",
        scope: { kind: "applications", applicationIds: [] },
      }),
    )

    const cases = [
      {
        businessId: "biz_missing",
        actor: userActor("u_owner"),
        permission: "business.read" as const,
        code: "BUSINESS_NOT_FOUND",
        status: 404,
      },
      {
        businessId: "biz_1",
        actor: userActor("u_stranger"),
        permission: "business.read" as const,
        code: "NOT_FOUND",
        status: 404,
      },
      {
        businessId: "biz_1",
        actor: userActor("u_viewer"),
        permission: "apps.manage" as const,
        code: "BUSINESS_FORBIDDEN",
        status: 403,
      },
      {
        businessId: "biz_1",
        actor: userActor("u_scoped"),
        permission: "growth.publish" as const,
        applicationId: "app_1",
        code: "BUSINESS_FORBIDDEN",
        status: 403,
      },
    ]

    for (const testCase of cases) {
      const failure = (await requireBusinessAccess({
        businessId: testCase.businessId,
        actor: testCase.actor,
        permission: testCase.permission,
        applicationId: testCase.applicationId,
      }).catch((caught) => caught)) as { code?: string; status?: number }

      expect(failure.code).toBe(testCase.code)
      expect(failure.status).toBe(testCase.status)
    }
  })

  it("applies a removal on the very next call, with no cached decision", async () => {
    fakes.members.docs.push(makeMember({ id: "mem_viewer", userId: "u_viewer", role: "viewer" }))

    await expect(
      requireBusinessAccess({ businessId: "biz_1", actor: userActor("u_viewer"), permission: "business.read" }),
    ).resolves.toMatchObject({ role: "viewer" })

    fakes.members.docs[1].status = "removed"

    await expect(
      requireBusinessAccess({ businessId: "biz_1", actor: userActor("u_viewer"), permission: "business.read" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
  })
})
