import { beforeEach, beforeAll, describe, expect, it, vi } from "vitest"

/**
 * End-to-end journey for a brand-new account (A′.10).
 *
 * Only authentication is stubbed: every other layer is real — route handler,
 * `requireWorkspace`, the rollout read, the rate limiter, the services and the
 * database. That is the point: a founder who signs up after the rollout opens
 * takes exactly this path, and a stub in the middle would hide the seam where
 * the admin toggle meets the API.
 *
 *   scripts/test-replica-set.sh start
 *   MONGODB_REPLICA_URI='mongodb://127.0.0.1:27018/atai_integration?replicaSet=rs0' \
 *     npx vitest run test/integration
 */

const { currentUser } = vi.hoisted(() => ({ currentUser: { id: "user_new" } }))

vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => currentUser,
  getCurrentUser: async () => currentUser,
}))

import { GET as workspaceAccess } from "@/app/api/business/access/route"
import { GET as listBusinesses, POST as createBusinessRoute } from "@/app/api/businesses/route"
import {
  DELETE as archiveBusinessRoute,
  GET as getBusinessRoute,
  PATCH as renameBusinessRoute,
} from "@/app/api/businesses/[businessId]/route"
import { POST as restoreBusinessRoute } from "@/app/api/businesses/[businessId]/restore/route"
import { POST as createApplicationRoute } from "@/app/api/businesses/[businessId]/applications/route"
import { DELETE as archiveApplicationRoute } from "@/app/api/businesses/[businessId]/applications/[applicationId]/route"
import { POST as restoreApplicationRoute } from "@/app/api/businesses/[businessId]/applications/[applicationId]/restore/route"
import {
  businessDomainsCol,
  businessMembersCol,
  businessRolloutCol,
  businessesCol,
  connectedApplicationsCol,
  ensureIndexes,
  projectsCol,
  rateLimitsCol,
} from "@/lib/db/collections"
import { getMongoClient } from "@/lib/db/mongodb"
import { resetBusinessRolloutCacheForTests, updateBusinessRollout } from "@/lib/business/flags"
import { requireWorkspace } from "@/lib/business/http"
import { resetMemoryRateLimitForTests } from "@/lib/auth/rate-limit"

const REPLICA_URI = process.env.MONGODB_REPLICA_URI

/**
 * This file wipes the business collections between cases, so it cannot share a
 * database with the migration test that runs beside it. Same replica set, own
 * database.
 */
function isolatedUri(uri: string): string {
  const [target, ...options] = uri.split("?")
  const match = target.match(/^(mongodb(?:\+srv)?:\/\/[^/]+)(?:\/([^/]*))?$/)
  if (!match) return uri
  const [, authority, name] = match
  return `${authority}/${name || "atai"}_flow${options.length > 0 ? `?${options.join("?")}` : ""}`
}

