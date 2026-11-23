/**
 * In-memory collections for the connected-business suites.
 *
 * TEST SUPPORT ONLY — never import this from application code. It replaces the
 * collection boundary (`@/lib/db/collections`) so the real business logic runs
 * against real documents; nothing here stubs the logic under test.
 *
 * Two properties are modelled deliberately, because both have already hidden a
 * real defect:
 *
 * 1. Uniqueness follows the declared indexes, including partial predicates, so
 *    an archived row does not block its origin.
 * 2. A transaction is a visibility boundary. While `withTransaction` is open,
 *    any call without `{ session }` throws. The driver behaves the same way: an
 *    operation outside the session cannot see the transaction's own writes.
 */

type Filter = Record<string, unknown>
interface FakeOptions {
  session?: unknown
  upsert?: boolean
}

export interface FakeUpdate {
  $set?: Record<string, unknown>
  $setOnInsert?: Record<string, unknown>
  $unset?: Record<string, unknown>
}

type UniqueRule<T> = string[] | { keys: string[]; when?: (doc: T) => boolean }

export interface FakeCollection<T extends object> {
  docs: T[]
  insertOne: (doc: T, options?: FakeOptions) => Promise<{ insertedId: string }>
  findOne: (filter?: Filter, options?: FakeOptions) => Promise<T | null>
  find: (filter?: Filter, options?: FakeOptions) => { toArray: () => Promise<T[]> }
  updateOne: (
    filter: Filter,
    update: FakeUpdate,
    options?: FakeOptions,
  ) => Promise<{ matchedCount: number; modifiedCount: number }>
  countDocuments: (filter?: Filter, options?: FakeOptions) => Promise<number>
  updateMany: (filter: Filter, update: FakeUpdate, options?: FakeOptions) => Promise<{ modifiedCount: number }>
  deleteOne: (filter?: Filter, options?: FakeOptions) => Promise<{ deletedCount: number }>
  deleteMany: (filter?: Filter, options?: FakeOptions) => Promise<{ deletedCount: number }>
}

let transactionDepth = 0

function assertSession(options: FakeOptions | undefined, operation: string): void {
  if (transactionDepth > 0 && !options?.session) {
    throw new Error(
      `${operation} ran inside a transaction without { session }. ` +
        "An operation outside the session cannot see uncommitted writes.",
    )
  }
}

function field(doc: object, key: string): unknown {
  if (!key.includes(".")) return (doc as Record<string, unknown>)[key]
  return key
    .split(".")
    .reduce<unknown>(
      (value, part) => (value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined),
      doc,
    )
}

function matches(doc: object, filter: Filter): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = field(doc, key)
    // MongoDB matches a null predicate against both an explicit null and a
    // missing field. The partial origin index relies on that equivalence, so
    // the model must not diverge from it.
    if (expected === null) return actual === null || actual === undefined
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      const operator = expected as Record<string, unknown>
      if ("$in" in operator) return (operator.$in as unknown[]).includes(actual)
      if ("$exists" in operator) return operator.$exists ? actual !== undefined : actual === undefined
      if ("$ne" in operator) {
        // `{field: {$ne: null}}` means "exists and is not null": a missing field
        // satisfies `field: null`, so it must not satisfy the negation.
        if (operator.$ne === null) return actual !== null && actual !== undefined
        return actual !== operator.$ne
      }
    }
    return actual === expected
  })
}

export function fakeCollection<T extends object>(
  config: { unique?: UniqueRule<T>[] } = {},
): FakeCollection<T> {
  const docs: T[] = []

  function violatesUnique(candidate: T, ignore?: T): boolean {
    return (config.unique ?? []).some((rule) => {
      const keys = Array.isArray(rule) ? rule : rule.keys
      const when = Array.isArray(rule) ? undefined : rule.when
      if (when && !when(candidate)) return false
      return docs.some(
        (existing) =>
          existing !== ignore &&
          (!when || when(existing)) &&
          keys.every((key) => field(existing, key) === field(candidate, key)),
      )
    })
  }

  return {
    docs,
    async insertOne(doc, options) {
      assertSession(options, "insertOne")
      if (violatesUnique(doc)) {
        throw Object.assign(new Error("E11000 duplicate key error"), { code: 11000 })
      }
      docs.push(doc)
      return { insertedId: String(field(doc, "id") ?? docs.length) }
    },
    async findOne(filter = {}, options) {
      assertSession(options, "findOne")
      return docs.find((doc) => matches(doc, filter)) ?? null
    },
    find(filter = {}, options) {
      assertSession(options, "find")
      return { toArray: async () => docs.filter((doc) => matches(doc, filter)) }
    },
    async updateOne(filter, update, options) {
      assertSession(options, "updateOne")
      const doc = docs.find((candidate) => matches(candidate, filter))
      if (!doc) {
        // MongoDB's upsert inserts the filter's equality fields merged with the
        // update. Without this the model silently drops writes that production
        // would persist, which is how a settings document can appear to save
        // and never exist.
        if (options?.upsert) {
          const equality = Object.fromEntries(
            Object.entries(filter).filter(([, value]) => !(value && typeof value === "object")),
          )
          // $setOnInsert applies only to the insert half, which is how a partial
          // update can seed a field it was not asked to change.
          docs.push({ ...equality, ...(update.$setOnInsert ?? {}), ...(update.$set ?? {}) } as T)
        }
        return { matchedCount: 0, modifiedCount: 0 }
      }
      // An update can violate a partial unique index too (restoring an
      // application whose address was claimed while it was archived), so the
      // post-update row is validated before anything is written.
      const next = { ...doc } as Record<string, unknown>
      if (update.$set) Object.assign(next, update.$set)
      for (const key of Object.keys(update.$unset ?? {})) delete next[key]
      if (violatesUnique(next as T, doc)) {
        throw Object.assign(new Error("E11000 duplicate key error"), { code: 11000 })
      }
      if (update.$set) Object.assign(doc, update.$set)
      for (const key of Object.keys(update.$unset ?? {})) {
        delete (doc as Record<string, unknown>)[key]
      }
      return { matchedCount: 1, modifiedCount: 1 }
    },
    async countDocuments(filter = {}, options) {
      assertSession(options, "countDocuments")
      return docs.filter((doc) => matches(doc, filter)).length
    },
    async updateMany(filter, update, options) {
      assertSession(options, "updateMany")
      const matched = docs.filter((doc) => matches(doc, filter))
      for (const doc of matched) {
        if (update.$set) Object.assign(doc, update.$set)
        for (const key of Object.keys(update.$unset ?? {})) {
          delete (doc as Record<string, unknown>)[key]
        }
      }
      return { modifiedCount: matched.length }
    },
    async deleteOne(filter = {}, options) {
      assertSession(options, "deleteOne")
      const index = docs.findIndex((doc) => matches(doc, filter))
      if (index === -1) return { deletedCount: 0 }
      docs.splice(index, 1)
      return { deletedCount: 1 }
    },
    async deleteMany(filter = {}, options) {
      assertSession(options, "deleteMany")
      const keep = docs.filter((doc) => !matches(doc, filter))
      const deletedCount = docs.length - keep.length
      docs.length = 0
      docs.push(...keep)
      return { deletedCount }
    },
  }
}

/** Runs its callback once, with the session-visibility rule enforced. */
export function fakeSession() {
  return {
    withTransaction: async <R>(fn: () => Promise<R>): Promise<R> => {
      transactionDepth += 1
      try {
        return await fn()
      } finally {
        transactionDepth -= 1
      }
    },
    endSession: async () => {},
  }
}
