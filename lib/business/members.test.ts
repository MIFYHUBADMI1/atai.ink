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
  const members = fakeCollection({
    unique: [
      ["businessId", "userId"],
      {
        keys: ["businessId"],
        when: (doc: { role?: string; status?: string }) => doc.role === "owner" && doc.status === "active",
      },
    ],
  })
  const applications = fakeCollection({
    unique: [
      {
        keys: ["businessId", "hostname", "basePath"],
        when: (doc: { archivedAt?: number }) => doc.archivedAt === undefined,
      },
    ],
  })
  return {
    ensureIndexes: async () => {},
    businessesCol: async () => businesses,
    businessMembersCol: async () => members,
    connectedApplicationsCol: async () => applications,
    __fakes: { businesses, members, applications },
  }
})

import type { BusinessDoc, BusinessMemberDoc, ConnectedApplicationDoc } from "@/lib/types/business"
import type { FakeCollection } from "./testing/fake-collections"
import * as db from "@/lib/db/collections"
import {
  addMember,
  addOwner,
  listMembers,
  reactivateMember,
  removeMember,
  resolveMember,
} from "./members"
import { systemActor, userActor } from "./permissions"

interface Fakes {
  businesses: FakeCollection<BusinessDoc>
  members: FakeCollection<BusinessMemberDoc>
  applications: FakeCollection<ConnectedApplicationDoc>
}

const fakes = (db as unknown as { __fakes: Fakes }).__fakes
const NOW = 1_700_000_000_000
const OWNER = userActor("u_owner")
const STRANGER = userActor("u_stranger")

