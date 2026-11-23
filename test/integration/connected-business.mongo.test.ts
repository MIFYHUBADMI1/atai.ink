import type { Collection } from "mongodb"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  businessDomainsCol,
  businessMembersCol,
  businessesCol,
  connectedApplicationsCol,
  ensureIndexes,
  projectsCol,
} from "@/lib/db/collections"
import { getMongoClient } from "@/lib/db/mongodb"
import { addMember, addOwner } from "@/lib/business/members"
import { systemActor, userActor } from "@/lib/business/permissions"
import { createBusiness } from "@/lib/business/service"
import { migrateConnectedBusinesses } from "@/lib/connected-business/migrate"
import { rollbackMigration } from "@/lib/connected-business/rollback"

/**
 * Real MongoDB replica-set verification (A′.4).
 *
 * These tests run the production services against a real `mongod` in replica-set
 * mode: real collections, real transactions, real indexes built by
 * `ensureIndexes`. Nothing here is mocked or faked.
 *
 * They are skipped unless `MONGODB_REPLICA_URI` is set, so the ordinary suite
 * stays fast and honest — a skipped run is reported as skipped, never as a pass.
 *
 *   scripts/test-replica-set.sh start
 *   MONGODB_REPLICA_URI='mongodb://127.0.0.1:27018/atai_integration?replicaSet=rs0' \
 *     npx vitest run test/integration
 */

const REPLICA_URI = process.env.MONGODB_REPLICA_URI

