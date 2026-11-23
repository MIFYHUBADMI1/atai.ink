import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db/collections", async () => {
  const { fakeCollection } = await import("@/lib/business/testing/fake-collections")
  const businesses = fakeCollection()
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
import { applicationAddress, archiveApplication, createApplication, listApplications } from "./applications"
import { userActor } from "./permissions"

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

beforeEach(() => {
  fakes.businesses.docs.length = 0
  fakes.members.docs.length = 0
  fakes.applications.docs.length = 0
  seedBusiness()
  seedMember()
})

describe("connected applications", () => {
  it("normalises the host and the path from one address", async () => {
    const app = await createApplication({
      businessId: "biz_1",
      actor: OWNER,
      name: "Marketing",
      kind: "marketing_site",
      url: "https://Example.COM/shop/",
      now: NOW,
    })
    expect(app.hostname).toBe("example.com")
    expect(app.basePath).toBe("/shop")
    expect(app.trustDomain).toBe("example.com")
    expect(applicationAddress(app)).toBe("example.com/shop")
  })

  it("keeps the URL's own path when no base path is given", async () => {
    const app = await createApplication({
      businessId: "biz_1",
      actor: OWNER,
      name: "Dashboard",
      kind: "saas_app",
      url: "example.com/dashboard",
      now: NOW,
    })
    expect(app.basePath).toBe("/dashboard")
  })

  it("lets an explicit base path win over the URL's path", async () => {
    const app = await createApplication({
      businessId: "biz_1",
      actor: OWNER,
      name: "Shop",
      kind: "storefront",
      url: "https://example.com/ignored",
      basePath: "/shop",
      now: NOW,
    })
    expect(app.basePath).toBe("/shop")
  })

  it("treats two spellings of one origin as one application", async () => {
    await createApplication({ businessId: "biz_1", actor: OWNER, name: "A", kind: "other", url: "example.com/shop/", now: NOW })
    await expect(
      createApplication({ businessId: "biz_1", actor: OWNER, name: "B", kind: "other", url: "https://EXAMPLE.com//shop", now: NOW }),
    ).rejects.toMatchObject({ code: "APPLICATION_ALREADY_EXISTS" })
    expect(fakes.applications.docs).toHaveLength(1)
  })

  it("allows several applications on one hostname, sharing one trust domain", async () => {
    const shop = await createApplication({ businessId: "biz_1", actor: OWNER, name: "Shop", kind: "storefront", url: "example.com/shop", now: NOW })
    const dash = await createApplication({ businessId: "biz_1", actor: OWNER, name: "Dash", kind: "saas_app", url: "example.com/dashboard", now: NOW })
    const root = await createApplication({ businessId: "biz_1", actor: OWNER, name: "Site", kind: "marketing_site", url: "example.com", now: NOW })

    expect(new Set([shop.trustDomain, dash.trustDomain, root.trustDomain])).toEqual(new Set(["example.com"]))
    expect(shop.basePath).toBe("/shop")
    expect(dash.basePath).toBe("/dashboard")
    expect(root.basePath).toBe("")
  })

  it("keeps the same origin available in another business", async () => {
    seedBusiness({ id: "biz_2", ownerId: "u_owner" })
    seedMember({ id: "mem_owner_biz2", businessId: "biz_2" })
    await createApplication({ businessId: "biz_1", actor: OWNER, name: "A", kind: "other", url: "example.com", now: NOW })
    const other = await createApplication({ businessId: "biz_2", actor: OWNER, name: "B", kind: "other", url: "example.com", now: NOW })
    expect(other.businessId).toBe("biz_2")
  })

  it("archives one application without touching its siblings", async () => {
    const shop = await createApplication({ businessId: "biz_1", actor: OWNER, name: "Shop", kind: "storefront", url: "example.com/shop", now: NOW })
    const dash = await createApplication({ businessId: "biz_1", actor: OWNER, name: "Dash", kind: "saas_app", url: "example.com/dashboard", now: NOW })

    const archived = await archiveApplication({ businessId: "biz_1", applicationId: shop.id, actor: OWNER, now: NOW + 1 })

    expect(archived.archivedAt).toBe(NOW + 1)
    expect(fakes.applications.docs).toHaveLength(2)
    expect(fakes.applications.docs.find((doc) => doc.id === dash.id)?.archivedAt).toBeUndefined()
    expect((await listApplications({ businessId: "biz_1", actor: OWNER })).map((app) => app.id)).toEqual([dash.id])
    expect(
      (await listApplications({ businessId: "biz_1", actor: OWNER, includeArchived: true })).map((app) => app.id),
    ).toEqual([shop.id, dash.id])
  })

  it("frees an origin once its application is archived", async () => {
    const first = await createApplication({ businessId: "biz_1", actor: OWNER, name: "A", kind: "other", url: "example.com", now: NOW })
    await archiveApplication({ businessId: "biz_1", applicationId: first.id, actor: OWNER, now: NOW + 1 })
    const replacement = await createApplication({ businessId: "biz_1", actor: OWNER, name: "B", kind: "other", url: "example.com", now: NOW + 2 })
    expect(replacement.id).not.toBe(first.id)
    expect(fakes.applications.docs).toHaveLength(2)
  })

  it("refuses to archive an application of another business", async () => {
    const app = await createApplication({ businessId: "biz_1", actor: OWNER, name: "A", kind: "other", url: "example.com", now: NOW })
    seedBusiness({ id: "biz_2", ownerId: "u_owner" })
    seedMember({ id: "mem_owner_biz2", businessId: "biz_2" })
    await expect(
      archiveApplication({ businessId: "biz_2", applicationId: app.id, actor: OWNER, now: NOW }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    expect(fakes.applications.docs[0].archivedAt).toBeUndefined()
  })

  it("stores a canonical address instead of the typed string", async () => {
    const app = await createApplication({
      businessId: "biz_1",
      actor: OWNER,
      name: "Shop",
      kind: "storefront",
      url: "HTTPS://Example.COM/shop/",
      now: NOW,
    })
    expect(app.primaryUrl).toBe("https://example.com/shop")
  })

  it("refuses an address carrying credentials", async () => {
    await expect(
      createApplication({
        businessId: "biz_1",
        actor: OWNER,
        name: "Shop",
        kind: "storefront",
        url: "https://user:secret@example.com/shop",
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" })
    expect(fakes.applications.docs).toHaveLength(0)
  })

  it("refuses a scheme other than http or https", async () => {
    for (const url of ["ftp://example.com", "data://example.com/x"]) {
      await expect(
        createApplication({ businessId: "biz_1", actor: OWNER, name: "A", kind: "other", url, now: NOW }),
      ).rejects.toMatchObject({ code: "VALIDATION" })
    }
    expect(fakes.applications.docs).toHaveLength(0)
  })

  it("rejects an unusable address or path", async () => {
    await expect(
      createApplication({ businessId: "biz_1", actor: OWNER, name: "A", kind: "other", url: "not a url", now: NOW }),
    ).rejects.toMatchObject({ code: "VALIDATION" })

    await expect(
      createApplication({ businessId: "biz_1", actor: OWNER, name: "A", kind: "other", url: "example.com", basePath: "/a?b=1", now: NOW }),
    ).rejects.toMatchObject({ code: "VALIDATION" })

    await expect(
      createApplication({ businessId: "biz_1", actor: OWNER, name: "   ", kind: "other", url: "example.com", now: NOW }),
    ).rejects.toMatchObject({ code: "VALIDATION" })

    await expect(
      createApplication({ businessId: "biz_1", actor: OWNER, name: "A", kind: "spaceship" as never, url: "example.com", now: NOW }),
    ).rejects.toMatchObject({ code: "VALIDATION" })
  })
})

describe("application authorisation", () => {
  it("refuses a non-member", async () => {
    await expect(
      createApplication({ businessId: "biz_1", actor: STRANGER, name: "A", kind: "other", url: "example.com", now: NOW }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    await expect(
      listApplications({ businessId: "biz_1", actor: STRANGER }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    expect(fakes.applications.docs).toHaveLength(0)
  })

  it("refuses a member without apps.manage", async () => {
    seedMember({ userId: "u_viewer", role: "viewer" })
    await expect(
      createApplication({
        businessId: "biz_1",
        actor: userActor("u_viewer"),
        name: "A",
        kind: "other",
        url: "example.com",
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "BUSINESS_FORBIDDEN" })
    expect(fakes.applications.docs).toHaveLength(0)
  })

  it("refuses an application outside a member's scope", async () => {
    const shop = await createApplication({ businessId: "biz_1", actor: OWNER, name: "Shop", kind: "storefront", url: "example.com/shop", now: NOW })
    const dash = await createApplication({ businessId: "biz_1", actor: OWNER, name: "Dash", kind: "saas_app", url: "example.com/dashboard", now: NOW })
    seedMember({
      userId: "u_scoped",
      role: "developer",
      scope: { kind: "applications", applicationIds: [shop.id] },
    })

    await expect(
      archiveApplication({ businessId: "biz_1", applicationId: dash.id, actor: userActor("u_scoped"), now: NOW }),
    ).rejects.toMatchObject({ code: "BUSINESS_FORBIDDEN" })

    const archived = await archiveApplication({
      businessId: "biz_1",
      applicationId: shop.id,
      actor: userActor("u_scoped"),
      now: NOW,
    })
    expect(archived.archivedAt).toBe(NOW)
  })

  it("lists only the applications inside a member's scope", async () => {
    const shop = await createApplication({ businessId: "biz_1", actor: OWNER, name: "Shop", kind: "storefront", url: "example.com/shop", now: NOW })
    const dash = await createApplication({ businessId: "biz_1", actor: OWNER, name: "Dash", kind: "saas_app", url: "example.com/dashboard", now: NOW })
    seedMember({
      userId: "u_scoped",
      role: "developer",
      scope: { kind: "applications", applicationIds: [shop.id] },
    })

    const listed = await listApplications({ businessId: "biz_1", actor: userActor("u_scoped") })
    expect(listed.map((app) => app.id)).toEqual([shop.id])
    expect(listed.map((app) => app.id)).not.toContain(dash.id)
  })

  it("refuses to act on an archived application", async () => {
    const shop = await createApplication({ businessId: "biz_1", actor: OWNER, name: "Shop", kind: "storefront", url: "example.com/shop", now: NOW })
    await archiveApplication({ businessId: "biz_1", applicationId: shop.id, actor: OWNER, now: NOW })
    await expect(
      archiveApplication({ businessId: "biz_1", applicationId: shop.id, actor: OWNER, now: NOW + 1 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("refuses to write to a suspended business", async () => {
    fakes.businesses.docs[0].status = "suspended"
    await expect(
      createApplication({ businessId: "biz_1", actor: OWNER, name: "A", kind: "other", url: "example.com", now: NOW }),
    ).rejects.toMatchObject({ code: "BUSINESS_SUSPENDED" })
  })

  it("refuses to write to an archived business", async () => {
    fakes.businesses.docs[0].status = "archived"
    await expect(
      createApplication({ businessId: "biz_1", actor: OWNER, name: "A", kind: "other", url: "example.com", now: NOW }),
    ).rejects.toMatchObject({ code: "BUSINESS_FORBIDDEN" })
  })
})
