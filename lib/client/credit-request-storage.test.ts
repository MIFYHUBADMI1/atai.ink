import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  deleteCreditRequestBody,
  readCreditRequestBody,
  saveCreditRequestBody,
} from "./credit-request-storage"

const now = 1_800_000_000_000
const id = "932c0931-e5bb-475e-9082-99272ed9ac37"
type Entry = { id: string; body: Blob; expiresAt: number }

function mockDatabase() {
  const getRequest = {
    result: undefined as Entry | undefined,
    onsuccess: null as (() => void) | null,
  }
  const cursorRequest = {
    result: null as {
      value: Entry
      delete: ReturnType<typeof vi.fn>
      continue: ReturnType<typeof vi.fn>
    } | null,
    onsuccess: null as (() => void) | null,
  }
  const deleteRequest = { onsuccess: null as (() => void) | null }
  const putRequest = { onsuccess: null as (() => void) | null }
  const store = {
    get: vi.fn(() => getRequest),
    openCursor: vi.fn(() => cursorRequest),
    delete: vi.fn(() => deleteRequest),
    put: vi.fn(() => putRequest),
  }
  const transaction = {
    error: null as Error | null,
    objectStore: vi.fn(() => store),
    abort: vi.fn(),
    oncomplete: null as (() => void) | null,
    onerror: null as (() => void) | null,
    onabort: null as (() => void) | null,
  }
  const database = {
    createObjectStore: vi.fn(),
    transaction: vi.fn(() => transaction),
    close: vi.fn(),
  }
  const openRequest = {
    result: database,
    error: null as Error | null,
    transaction,
    onupgradeneeded: null as (() => void) | null,
    onsuccess: null as (() => void) | null,
    onerror: null as (() => void) | null,
    onblocked: null as (() => void) | null,
  }
  const factory = { open: vi.fn(() => openRequest) }
  vi.stubGlobal("indexedDB", factory)
  return {
    factory, database, transaction, store, openRequest,
    getRequest, cursorRequest, putRequest, deleteRequest,
  }
}

