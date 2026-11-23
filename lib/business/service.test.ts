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
  const members = fakeCollection({ unique: [["businessId", "userId"]] })
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
import { archiveBusiness, createBusiness, listBusinessesForUser, renameBusiness } from "./service"

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

describe("business lifecycle", () => {
  it("creates the business and its owner membership together", async () => {
    const business = await createBusiness({ ownerId: "u1", name: "Acme", now: 100 })

    expect(business.status).toBe("draft")
    expect(business.schemaVersion).toBe(1)
    expect(fakes.businesses.docs).toHaveLength(1)
    expect(fakes.members.docs).toHaveLength(1)
    expect(fakes.members.docs[0]).toMatchObject({
      businessId: business.id,
      userId: "u1",
      role: "owner",
      status: "active",
      scope: { kind: "all" },
    })
  })

  it("suggests a name and records where it came from", async () => {
    const business = await createBusiness({
      ownerId: "u1",
      suggestedName: "Acme Rockets",
      suggestedNameSource: "website_title",
      now: 100,
    })
    expect(business.name).toBe("Acme Rockets")
    expect(business.suggestedName).toBe("Acme Rockets")
    expect(business.suggestedNameSource).toBe("website_title")
  })

  it("requires a name when there is nothing to suggest", async () => {
    await expect(createBusiness({ ownerId: "u1", now: 100 })).rejects.toMatchObject({ code: "VALIDATION" })
  })

  it("keeps the suggestion when the founder renames the business", async () => {
    const business = await createBusiness({ ownerId: "u1", suggestedName: "acme-site", now: 100 })
    const renamed = await renameBusiness({ businessId: business.id, name: "Acme Inc", now: 200 })

    expect(renamed.name).toBe("Acme Inc")
    expect(renamed.suggestedName).toBe("acme-site")
    expect(renamed.updatedAt).toBe(200)
  })

  it("archives by status without deleting anything", async () => {
    const business = await createBusiness({ ownerId: "u1", name: "Acme", now: 100 })
    const archived = await archiveBusiness({ businessId: business.id, now: 300 })

    expect(archived.status).toBe("archived")
    expect(archived.archivedAt).toBe(300)
    expect(fakes.businesses.docs).toHaveLength(1)
    expect(fakes.members.docs).toHaveLength(1)
  })

  it("lists only the businesses the user still belongs to, newest first", async () => {
    const older = await createBusiness({ ownerId: "u1", name: "Older", now: 100 })
    const newer = await createBusiness({ ownerId: "u1", name: "Newer", now: 200 })
    await createBusiness({ ownerId: "u2", name: "Someone else", now: 300 })

    expect((await listBusinessesForUser("u1")).map((b) => b.id)).toEqual([newer.id, older.id])
    expect(await listBusinessesForUser("u_unknown")).toEqual([])
  })

  it("drops a business from the list once the membership is removed", async () => {
    const business = await createBusiness({ ownerId: "u1", name: "Acme", now: 100 })
    await addMember({ businessId: business.id, userId: "u2", role: "viewer", now: 150 })
    expect((await listBusinessesForUser("u2")).map((b) => b.id)).toEqual([business.id])

    await removeMember({ businessId: business.id, userId: "u2", now: 200 })
    expect(await listBusinessesForUser("u2")).toEqual([])
  })
})
