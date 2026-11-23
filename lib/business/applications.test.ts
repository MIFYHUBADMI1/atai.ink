import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db/collections", async () => {
  const { fakeCollection } = await import("@/lib/business/testing/fake-collections")
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
    connectedApplicationsCol: async () => applications,
    __fakes: { applications },
  }
})

import type { ConnectedApplicationDoc } from "@/lib/types/business"
import type { FakeCollection } from "./testing/fake-collections"
import * as db from "@/lib/db/collections"
import { applicationAddress, archiveApplication, createApplication, listApplications } from "./applications"

interface Fakes {
  applications: FakeCollection<ConnectedApplicationDoc>
}

const fakes = (db as unknown as { __fakes: Fakes }).__fakes
const NOW = 1_700_000_000_000

beforeEach(() => {
  fakes.applications.docs.length = 0
})

describe("connected applications", () => {
  it("normalises the host and the path from one address", async () => {
    const app = await createApplication({
      businessId: "biz_1",
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
      name: "Shop",
      kind: "storefront",
      url: "https://example.com/ignored",
      basePath: "/shop",
      now: NOW,
    })
    expect(app.basePath).toBe("/shop")
  })

  it("treats two spellings of one origin as one application", async () => {
    await createApplication({ businessId: "biz_1", name: "A", kind: "other", url: "example.com/shop/", now: NOW })
    await expect(
      createApplication({ businessId: "biz_1", name: "B", kind: "other", url: "https://EXAMPLE.com//shop", now: NOW }),
    ).rejects.toMatchObject({ code: "APPLICATION_ALREADY_EXISTS" })
    expect(fakes.applications.docs).toHaveLength(1)
  })

  it("allows several applications on one hostname, sharing one trust domain", async () => {
    const shop = await createApplication({ businessId: "biz_1", name: "Shop", kind: "storefront", url: "example.com/shop", now: NOW })
    const dash = await createApplication({ businessId: "biz_1", name: "Dash", kind: "saas_app", url: "example.com/dashboard", now: NOW })
    const root = await createApplication({ businessId: "biz_1", name: "Site", kind: "marketing_site", url: "example.com", now: NOW })

    expect(new Set([shop.trustDomain, dash.trustDomain, root.trustDomain])).toEqual(new Set(["example.com"]))
    expect(shop.basePath).toBe("/shop")
    expect(dash.basePath).toBe("/dashboard")
    expect(root.basePath).toBe("")
  })

  it("keeps the same origin available in another business", async () => {
    await createApplication({ businessId: "biz_1", name: "A", kind: "other", url: "example.com", now: NOW })
    const other = await createApplication({ businessId: "biz_2", name: "B", kind: "other", url: "example.com", now: NOW })
    expect(other.businessId).toBe("biz_2")
  })

  it("archives one application without touching its siblings", async () => {
    const shop = await createApplication({ businessId: "biz_1", name: "Shop", kind: "storefront", url: "example.com/shop", now: NOW })
    const dash = await createApplication({ businessId: "biz_1", name: "Dash", kind: "saas_app", url: "example.com/dashboard", now: NOW })

    const archived = await archiveApplication({ businessId: "biz_1", applicationId: shop.id, now: NOW + 1 })

    expect(archived.archivedAt).toBe(NOW + 1)
    expect(fakes.applications.docs).toHaveLength(2)
    expect(fakes.applications.docs.find((doc) => doc.id === dash.id)?.archivedAt).toBeUndefined()
    expect((await listApplications("biz_1")).map((app) => app.id)).toEqual([dash.id])
    expect((await listApplications("biz_1", { includeArchived: true })).map((app) => app.id)).toEqual([shop.id, dash.id])
  })

  it("frees an origin once its application is archived", async () => {
    const first = await createApplication({ businessId: "biz_1", name: "A", kind: "other", url: "example.com", now: NOW })
    await archiveApplication({ businessId: "biz_1", applicationId: first.id, now: NOW + 1 })
    const replacement = await createApplication({ businessId: "biz_1", name: "B", kind: "other", url: "example.com", now: NOW + 2 })
    expect(replacement.id).not.toBe(first.id)
    expect(fakes.applications.docs).toHaveLength(2)
  })

  it("refuses to archive an application of another business", async () => {
    const app = await createApplication({ businessId: "biz_1", name: "A", kind: "other", url: "example.com", now: NOW })
    await expect(
      archiveApplication({ businessId: "biz_2", applicationId: app.id, now: NOW }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    expect(fakes.applications.docs[0].archivedAt).toBeUndefined()
  })

  it("rejects an unusable address or path", async () => {
    await expect(
      createApplication({ businessId: "biz_1", name: "A", kind: "other", url: "not a url", now: NOW }),
    ).rejects.toMatchObject({ code: "VALIDATION" })

    await expect(
      createApplication({ businessId: "biz_1", name: "A", kind: "other", url: "example.com", basePath: "/a?b=1", now: NOW }),
    ).rejects.toMatchObject({ code: "VALIDATION" })

    await expect(
      createApplication({ businessId: "biz_1", name: "   ", kind: "other", url: "example.com", now: NOW }),
    ).rejects.toMatchObject({ code: "VALIDATION" })

    await expect(
      createApplication({ businessId: "biz_1", name: "A", kind: "spaceship" as never, url: "example.com", now: NOW }),
    ).rejects.toMatchObject({ code: "VALIDATION" })
  })
})