function json(body: unknown): Request {
  return new Request("http://localhost/api/businesses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

const params = <T extends object>(value: T) => ({ params: Promise.resolve(value) })

async function body(response: Response) {
  return (await response.json()) as { ok: boolean; data?: Record<string, unknown>; error?: { code?: string } }
}

describe.skipIf(!REPLICA_URI)("a new account walks the connected-business journey", () => {
  beforeAll(async () => {
    process.env.MONGODB_URI = isolatedUri(REPLICA_URI!)
    const client = await getMongoClient()
    const db = client.db()
    const hello = await db.admin().command({ hello: 1 })
    if (typeof hello.setName !== "string" || hello.setName.length === 0) {
      throw new Error("MONGODB_REPLICA_URI must point at a replica set.")
    }
    await ensureIndexes()
  })

  beforeEach(async () => {
    currentUser.id = "user_new"
    resetBusinessRolloutCacheForTests()
    resetMemoryRateLimitForTests()
    await Promise.all([
      (await businessesCol()).deleteMany({}),
      (await businessMembersCol()).deleteMany({}),
      (await connectedApplicationsCol()).deleteMany({}),
      (await projectsCol()).deleteMany({}),
      (await businessDomainsCol()).deleteMany({}),
      (await businessRolloutCol()).deleteMany({}),
      (await rateLimitsCol()).deleteMany({}),
    ])
  })

  it("answers 404 before the rollout opens, and works once an admin opens it", async () => {
    expect(await body(await workspaceAccess())).toMatchObject({ data: { enabled: false } })
    expect((await listBusinesses()).status).toBe(404)
    expect((await createBusinessRoute(json({ name: "Acme" }))).status).toBe(404)
    expect((await getBusinessRoute(json({}), params({ businessId: "biz_any" }))).status).toBe(404)

    await updateBusinessRollout({ mode: "all" }, "admin-1")

    expect(await body(await workspaceAccess())).toMatchObject({ data: { enabled: true } })

    const created = await createBusinessRoute(json({ name: "Acme Bakery" }))
    expect(created.status).toBe(201)
    const { business } = (await body(created)).data as { business: { id: string; name: string; status: string } }
    expect(business.name).toBe("Acme Bakery")
    expect(business.status).toBe("draft")

    // The creator is seated as owner, which is the only row that grants access.
    const members = await (await businessMembersCol()).find({ businessId: business.id }).toArray()
    expect(members).toHaveLength(1)
    expect(members[0]).toMatchObject({ userId: "user_new", role: "owner", status: "active" })
  })

  it("refuses an empty name", async () => {
    await updateBusinessRollout({ mode: "all" }, "admin-1")

    const response = await createBusinessRoute(json({ name: "   " }))

    expect(response.status).toBe(422)
    expect(await (await businessesCol()).countDocuments({})).toBe(0)
  })

  it("connects, archives and restores an application", async () => {
    await updateBusinessRollout({ mode: "all" }, "admin-1")
    const created = await body(await createBusinessRoute(json({ name: "Acme Bakery" })))
    const businessId = (created.data!.business as { id: string }).id
    const route = params({ businessId })

    const first = await createApplicationRoute(
      json({ name: "Shop", kind: "storefront", url: "https://acme.example/shop" }),
      route,
    )
    expect(first.status).toBe(201)
    const applicationId = ((await body(first)).data!.application as { id: string }).id

    // The same origin twice inside one business is a conflict, not a duplicate.
    const duplicate = await createApplicationRoute(
      json({ name: "Shop again", kind: "storefront", url: "https://acme.example/shop" }),
      route,
    )
    expect(duplicate.status).toBe(409)

    const appRoute = params({ businessId, applicationId })
    expect((await archiveApplicationRoute(json({}), appRoute)).status).toBe(200)

    const afterArchive = await body(await getBusinessRoute(json({}), route))
    expect(afterArchive.data!.applications).toEqual([])

    expect((await restoreApplicationRoute(json({}), appRoute)).status).toBe(200)

    const afterRestore = await body(await getBusinessRoute(json({}), route))
    expect((afterRestore.data!.applications as { id: string }[]).map((item) => item.id)).toEqual([applicationId])
  })

  it("blocks writes on an archived business until it is restored", async () => {
    await updateBusinessRollout({ mode: "all" }, "admin-1")
    const created = await body(await createBusinessRoute(json({ name: "Acme Bakery" })))
    const businessId = (created.data!.business as { id: string }).id
    const route = params({ businessId })

    expect((await archiveBusinessRoute(json({}), route)).status).toBe(200)
    expect((await renameBusinessRoute(json({ name: "New name" }), route)).status).toBe(403)
    expect((await createApplicationRoute(json({ name: "Shop", kind: "other", url: "acme.example" }), route)).status).toBe(403)

    expect((await restoreBusinessRoute(json({}), route)).status).toBe(200)
    expect((await renameBusinessRoute(json({ name: "New name" }), route)).status).toBe(200)
  })

  it("hides one account's business from another", async () => {
    await updateBusinessRollout({ mode: "all" }, "admin-1")
    const created = await body(await createBusinessRoute(json({ name: "Acme Bakery" })))
    const businessId = (created.data!.business as { id: string }).id

    currentUser.id = "user_other"

    expect((await getBusinessRoute(json({}), params({ businessId }))).status).toBe(404)
    expect(await body(await listBusinesses())).toMatchObject({ data: { businesses: [] } })
  })

  it("closes the write bucket after its limit and keeps reads open", async () => {
    await updateBusinessRollout({ mode: "all" }, "admin-1")

    for (let index = 0; index < 60; index += 1) {
      await requireWorkspace("user_new", "write")
    }
    await expect(requireWorkspace("user_new", "write")).rejects.toMatchObject({ code: "RATE_LIMITED" })

    // A write route now answers 429 with a Retry-After, and reads are untouched.
    const refused = await createBusinessRoute(json({ name: "Too many" }))
    expect(refused.status).toBe(429)
    expect(Number(refused.headers.get("Retry-After"))).toBeGreaterThan(0)

    await expect(requireWorkspace("user_new", "read")).resolves.toBeUndefined()
  })
})