describe.skipIf(!REPLICA_URI)("connected business on a real replica set", () => {
  let db: ReturnType<Awaited<ReturnType<typeof getMongoClient>>["db"]>

  beforeAll(async () => {
    process.env.MONGODB_URI = REPLICA_URI
    const client = await getMongoClient()
    db = client.db()

    const hello = await db.admin().command({ hello: 1 })
    if (typeof hello.setName !== "string" || hello.setName.length === 0) {
      throw new Error("MONGODB_REPLICA_URI must point at a replica set; transactions are unavailable otherwise.")
    }

    await ensureIndexes()
  })

  beforeEach(async () => {
    await Promise.all([
      (await businessesCol()).deleteMany({}),
      (await businessMembersCol()).deleteMany({}),
      (await connectedApplicationsCol()).deleteMany({}),
      (await projectsCol()).deleteMany({}),
      (await businessDomainsCol()).deleteMany({}),
    ])
  })

  afterAll(async () => {
    const client = await getMongoClient()
    await client.close()
  })

  it("A — creates the business and its owner in one transaction", async () => {
    const business = await createBusiness({ actor: userActor("u_owner"), name: "Acme", now: 1_000 })

    const businesses = await (await businessesCol()).find({}).toArray()
    const members = await (await businessMembersCol()).find({}).toArray()

    expect(businesses).toHaveLength(1)
    expect(members).toHaveLength(1)
    expect(businesses[0].id).toBe(business.id)
    expect(members[0]).toMatchObject({
      businessId: business.id,
      userId: "u_owner",
      role: "owner",
      status: "active",
      scope: { kind: "all" },
    })
    expect(businesses[0].ownerId).toBe(members[0].userId)
    expect(businesses[0].status).toBe("draft")
  })

  it("B — rolls back the business when the owner insert fails", async () => {
    const members = await businessMembersCol()
    const collectionName = members.collectionName

    // A real database-level rejection, not a stubbed throw: the collection
    // refuses every insert while the validator is installed.
    await db.command({
      collMod: collectionName,
      validator: { $jsonSchema: { bsonType: "object", required: ["__forced_failure__"] } },
      validationLevel: "strict",
      validationAction: "error",
    })

    try {
      await expect(createBusiness({ actor: userActor("u_b"), name: "Rollback", now: 2_000 })).rejects.toBeTruthy()
    } finally {
      await db.command({
        collMod: collectionName,
        validator: {},
        validationLevel: "strict",
        validationAction: "error",
      })
    }

    expect(await (await businessesCol()).countDocuments({})).toBe(0)
    expect(await members.countDocuments({})).toBe(0)
  })

  it("C — refuses a second owner and leaves the first untouched", async () => {
    const business = await createBusiness({ actor: userActor("u_first"), name: "Acme", now: 3_000 })

    await expect(
      addOwner({ businessId: business.id, userId: "u_second", actor: systemActor("test"), now: 3_001 }),
    ).rejects.toMatchObject({ code: "VALIDATION" })

    const owners = await (await businessMembersCol()).find({ businessId: business.id }).toArray()
    expect(owners).toHaveLength(1)
    expect(owners[0].userId).toBe("u_first")
    expect(owners[0].role).toBe("owner")
    expect(owners[0].status).toBe("active")
  })

  it("D — lets exactly one of several concurrent owner insertions win", async () => {
    const businessId = "biz_race"
    await (await businessesCol()).insertOne({
      id: businessId,
      ownerId: "u_seed",
      name: "Race",
      status: "active",
      schemaVersion: 1,
      createdAt: 1,
      updatedAt: 1,
    })

    const contenders = ["r1", "r2", "r3", "r4", "r5"]
    const results = await Promise.allSettled(
      contenders.map((userId) =>
        addOwner({ businessId, userId, actor: systemActor("race"), now: 4_000 }),
      ),
    )

    const fulfilled = results.filter((result) => result.status === "fulfilled")
    expect(fulfilled).toHaveLength(1)

    for (const result of results) {
      if (result.status === "rejected") {
        expect((result.reason as { code?: string }).code).toBe("VALIDATION")
      }
    }

    const owners = await (await businessMembersCol())
      .find({ businessId, role: "owner", status: "active" })
      .toArray()
    expect(owners).toHaveLength(1)
  })

  it("E — enforces the production index definitions", async () => {
    const members = (await businessMembersCol()) as unknown as Collection<Record<string, unknown>>
    const applications = (await connectedApplicationsCol()) as unknown as Collection<Record<string, unknown>>
    const businesses = (await businessesCol()) as unknown as Collection<Record<string, unknown>>

    const memberIndexes = await members.listIndexes().toArray()
    expect(memberIndexes.find((index) => index.name === "business_members_one_owner")).toMatchObject({
      unique: true,
      key: { businessId: 1 },
      partialFilterExpression: { role: "owner", status: "active" },
    })

    const applicationIndexes = await applications.listIndexes().toArray()
    expect(applicationIndexes.find((index) => index.name === "connected_applications_origin_unique")).toMatchObject({
      unique: true,
      key: { businessId: 1, hostname: 1, basePath: 1 },
      partialFilterExpression: { archivedAt: null },
    })

    const owner = { role: "owner", status: "active", scope: { kind: "all" } }

    // Unrelated businesses coexist: the predicate is per business.
    await members.insertOne({ id: "m_a", businessId: "b1", userId: "u1", ...owner })
    await members.insertOne({ id: "m_b", businessId: "b2", userId: "u2", ...owner })

    // A removed owner falls outside the predicate and does not block.
    await members.insertOne({ id: "m_a_old", businessId: "b1", userId: "u0", role: "owner", status: "removed", scope: { kind: "all" } })

    // A second active owner for the same business is rejected by the database.
    await expect(
      members.insertOne({ id: "m_a2", businessId: "b1", userId: "u3", ...owner }),
    ).rejects.toMatchObject({ code: 11000 })

    // One active origin per business; an archived row is outside the predicate.
    await applications.insertOne({ id: "app1", businessId: "b1", hostname: "example.com", basePath: "/shop" })
    await expect(
      applications.insertOne({ id: "app2", businessId: "b1", hostname: "example.com", basePath: "/shop" }),
    ).rejects.toMatchObject({ code: 11000 })
    await applications.insertOne({
      id: "app3",
      businessId: "b1",
      hostname: "example.com",
      basePath: "/shop",
      archivedAt: 5,
    })

    // Legacy project identity is unique only when it is a string.
    const business = (id: string, legacyProjectId?: string) => ({
      id,
      ownerId: "u1",
      name: id,
      status: "active",
      schemaVersion: 1,
      ...(legacyProjectId ? { legacyProjectId } : {}),
      createdAt: 1,
      updatedAt: 1,
    })
    await businesses.insertOne(business("b3", "p1"))
    await expect(businesses.insertOne(business("b4", "p1"))).rejects.toMatchObject({ code: 11000 })
    await businesses.insertOne(business("b5"))
    await businesses.insertOne(business("b6"))
  })

  it("F — migrates a project and rolls it back by run id", async () => {
    await (await projectsCol()).insertOne({
      id: "p_legacy",
      userId: "u_legacy",
      name: "Legacy Bakery",
      state: "created",
      mode: "scratch",
      createdAt: 10,
      updatedAt: 20,
      sourceUrl: "https://example.com/shop",
    } as never)
    await (await businessDomainsCol()).insertOne({ id: "d_legacy", projectId: "p_legacy", hostname: "example.com" })

    const report = await migrateConnectedBusinesses({ mode: "apply", runId: "run-int-1", now: 5_000 })
    expect(report.created).toBe(1)

    const business = await (await businessesCol()).findOne({ legacyProjectId: "p_legacy" })
    expect(business?.migration?.runId).toBe("run-int-1")

    const owner = await (await businessMembersCol()).findOne({ businessId: business!.id })
    expect(owner).toMatchObject({ userId: "u_legacy", role: "owner", status: "active" })
    expect(owner?.migration?.runId).toBe("run-int-1")

    const application = await (await connectedApplicationsCol()).findOne({ businessId: business!.id })
    expect(application).toMatchObject({ hostname: "example.com", basePath: "/shop" })
    expect(application?.migration?.runId).toBe("run-int-1")

    const claim = await (await businessDomainsCol()).findOne({ projectId: "p_legacy" })
    expect(claim?.businessId).toBe(business!.id)

    // Idempotent: a second run skips the project rather than duplicating it.
    const second = await migrateConnectedBusinesses({ mode: "apply", runId: "run-int-2", now: 5_001 })
    expect(second.skipped).toBe(1)
    expect(await (await businessesCol()).countDocuments({})).toBe(1)

    // Rollback removes exactly what the run created.
    const rollback = await rollbackMigration({ runId: "run-int-1", mode: "apply" })
    expect(rollback.businesses).toBe(1)
    expect(await (await businessesCol()).countDocuments({})).toBe(0)
    expect(await (await businessMembersCol()).countDocuments({})).toBe(0)
    expect(await (await connectedApplicationsCol()).countDocuments({})).toBe(0)
    const detached = await (await businessDomainsCol()).findOne({ projectId: "p_legacy" })
    expect(detached?.businessId).toBeUndefined()
  })

  it("G — refuses to roll back a business a founder has staffed", async () => {
    await (await projectsCol()).insertOne({
      id: "p_staffed",
      userId: "u_legacy",
      name: "Staffed",
      state: "created",
      mode: "scratch",
      createdAt: 1,
      updatedAt: 1,
      sourceUrl: "https://staffed.example",
    } as never)

    await migrateConnectedBusinesses({ mode: "apply", runId: "run-int-g", now: 6_000 })
    const business = await (await businessesCol()).findOne({ legacyProjectId: "p_staffed" })
    expect(business).not.toBeNull()

    // The founder invites a colleague through the product, so the row carries
    // no migration stamp.
    await addMember({
      businessId: business!.id,
      userId: "u_colleague",
      actor: userActor("u_legacy"),
      role: "developer",
      now: 6_100,
    })

    const refused = await rollbackMigration({ runId: "run-int-g", mode: "apply" })
    expect(refused.blocked).toBe(true)
    expect(refused.applied).toBe(false)
    expect(refused.impact[0].foreignMemberships).toBe(1)
    expect(await (await businessesCol()).countDocuments({})).toBe(1)
    expect(await (await businessMembersCol()).countDocuments({})).toBe(2)

    // The separately authorised recovery path proceeds, deleting only what the
    // run wrote and leaving the colleague's row behind.
    const forced = await rollbackMigration({ runId: "run-int-g", mode: "apply", allowInUse: true })
    expect(forced.applied).toBe(true)
    expect(forced.orphanedMemberships).toBe(1)
    expect(await (await businessesCol()).countDocuments({})).toBe(0)
    const survivors = await (await businessMembersCol()).find({}).toArray()
    expect(survivors.map((member) => member.userId)).toEqual(["u_colleague"])
  })
})
