import { describe, expect, it, vi } from "vitest"
import type { MongoClient } from "mongodb"
import { assertTransactionSupport } from "./transaction-readiness"

describe("transaction readiness (mocked topology)", () => {
  const client = (hello: object) => ({ db: () => ({ admin: () => ({ command: vi.fn().mockResolvedValue(hello) }) }) }) as unknown as MongoClient
  it.each([
    { setName: "rs0", logicalSessionTimeoutMinutes: 30, maxWireVersion: 7 },
    { msg: "isdbgrid", logicalSessionTimeoutMinutes: 30, maxWireVersion: 8 },
  ])("accepts transaction-capable topology %#", async (hello) => {
    await expect(assertTransactionSupport(client(hello))).resolves.toBeUndefined()
  })
  it.each([
    { logicalSessionTimeoutMinutes: 30, maxWireVersion: 25 },
    { setName: "rs0", maxWireVersion: 25 },
    { setName: "rs0", logicalSessionTimeoutMinutes: 30, maxWireVersion: 6 },
    { msg: "isdbgrid", logicalSessionTimeoutMinutes: 30, maxWireVersion: 7 },
    { setName: "rs0", logicalSessionTimeoutMinutes: 30 },
    { setName: "rs0", logicalSessionTimeoutMinutes: 30, maxWireVersion: "unknown" },
    { setName: "rs0", logicalSessionTimeoutMinutes: "unknown", maxWireVersion: 25 },
    { setName: "rs0", logicalSessionTimeoutMinutes: 0, maxWireVersion: 25 },
  ])("rejects unsupported or unverifiable topology %#", async (hello) => {
    await expect(assertTransactionSupport(client(hello))).rejects.toMatchObject({ status: 503 })
  })
  it("does not expose credentials or perform mutations", async () => {
    const command = vi.fn().mockRejectedValue(new Error("mongodb://secret@host"))
    const db = { admin: () => ({ command }) }
    await expect(assertTransactionSupport({ db: () => db } as unknown as MongoClient)).rejects.not.toThrow("secret")
    expect(command).toHaveBeenCalledExactlyOnceWith({ hello: 1 })
  })
})
