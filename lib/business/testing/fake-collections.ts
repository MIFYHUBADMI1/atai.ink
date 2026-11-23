/**
 * In-memory collections for the connected-business suites.
 *
 * TEST SUPPORT ONLY — never import this from application code. It replaces the
 * collection boundary (`@/lib/db/collections`) so the real business logic runs
 * against real documents; nothing here stubs the logic under test.
 *
 * Uniqueness is modelled the way the indexes are declared, including partial
 * predicates, so an archived row does not block its origin.
 */

type Filter = Record<string, unknown>

export interface FakeUpdate {
  $set?: Record<string, unknown>
  $unset?: Record<string, unknown>
}

type UniqueRule<T> = string[] | { keys: string[]; when?: (doc: T) => boolean }

export interface FakeCollection<T extends object> {
  docs: T[]
  insertOne: (doc: T, options?: unknown) => Promise<{ insertedId: string }>
  findOne: (filter?: Filter) => Promise<T | null>
  find: (filter?: Filter) => { toArray: () => Promise<T[]> }
  updateOne: (filter: Filter, update: FakeUpdate) => Promise<{ matchedCount: number; modifiedCount: number }>
  countDocuments: (filter?: Filter) => Promise<number>
  deleteMany: (filter?: Filter) => Promise<{ deletedCount: number }>
}

function field(doc: object, key: string): unknown {
  return (doc as Record<string, unknown>)[key]
}

function matches(doc: object, filter: Filter): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = field(doc, key)
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      const operator = expected as Record<string, unknown>
      if ("$in" in operator) return (operator.$in as unknown[]).includes(actual)
      if ("$exists" in operator) return operator.$exists ? actual !== undefined : actual === undefined
      if ("$ne" in operator) return actual !== operator.$ne
    }
    return actual === expected
  })
}

export function fakeCollection<T extends object>(
  config: { unique?: UniqueRule<T>[] } = {},
): FakeCollection<T> {
  const docs: T[] = []

  function violatesUnique(candidate: T): boolean {
    return (config.unique ?? []).some((rule) => {
      const keys = Array.isArray(rule) ? rule : rule.keys
      const when = Array.isArray(rule) ? undefined : rule.when
      if (when && !when(candidate)) return false
      return docs.some(
        (existing) =>
          (!when || when(existing)) && keys.every((key) => field(existing, key) === field(candidate, key)),
      )
    })
  }

  return {
    docs,
    async insertOne(doc) {
      if (violatesUnique(doc)) {
        throw Object.assign(new Error("E11000 duplicate key error"), { code: 11000 })
      }
      docs.push(doc)
      return { insertedId: String(field(doc, "id") ?? docs.length) }
    },
    async findOne(filter = {}) {
      return docs.find((doc) => matches(doc, filter)) ?? null
    },
    find(filter = {}) {
      return { toArray: async () => docs.filter((doc) => matches(doc, filter)) }
    },
    async updateOne(filter, update) {
      const doc = docs.find((candidate) => matches(candidate, filter))
      if (!doc) return { matchedCount: 0, modifiedCount: 0 }
      if (update.$set) Object.assign(doc, update.$set)
      for (const key of Object.keys(update.$unset ?? {})) {
        delete (doc as Record<string, unknown>)[key]
      }
      return { matchedCount: 1, modifiedCount: 1 }
    },
    async countDocuments(filter = {}) {
      return docs.filter((doc) => matches(doc, filter)).length
    },
    async deleteMany(filter = {}) {
      const keep = docs.filter((doc) => !matches(doc, filter))
      const deletedCount = docs.length - keep.length
      docs.length = 0
      docs.push(...keep)
      return { deletedCount }
    },
  }
}

/** A transaction that runs its callback once. Enough to prove the write path is atomic. */
export function fakeSession() {
  return {
    withTransaction: async <R>(fn: () => Promise<R>): Promise<R> => fn(),
    endSession: async () => {},
  }
}
