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
  const applications = fakeCollection()
  return {
    ensureIndexes: async () => {},
    businessesCol: async () => businesses,
    businessMembersCol: async () => members,
    connectedApplicationsCol: async () => applications,
    __fakes: { businesses, members, applications },
  }
})

vi.mock("@/lib/db/mongodb", async () => {
  const { fakeSession } = await import("@/lib/business/testing/fake-collections")
  return { getMongoClient: async () => ({ startSession: () => fakeSession() }) }
})

import type { BusinessDoc, BusinessMemberDoc, ConnectedApplicationDoc } from "@/lib/types/business"
import type { FakeCollection } from "./testing/fake-collections"
import * as db from "@/lib/db/collections"
import { addMember, removeMember } from "./members"
import { systemActor, userActor } from "./permissions"
import { archiveBusiness, createBusiness, getBusiness, listBusinessesForUser, renameBusiness } from "./service"

interface Fakes {
  businesses: FakeCollection<BusinessDoc>
  members: FakeCollection<BusinessMemberDoc>
  applications: FakeCollection<ConnectedApplicationDoc>
}

const fakes = (db as unknown as { __fakes: Fakes }).__fakes

beforeEach(() => {
  fakes.businesses.docs.length = 0
  fakes.members.docs.length = 0
  fakes.applications.docs.length = 0
})

describe("business creation", () => {
  it("seats the acting user as owner", async () => {
    const business = await createBusiness({ actor: userActor("u1"), name: "Acme", now: 100 })

    expect(business.status).toBe("draft")
    expect(business.ownerId).toBe("u1")
    expect(fakes.members.docs).toHaveLength(1)
    expect(fakes.members.docs[0]).toMatchObject({
      businessId: business.id,
      userId: "u1",
      role: "owner",
      status: "active",
      scope: { kind: "all" },
    })
  })

  it("refuses a system actor", async () => {
    await expect(
      createBusiness({ actor: systemActor("migration"), name: "Acme", now: 100 }),
    ).rejects.toMatchObject({ code: "VALIDATION" })
    expect(fakes.businesses.docs).toHaveLength(0)
  })

  it("suggests a name and records where it came from", async () => {
    const business = await createBusiness({
      actor: userActor("u1"),
      suggestedName: "Acme Rockets",
      suggestedNameSource: "website_title",
      now: 100,
    })
    expect(business.name).toBe("Acme Rockets")
    expect(business.suggestedNameSource).toBe("website_title")
  })

  it("requires a name when there is nothing to suggest", async () => {
    await expect(createBusiness({ actor: userActor("u1"), now: 100 })).rejects.toMatchObject({ code: "VALIDATION" })
  })
})

