import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db/collections", async () => {
  const { fakeCollection } = await import("@/lib/business/testing/fake-collections")
  const members = fakeCollection({ unique: [["businessId", "userId"]] })
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
    businessMembersCol: async () => members,
    connectedApplicationsCol: async () => applications,
    __fakes: { members, applications },
  }
})

import type { BusinessMemberDoc, ConnectedApplicationDoc } from "@/lib/types/business"
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

interface Fakes {
  members: FakeCollection<BusinessMemberDoc>
  applications: FakeCollection<ConnectedApplicationDoc>
}

const fakes = (db as unknown as { __fakes: Fakes }).__fakes
const NOW = 1_700_000_000_000

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
  fakes.members.docs.length = 0
  fakes.applications.docs.length = 0
})

describe("membership", () => {
  it("creates an active owner with full scope", async () => {
    const owner = await addOwner({ businessId: "biz_1", userId: "u1", now: NOW })
    expect(owner.role).toBe("owner")
    expect(owner.status).toBe("active")
    expect(owner.scope).toEqual({ kind: "all" })
    expect(fakes.members.docs).toHaveLength(1)
  })

  it("refuses a second membership row for the same person", async () => {
    await addOwner({ businessId: "biz_1", userId: "u1", now: NOW })
    await expect(addMember({ businessId: "biz_1", userId: "u1", role: "viewer", now: NOW })).rejects.toMatchObject({
      code: "VALIDATION",
    })
    expect(fakes.members.docs).toHaveLength(1)
  })

  it("refuses an unrecognised role", async () => {
    await expect(
      addMember({ businessId: "biz_1", userId: "u2", role: "wizard" as never, now: NOW }),
    ).rejects.toMatchObject({ code: "VALIDATION" })
  })

  it("never grants ownership by adding a member", async () => {
    await addOwner({ businessId: "biz_1", userId: "u1", now: NOW })
    await expect(
      addMember({ businessId: "biz_1", userId: "u2", role: "owner", now: NOW }),
    ).rejects.toMatchObject({ code: "VALIDATION" })
    expect(await resolveMember("biz_1", "u2")).toBeNull()
  })

  it("refuses a scope containing an application from another business", async () => {
    fakes.applications.docs.push(makeApplication({ id: "app_other", businessId: "biz_2" }))
    await expect(
      addMember({
        businessId: "biz_1",
        userId: "u2",
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
      role: "marketer",
      scope: { kind: "applications", applicationIds: ["app_shop"] },
      now: NOW,
    })
    expect(member.scope).toEqual({ kind: "applications", applicationIds: ["app_shop"] })
  })

  it("never removes an owner through member management", async () => {
    await addOwner({ businessId: "biz_1", userId: "u1", now: NOW })
    await expect(removeMember({ businessId: "biz_1", userId: "u1", now: NOW })).rejects.toMatchObject({
      code: "VALIDATION",
    })
    expect(await resolveMember("biz_1", "u1")).not.toBeNull()
  })

  it("removes a member by status and keeps the row", async () => {
    await addOwner({ businessId: "biz_1", userId: "u1", now: NOW })
    await addMember({ businessId: "biz_1", userId: "u2", role: "viewer", now: NOW })

    await removeMember({ businessId: "biz_1", userId: "u2", now: NOW })

    expect(fakes.members.docs).toHaveLength(2)
    expect(await resolveMember("biz_1", "u2")).toBeNull()
    expect((await listMembers("biz_1", { includeRemoved: true })).map((m) => m.userId)).toEqual(["u1", "u2"])
    expect((await listMembers("biz_1")).map((m) => m.userId)).toEqual(["u1"])
  })

  it("does not let addMember silently reactivate a removed member", async () => {
    await addOwner({ businessId: "biz_1", userId: "u1", now: NOW })
    await addMember({ businessId: "biz_1", userId: "u2", role: "viewer", now: NOW })
    await removeMember({ businessId: "biz_1", userId: "u2", now: NOW })

    await expect(
      addMember({ businessId: "biz_1", userId: "u2", role: "marketer", now: NOW + 1 }),
    ).rejects.toMatchObject({ code: "VALIDATION" })

    expect(await resolveMember("biz_1", "u2")).toBeNull()
  })

  it("reactivates explicitly, recording who and when", async () => {
    await addOwner({ businessId: "biz_1", userId: "u1", now: NOW })
    await addMember({ businessId: "biz_1", userId: "u2", role: "viewer", now: NOW })
    await removeMember({ businessId: "biz_1", userId: "u2", now: NOW })

    const restored = await reactivateMember({
      businessId: "biz_1",
      userId: "u2",
      role: "marketer",
      scope: { kind: "all" },
      reactivatedBy: "u1",
      now: NOW + 5,
    })

    expect(restored.status).toBe("active")
    expect(restored.role).toBe("marketer")
    expect(restored.reactivatedBy).toBe("u1")
    expect(restored.reactivatedAt).toBe(NOW + 5)
    expect(fakes.members.docs).toHaveLength(2)
    expect((await resolveMember("biz_1", "u2"))?.role).toBe("marketer")
  })

  it("never restores the application scope a removed member used to hold", async () => {
    fakes.applications.docs.push(
      makeApplication({ id: "app_shop", basePath: "/shop" }),
      makeApplication({ id: "app_dash", basePath: "/dashboard" }),
    )
    await addOwner({ businessId: "biz_1", userId: "u1", now: NOW })
    await addMember({
      businessId: "biz_1",
      userId: "u2",
      role: "marketer",
      scope: { kind: "applications", applicationIds: ["app_shop"] },
      now: NOW,
    })
    await removeMember({ businessId: "biz_1", userId: "u2", now: NOW })

    const restored = await reactivateMember({
      businessId: "biz_1",
      userId: "u2",
      role: "marketer",
      scope: { kind: "applications", applicationIds: ["app_dash"] },
      reactivatedBy: "u1",
      now: NOW + 5,
    })

    expect(restored.scope).toEqual({ kind: "applications", applicationIds: ["app_dash"] })
  })

  it("refuses to reactivate someone who was not removed", async () => {
    await addOwner({ businessId: "biz_1", userId: "u1", now: NOW })
    await addMember({ businessId: "biz_1", userId: "u2", role: "viewer", now: NOW })
    await expect(
      reactivateMember({
        businessId: "biz_1",
        userId: "u2",
        role: "viewer",
        scope: { kind: "all" },
        reactivatedBy: "u1",
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("never reactivates anyone into ownership", async () => {
    await addOwner({ businessId: "biz_1", userId: "u1", now: NOW })
    await addMember({ businessId: "biz_1", userId: "u2", role: "viewer", now: NOW })
    await removeMember({ businessId: "biz_1", userId: "u2", now: NOW })
    await expect(
      reactivateMember({
        businessId: "biz_1",
        userId: "u2",
        role: "owner",
        scope: { kind: "all" },
        reactivatedBy: "u1",
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" })
  })

  it("scopes membership removal to one business", async () => {
    await addOwner({ businessId: "biz_1", userId: "u1", now: NOW })
    await addOwner({ businessId: "biz_2", userId: "u9", now: NOW })
    await addMember({ businessId: "biz_2", userId: "u1", role: "viewer", now: NOW })

    await removeMember({ businessId: "biz_2", userId: "u1", now: NOW })

    expect(await resolveMember("biz_1", "u1")).not.toBeNull()
    expect(await resolveMember("biz_2", "u1")).toBeNull()
  })
})