const operations = [
  ["save", () => saveCreditRequestBody(new Blob(["body"]), now + 1000)],
  ["read", () => readCreditRequestBody(id)],
  ["delete", () => deleteCreditRequestBody(id)],
] as const

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(now)
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => id) })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("credit request body storage", () => {
  it("rejects SSR saves, returns null for SSR reads and skips SSR deletes", async () => {
    vi.stubGlobal("indexedDB", undefined)
    await expect(saveCreditRequestBody(new Blob(), now + 1)).rejects.toThrow("unavailable")
    await expect(readCreditRequestBody(id)).resolves.toBeNull()
    await expect(deleteCreditRequestBody(id)).resolves.toBeUndefined()
    expect(crypto.randomUUID).not.toHaveBeenCalled()
  })

  it("creates the version-one keyed store and waits for commit before returning the UUID", async () => {
    const mock = mockDatabase()
    const body = new Blob([new Uint8Array([0, 255, 128, 13, 10])], {
      type: "multipart/form-data; boundary=checkout",
    })
    const settled = vi.fn()
    const saved = saveCreditRequestBody(body, now + 1000).then((value) => {
      settled()
      return value
    })
    expect(mock.factory.open).toHaveBeenCalledWith("atai-credit-requests", 1)
    mock.openRequest.onupgradeneeded?.()
    expect(mock.database.createObjectStore).toHaveBeenCalledWith("bodies", { keyPath: "id" })
    mock.openRequest.onsuccess?.()
    await Promise.resolve()
    expect(crypto.randomUUID).toHaveBeenCalledOnce()
    expect(mock.database.transaction).toHaveBeenCalledWith("bodies", "readwrite")
    expect(mock.store.put).toHaveBeenCalledWith({ id, body, expiresAt: now + 1000 })
    mock.putRequest.onsuccess?.()
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    expect(mock.database.close).not.toHaveBeenCalled()
    mock.transaction.oncomplete?.()
    await expect(saved).resolves.toBe(id)
    expect(mock.database.close).toHaveBeenCalledOnce()
  })

  it("prunes entries expired at or before now without deleting live entries", async () => {
    const mock = mockDatabase()
    const saved = saveCreditRequestBody(new Blob(), now + 1000)
    mock.openRequest.onsuccess?.()
    await Promise.resolve()
    for (const expiresAt of [now - 1, now, now + 1]) {
      const cursor = {
        value: { id: "old", body: new Blob(), expiresAt },
        delete: vi.fn(),
        continue: vi.fn(),
      }
      mock.cursorRequest.result = cursor
      mock.cursorRequest.onsuccess?.()
      expect(cursor.delete).toHaveBeenCalledTimes(expiresAt <= now ? 1 : 0)
      expect(cursor.continue).toHaveBeenCalledOnce()
    }
    mock.cursorRequest.result = null
    mock.cursorRequest.onsuccess?.()
    mock.transaction.oncomplete?.()
    await saved
  })

  it("returns the stored Blob with its binary bytes and content type intact", async () => {
    const mock = mockDatabase()
    const body = new Blob([new Uint8Array([0, 255, 128, 13, 10])], {
      type: "multipart/form-data; boundary=checkout",
    })
    mock.getRequest.result = { id, body, expiresAt: now + 1 }
    const read = readCreditRequestBody(id)
    mock.openRequest.onsuccess?.()
    await Promise.resolve()
    expect(mock.store.get).toHaveBeenCalledWith(id)
    mock.getRequest.onsuccess?.()
    mock.transaction.oncomplete?.()
    const result = await read
    expect(result).toBe(body)
    expect(result?.type).toBe("multipart/form-data; boundary=checkout")
    expect(new Uint8Array(await result!.arrayBuffer())).toEqual(new Uint8Array([0, 255, 128, 13, 10]))
    expect(mock.store.delete).not.toHaveBeenCalled()
    expect(mock.database.close).toHaveBeenCalledOnce()
  })

  it.each([now - 1, now])("deletes an expired read (%s) and waits for its commit", async (expiresAt) => {
    const mock = mockDatabase()
    mock.getRequest.result = { id, body: new Blob(), expiresAt }
    const settled = vi.fn()
    const read = readCreditRequestBody(id).then((value) => {
      settled()
      return value
    })
    mock.openRequest.onsuccess?.()
    await Promise.resolve()
    mock.getRequest.onsuccess?.()
    expect(mock.store.delete).toHaveBeenCalledWith(id)
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    mock.transaction.oncomplete?.()
    await expect(read).resolves.toBeNull()
    expect(mock.database.close).toHaveBeenCalledOnce()
  })

  it("checks expiration when the entry arrives, not before opening the database", async () => {
    const mock = mockDatabase()
    mock.getRequest.result = { id, body: new Blob(), expiresAt: now + 1 }
    const read = readCreditRequestBody(id)
    mock.openRequest.onsuccess?.()
    await Promise.resolve()
    vi.mocked(Date.now).mockReturnValue(now + 1)
    mock.getRequest.onsuccess?.()
    mock.transaction.oncomplete?.()
    await expect(read).resolves.toBeNull()
    expect(mock.store.delete).toHaveBeenCalledWith(id)
  })

  it("returns null for a missing entry", async () => {
    const mock = mockDatabase()
    const read = readCreditRequestBody(id)
    mock.openRequest.onsuccess?.()
    await Promise.resolve()
    mock.getRequest.onsuccess?.()
    mock.transaction.oncomplete?.()
    await expect(read).resolves.toBeNull()
    expect(mock.store.delete).not.toHaveBeenCalled()
    expect(mock.database.close).toHaveBeenCalledOnce()
  })

  it("waits for delete transaction completion, not request success", async () => {
    const mock = mockDatabase()
    const settled = vi.fn()
    const deleted = deleteCreditRequestBody(id).then(settled)
    mock.openRequest.onsuccess?.()
    await Promise.resolve()
    expect(mock.store.delete).toHaveBeenCalledWith(id)
    mock.deleteRequest.onsuccess?.()
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    expect(mock.database.close).not.toHaveBeenCalled()
    mock.transaction.oncomplete?.()
    await deleted
    expect(settled).toHaveBeenCalledOnce()
    expect(mock.database.close).toHaveBeenCalledOnce()
  })

  it.each(operations)("rejects open failures for %s", async (_name, operation) => {
    const mock = mockDatabase()
    const error = new Error("Open denied")
    mock.openRequest.error = error
    const result = expect(operation()).rejects.toBe(error)
    mock.openRequest.onerror?.()
    await result
    expect(mock.database.transaction).not.toHaveBeenCalled()
  })

  it.each(operations)("rejects synchronous transaction failures and closes after %s", async (_name, operation) => {
    const mock = mockDatabase()
    const error = new Error("Transaction unavailable")
    mock.database.transaction.mockImplementationOnce(() => { throw error })
    const result = expect(operation()).rejects.toBe(error)
    mock.openRequest.onsuccess?.()
    await result
    expect(mock.database.close).toHaveBeenCalledOnce()
  })

  it.each(operations)("rejects transaction errors and closes after %s", async (_name, operation) => {
    const mock = mockDatabase()
    const error = new Error("Quota exceeded")
    const result = expect(operation()).rejects.toBe(error)
    mock.openRequest.onsuccess?.()
    await Promise.resolve()
    mock.transaction.error = error
    mock.transaction.onerror?.()
    await result
    expect(mock.database.close).toHaveBeenCalledOnce()
  })

  it.each(operations)("rejects transaction aborts without an error and closes after %s", async (_name, operation) => {
    const mock = mockDatabase()
    const result = expect(operation()).rejects.toThrow("aborted")
    mock.openRequest.onsuccess?.()
    await Promise.resolve()
    mock.transaction.onabort?.()
    await result
    expect(mock.database.close).toHaveBeenCalledOnce()
  })

  it("rejects blocked opens and closes a connection that succeeds later", async () => {
    const mock = mockDatabase()
    const result = expect(readCreditRequestBody(id)).rejects.toThrow("blocked")
    mock.openRequest.onblocked?.()
    await result
    mock.openRequest.onsuccess?.()
    expect(mock.database.close).toHaveBeenCalledOnce()
    expect(mock.database.transaction).not.toHaveBeenCalled()
  })

  it("closes the upgrade connection when opening fails", async () => {
    const mock = mockDatabase()
    const result = expect(readCreditRequestBody(id)).rejects.toThrow("Upgrade failed")
    mock.openRequest.onupgradeneeded?.()
    mock.openRequest.error = new Error("Upgrade failed")
    mock.openRequest.onerror?.()
    await result
    expect(mock.database.close).toHaveBeenCalledOnce()
  })

  it("rejects schema creation failures, aborts the upgrade and closes its connection", async () => {
    const mock = mockDatabase()
    const error = new Error("Schema creation failed")
    mock.database.createObjectStore.mockImplementationOnce(() => { throw error })
    const result = expect(readCreditRequestBody(id)).rejects.toBe(error)
    mock.openRequest.onupgradeneeded?.()
    await result
    expect(mock.transaction.abort).toHaveBeenCalledOnce()
    expect(mock.database.close).toHaveBeenCalledOnce()
  })
})