describe("business operations", () => {
  async function seed(owner = "u1") {
    return createBusiness({ actor: userActor(owner), name: "Acme", now: 100 })
  }

  it("reads a business for a member", async () => {
    const business = await seed()
    const read = await getBusiness({ businessId: business.id, actor: userActor("u1") })
    expect(read.id).toBe(business.id)
  })

  it("refuses to read for a non-member", async () => {
    const business = await seed()
    await expect(getBusiness({ businessId: business.id, actor: userActor("u2") })).rejects.toMatchObject({
      code: "NOT_FOUND",
    })
  })

  it("keeps the suggestion when the founder renames the business", async () => {
    const business = await createBusiness({ actor: userActor("u1"), suggestedName: "acme-site", now: 100 })
    const renamed = await renameBusiness({ businessId: business.id, name: "Acme Inc", actor: userActor("u1"), now: 200 })

    expect(renamed.name).toBe("Acme Inc")
    expect(renamed.suggestedName).toBe("acme-site")
    expect(renamed.updatedAt).toBe(200)
  })

  it("refuses a rename from a member without business.manage", async () => {
    const business = await seed()
    await addMember({ businessId: business.id, userId: "u2", actor: userActor("u1"), role: "viewer", now: 150 })
    await expect(
      renameBusiness({ businessId: business.id, name: "Hijacked", actor: userActor("u2"), now: 200 }),
    ).rejects.toMatchObject({ code: "BUSINESS_FORBIDDEN" })
    expect(fakes.businesses.docs[0].name).toBe("Acme")
  })

  it("refuses writes on a suspended business", async () => {
    const business = await seed()
    fakes.businesses.docs[0].status = "suspended"
    await expect(
      renameBusiness({ businessId: business.id, name: "Acme 2", actor: userActor("u1"), now: 200 }),
    ).rejects.toMatchObject({ code: "BUSINESS_SUSPENDED" })
    expect(fakes.businesses.docs[0].name).toBe("Acme")
  })

  it("refuses writes on an archived business", async () => {
    const business = await seed()
    fakes.businesses.docs[0].status = "archived"
    await expect(
      renameBusiness({ businessId: business.id, name: "Acme 2", actor: userActor("u1"), now: 200 }),
    ).rejects.toMatchObject({ code: "BUSINESS_FORBIDDEN" })
  })

  it("archives by status without deleting anything", async () => {
    const business = await seed()
    const archived = await archiveBusiness({ businessId: business.id, actor: userActor("u1"), now: 300 })

    expect(archived.status).toBe("archived")
    expect(archived.archivedAt).toBe(300)
    expect(fakes.businesses.docs).toHaveLength(1)
    expect(fakes.members.docs).toHaveLength(1)
  })

  it("refuses an archive from a non-member", async () => {
    const business = await seed()
    await expect(
      archiveBusiness({ businessId: business.id, actor: userActor("u2"), now: 300 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    expect(fakes.businesses.docs[0].status).toBe("draft")
  })
})

describe("listing", () => {
  it("returns only the acting user's businesses, newest first", async () => {
    const older = await createBusiness({ actor: userActor("u1"), name: "Older", now: 100 })
    const newer = await createBusiness({ actor: userActor("u1"), name: "Newer", now: 200 })
    await createBusiness({ actor: userActor("u2"), name: "Someone else", now: 300 })

    expect((await listBusinessesForUser({ actor: userActor("u1") })).map((b) => b.id)).toEqual([newer.id, older.id])
    expect(await listBusinessesForUser({ actor: userActor("u_unknown") })).toEqual([])
  })

  it("drops a business from the list once the membership is removed", async () => {
    const business = await createBusiness({ actor: userActor("u1"), name: "Acme", now: 100 })
    await addMember({ businessId: business.id, userId: "u2", actor: userActor("u1"), role: "viewer", now: 150 })
    expect((await listBusinessesForUser({ actor: userActor("u2") })).map((b) => b.id)).toEqual([business.id])

    await removeMember({ businessId: business.id, userId: "u2", actor: userActor("u1"), now: 200 })
    expect(await listBusinessesForUser({ actor: userActor("u2") })).toEqual([])
  })

  it("refuses a system actor", async () => {
    await expect(listBusinessesForUser({ actor: systemActor("migration") })).rejects.toMatchObject({
      code: "VALIDATION",
    })
  })
})

describe("migration stamping", () => {
  it("leaves the stamp absent when a founder creates the business", async () => {
    const business = await createBusiness({ actor: userActor("u1"), name: "Acme", now: 100 })
    expect(business.migration).toBeUndefined()
  })

  it("records the stamp on the business and its owner", async () => {
    const stamp = { id: "mig_1", runId: "run-1", createdAt: 100 }
    const business = await createBusiness({
      actor: userActor("u1"),
      name: "Acme",
      migration: stamp,
      now: 100,
    })

    expect(business.migration?.runId).toBe("run-1")
    expect(fakes.members.docs).toHaveLength(1)
    expect(fakes.members.docs[0].migration?.runId).toBe("run-1")
  })

  it("still seats exactly one owner when a migration creates the business", async () => {
    const business = await createBusiness({
      actor: userActor("u1"),
      name: "Acme",
      migration: { id: "mig_1", runId: "run-1", createdAt: 100 },
      now: 100,
    })
    expect(fakes.businesses.docs).toHaveLength(1)
    expect(fakes.members.docs.filter((member) => member.businessId === business.id)).toHaveLength(1)
  })
})
