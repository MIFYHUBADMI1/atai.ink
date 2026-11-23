import { describe, expect, it } from "vitest"

import { fakeCollection, fakeSession } from "./fake-collections"

/**
 * The harness itself is under test. If these fail, every suite that relies on
 * it is proving less than it appears to.
 */
describe("fake collections", () => {
  it("refuses an operation that escapes the transaction session", async () => {
    const col = fakeCollection<{ id: string }>()
    await expect(
      fakeSession().withTransaction(async () => {
        await col.findOne({ id: "x" })
      }),
    ).rejects.toThrow(/without \{ session \}/)
  })

  it("refuses a write that escapes the transaction session", async () => {
    const col = fakeCollection<{ id: string }>()
    await expect(
      fakeSession().withTransaction(async () => {
        await col.insertOne({ id: "x" })
      }),
    ).rejects.toThrow(/without \{ session \}/)
  })

  it("accepts operations that carry the session", async () => {
    const col = fakeCollection<{ id: string }>()
    const session = fakeSession()
    await session.withTransaction(async () => {
      await col.insertOne({ id: "a" }, { session })
      expect(await col.findOne({ id: "a" }, { session })).toEqual({ id: "a" })
    })
  })

  it("requires no session outside a transaction", async () => {
    const col = fakeCollection<{ id: string }>()
    await col.insertOne({ id: "a" })
    expect(await col.findOne({ id: "a" })).toEqual({ id: "a" })
  })

  it("clears the transaction state after a failure", async () => {
    const col = fakeCollection<{ id: string }>()
    await expect(
      fakeSession().withTransaction(async () => {
        throw new Error("boom")
      }),
    ).rejects.toThrow("boom")
    await expect(col.insertOne({ id: "after" })).resolves.toBeDefined()
  })

  it("enforces a partial unique rule only while its predicate holds", async () => {
    const col = fakeCollection<{ id: string; businessId: string; role: string; status: string }>({
      unique: [{ keys: ["businessId"], when: (doc) => doc.role === "owner" && doc.status === "active" }],
    })
    await col.insertOne({ id: "m1", businessId: "b", role: "owner", status: "active" })
    await expect(
      col.insertOne({ id: "m2", businessId: "b", role: "owner", status: "active" }),
    ).rejects.toMatchObject({ code: 11000 })
    await col.insertOne({ id: "m3", businessId: "b", role: "owner", status: "removed" })
    await col.insertOne({ id: "m4", businessId: "b", role: "admin", status: "active" })
  })
})