function seedBusiness(overrides: Partial<BusinessDoc> = {}): BusinessDoc {
  const business: BusinessDoc = {
    id: "biz_1",
    ownerId: "u_owner",
    name: "Acme",
    status: "draft",
    schemaVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
  fakes.businesses.docs.push(business)
  return business
}

function seedMember(overrides: Partial<BusinessMemberDoc> = {}): BusinessMemberDoc {
  const member: BusinessMemberDoc = {
    id: `mem_${overrides.userId ?? "u_owner"}`,
    businessId: "biz_1",
    userId: "u_owner",
    role: "owner",
    status: "active",
    scope: { kind: "all" },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
  fakes.members.docs.push(member)
  return member
}

function makeApplication(overrides: Partial<ConnectedApplicationDoc> = {}): ConnectedApplicationDoc {
  return {
    id: "app_shop",
    businessId: "biz_1",
    name: "Shop",
    kind: "storefront",
    primaryUrl: "https://example.com/shop",
    hostname: "example.com",
    basePath: "/shop",
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
  fakes.members.docs.length = 0
  fakes.applications.docs.length = 0
  seedBusiness()
  seedMember()
})

describe("seating the first owner", () => {
  it("creates an active owner with full scope on an empty business", async () => {
    seedBusiness({ id: "biz_new", ownerId: "u_new" })
    const owner = await addOwner({
      businessId: "biz_new",
      userId: "u_new",
      actor: systemActor("business-creation"),
      now: NOW,
    })
    expect(owner.role).toBe("owner")
    expect(owner.status).toBe("active")
    expect(owner.scope).toEqual({ kind: "all" })
  })

  it("refuses a user actor", async () => {
    seedBusiness({ id: "biz_new", ownerId: "u_new" })
    await expect(
      addOwner({ businessId: "biz_new", userId: "u_new", actor: userActor("u_new"), now: NOW }),
    ).rejects.toMatchObject({ code: "BUSINESS_FORBIDDEN" })
  })

  it("refuses a business that already has members", async () => {
    await expect(
      addOwner({ businessId: "biz_1", userId: "u2", actor: systemActor("test"), now: NOW }),
    ).rejects.toMatchObject({ code: "VALIDATION" })
  })

  it("refuses an unknown business", async () => {
    await expect(
      addOwner({ businessId: "biz_missing", userId: "u2", actor: systemActor("test"), now: NOW }),
    ).rejects.toMatchObject({ code: "BUSINESS_NOT_FOUND" })
  })
})

describe("member management", () => {
  it("adds a member when the actor may manage members", async () => {
    const member = await addMember({ businessId: "biz_1", userId: "u2", actor: OWNER, role: "viewer", now: NOW })
    expect(member.status).toBe("active")
  })

  it("refuses a non-member actor", async () => {
    await expect(
      addMember({ businessId: "biz_1", userId: "u2", actor: STRANGER, role: "viewer", now: NOW }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    expect(fakes.members.docs).toHaveLength(1)
  })

  it("refuses an actor without members.manage", async () => {
    seedMember({ userId: "u_viewer", role: "viewer" })
    await expect(
      addMember({ businessId: "biz_1", userId: "u2", actor: userActor("u_viewer"), role: "viewer", now: NOW }),
    ).rejects.toMatchObject({ code: "BUSINESS_FORBIDDEN" })
  })

  it("refuses a second membership row for the same person", async () => {
    await expect(
      addMember({ businessId: "biz_1", userId: "u_owner", actor: OWNER, role: "viewer", now: NOW }),
    ).rejects.toMatchObject({ code: "VALIDATION" })
  })

  it("refuses an unrecognised role", async () => {
    await expect(
      addMember({ businessId: "biz_1", userId: "u2", actor: OWNER, role: "wizard" as never, now: NOW }),
    ).rejects.toMatchObject({ code: "VALIDATION" })
  })

  it("never grants ownership by adding a member", async () => {
    await expect(
      addMember({ businessId: "biz_1", userId: "u2", actor: OWNER, role: "owner", now: NOW }),
    ).rejects.toMatchObject({ code: "VALIDATION" })
  })

  it("refuses a scope containing an application from another business", async () => {
    fakes.applications.docs.push(makeApplication({ id: "app_other", businessId: "biz_2" }))
    await expect(
      addMember({
        businessId: "biz_1",
        userId: "u2",
        actor: OWNER,
        role: "marketer",
        scope: { kind: "applications", applicationIds: ["app_other"] },
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" })
  })

  it("refuses a scope containing an archived application", async () => {
    fakes.applications.docs.push(makeApplication({ archivedAt: NOW }))
    await expect(
      addMember({
        businessId: "biz_1",
        userId: "u2",
        actor: OWNER,
        role: "marketer",
        scope: { kind: "applications", applicationIds: ["app_shop"] },
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" })
  })

  it("refuses an empty or duplicated application scope", async () => {
    await expect(
      addMember({
        businessId: "biz_1",
        userId: "u2",
        actor: OWNER,
        role: "marketer",
        scope: { kind: "applications", applicationIds: [] },
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" })

    fakes.applications.docs.push(makeApplication())
    await expect(
      addMember({
        businessId: "biz_1",
        userId: "u2",
        actor: OWNER,
        role: "marketer",
        scope: { kind: "applications", applicationIds: ["app_shop", "app_shop"] },
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" })
  })

  it("accepts a scope of applications that belong to the business", async () => {
    fakes.applications.docs.push(makeApplication())
    const member = await addMember({
      businessId: "biz_1",
      userId: "u2",
      actor: OWNER,
      role: "marketer",
      scope: { kind: "applications", applicationIds: ["app_shop"] },
      now: NOW,
    })
    expect(member.scope).toEqual({ kind: "applications", applicationIds: ["app_shop"] })
  })

  it("never removes an owner through member management", async () => {
    await expect(removeMember({ businessId: "biz_1", userId: "u_owner", actor: OWNER, now: NOW })).rejects.toMatchObject(
      { code: "VALIDATION" },
    )
  })

  it("removes a member by status and keeps the row", async () => {
    await addMember({ businessId: "biz_1", userId: "u2", actor: OWNER, role: "viewer", now: NOW })
    await removeMember({ businessId: "biz_1", userId: "u2", actor: OWNER, now: NOW })

    expect(fakes.members.docs).toHaveLength(2)
    expect(await resolveMember({ businessId: "biz_1", userId: "u2", actor: OWNER })).toBeNull()
    expect(
      (await listMembers({ businessId: "biz_1", actor: OWNER, includeRemoved: true })).map((m) => m.userId),
    ).toEqual(["u_owner", "u2"])
  })

  it("refuses a removal from a non-member actor", async () => {
    await addMember({ businessId: "biz_1", userId: "u2", actor: OWNER, role: "viewer", now: NOW })
    await expect(
      removeMember({ businessId: "biz_1", userId: "u2", actor: STRANGER, now: NOW }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    expect(await resolveMember({ businessId: "biz_1", userId: "u2", actor: OWNER })).not.toBeNull()
  })
})

describe("reactivation", () => {
  async function seedRemovedMember() {
    await addMember({ businessId: "biz_1", userId: "u2", actor: OWNER, role: "viewer", now: NOW })
    await removeMember({ businessId: "biz_1", userId: "u2", actor: OWNER, now: NOW })
  }

  it("cannot be reached through addMember", async () => {
    await seedRemovedMember()
    await expect(
      addMember({ businessId: "biz_1", userId: "u2", actor: OWNER, role: "marketer", now: NOW + 1 }),
    ).rejects.toMatchObject({ code: "VALIDATION" })
    expect(await resolveMember({ businessId: "biz_1", userId: "u2", actor: OWNER })).toBeNull()
  })

  it("records who reactivated the member and when", async () => {
    await seedRemovedMember()
    const restored = await reactivateMember({
      businessId: "biz_1",
      userId: "u2",
      actor: OWNER,
      role: "marketer",
      scope: { kind: "all" },
      now: NOW + 5,
    })

    expect(restored.status).toBe("active")
    expect(restored.role).toBe("marketer")
    expect(restored.reactivatedBy).toBe("u_owner")
    expect(restored.reactivatedAt).toBe(NOW + 5)
  })

  it("never restores the application scope a removed member used to hold", async () => {
    fakes.applications.docs.push(
      makeApplication({ id: "app_shop", basePath: "/shop" }),
      makeApplication({ id: "app_dash", basePath: "/dashboard" }),
    )
    await addMember({
      businessId: "biz_1",
      userId: "u2",
      actor: OWNER,
      role: "marketer",
      scope: { kind: "applications", applicationIds: ["app_shop"] },
      now: NOW,
    })
    await removeMember({ businessId: "biz_1", userId: "u2", actor: OWNER, now: NOW })

    const restored = await reactivateMember({
      businessId: "biz_1",
      userId: "u2",
      actor: OWNER,
      role: "marketer",
      scope: { kind: "applications", applicationIds: ["app_dash"] },
      now: NOW + 5,
    })

    expect(restored.scope).toEqual({ kind: "applications", applicationIds: ["app_dash"] })
  })

  it("refuses someone who was not removed", async () => {
    await addMember({ businessId: "biz_1", userId: "u2", actor: OWNER, role: "viewer", now: NOW })
    await expect(
      reactivateMember({
        businessId: "biz_1",
        userId: "u2",
        actor: OWNER,
        role: "viewer",
        scope: { kind: "all" },
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("never reactivates anyone into ownership", async () => {
    await seedRemovedMember()
    await expect(
      reactivateMember({
        businessId: "biz_1",
        userId: "u2",
        actor: OWNER,
        role: "owner",
        scope: { kind: "all" },
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" })
  })

  it("refuses a non-member actor", async () => {
    await seedRemovedMember()
    await expect(
      reactivateMember({
        businessId: "biz_1",
        userId: "u2",
        actor: STRANGER,
        role: "viewer",
        scope: { kind: "all" },
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
  })
})

describe("reading membership", () => {
  it("refuses a non-member", async () => {
    await expect(listMembers({ businessId: "biz_1", actor: STRANGER })).rejects.toMatchObject({ code: "NOT_FOUND" })
    await expect(
      resolveMember({ businessId: "biz_1", userId: "u_owner", actor: STRANGER }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("scopes removal to one business", async () => {
    seedBusiness({ id: "biz_2", ownerId: "u9" })
    seedMember({ id: "mem_u9", businessId: "biz_2", userId: "u9" })
    await addMember({ businessId: "biz_2", userId: "u_owner", actor: userActor("u9"), role: "viewer", now: NOW })

    await removeMember({ businessId: "biz_2", userId: "u_owner", actor: userActor("u9"), now: NOW })

    expect(await resolveMember({ businessId: "biz_1", userId: "u_owner", actor: OWNER })).not.toBeNull()
    expect(await resolveMember({ businessId: "biz_2", userId: "u_owner", actor: userActor("u9") })).toBeNull()
  })
})

describe("granting application scope", () => {
  function seedScopedAdmin(applicationIds: string[]) {
    seedMember({
      userId: "u_admin",
      role: "admin",
      scope: { kind: "applications", applicationIds },
    })
  }

  beforeEach(() => {
    fakes.applications.docs.push(
      makeApplication({ id: "app_shop", basePath: "/shop" }),
      makeApplication({ id: "app_dash", basePath: "/dashboard" }),
    )
  })

  it("lets a scoped admin grant an application they hold", async () => {
    seedScopedAdmin(["app_shop"])
    const member = await addMember({
      businessId: "biz_1",
      userId: "u2",
      actor: userActor("u_admin"),
      role: "marketer",
      scope: { kind: "applications", applicationIds: ["app_shop"] },
      now: NOW,
    })
    expect(member.scope).toEqual({ kind: "applications", applicationIds: ["app_shop"] })
  })

  it("refuses an application the actor does not hold", async () => {
    seedScopedAdmin(["app_shop"])
    await expect(
      addMember({
        businessId: "biz_1",
        userId: "u2",
        actor: userActor("u_admin"),
        role: "marketer",
        scope: { kind: "applications", applicationIds: ["app_dash"] },
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "BUSINESS_FORBIDDEN" })
    expect(fakes.members.docs.some((member) => member.userId === "u2")).toBe(false)
  })

  it("refuses to grant the whole business from a scoped membership", async () => {
    seedScopedAdmin(["app_shop"])
    await expect(
      addMember({
        businessId: "biz_1",
        userId: "u2",
        actor: userActor("u_admin"),
        role: "marketer",
        scope: { kind: "all" },
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "BUSINESS_FORBIDDEN" })
  })

  it("refuses the implicit whole-business default from a scoped membership", async () => {
    seedScopedAdmin(["app_shop"])
    await expect(
      addMember({ businessId: "biz_1", userId: "u2", actor: userActor("u_admin"), role: "marketer", now: NOW }),
    ).rejects.toMatchObject({ code: "BUSINESS_FORBIDDEN" })
  })

  it("lets an unscoped admin grant any valid scope", async () => {
    seedMember({ userId: "u_admin_all", role: "admin", scope: { kind: "all" } })
    const member = await addMember({
      businessId: "biz_1",
      userId: "u2",
      actor: userActor("u_admin_all"),
      role: "marketer",
      scope: { kind: "applications", applicationIds: ["app_dash"] },
      now: NOW,
    })
    expect(member.scope).toEqual({ kind: "applications", applicationIds: ["app_dash"] })
  })

  it("still refuses a foreign application before the scope check", async () => {
    seedScopedAdmin(["app_shop"])
    fakes.applications.docs.push(makeApplication({ id: "app_other", businessId: "biz_2" }))
    await expect(
      addMember({
        businessId: "biz_1",
        userId: "u2",
        actor: userActor("u_admin"),
        role: "marketer",
        scope: { kind: "applications", applicationIds: ["app_other"] },
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" })
  })

  it("applies the same rule when reactivating", async () => {
    seedScopedAdmin(["app_shop"])
    await addMember({
      businessId: "biz_1",
      userId: "u2",
      actor: userActor("u_admin"),
      role: "marketer",
      scope: { kind: "applications", applicationIds: ["app_shop"] },
      now: NOW,
    })
    await removeMember({ businessId: "biz_1", userId: "u2", actor: userActor("u_admin"), now: NOW })

    await expect(
      reactivateMember({
        businessId: "biz_1",
        userId: "u2",
        actor: userActor("u_admin"),
        role: "marketer",
        scope: { kind: "applications", applicationIds: ["app_dash"] },
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "BUSINESS_FORBIDDEN" })

    const restored = await reactivateMember({
      businessId: "biz_1",
      userId: "u2",
      actor: userActor("u_admin"),
      role: "marketer",
      scope: { kind: "applications", applicationIds: ["app_shop"] },
      now: NOW,
    })
    expect(restored.status).toBe("active")
  })
})
