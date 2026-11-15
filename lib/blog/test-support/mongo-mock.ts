/**
 * A small in-memory stand-in for a MongoDB collection.
 *
 * The blog store is the heart of the publishing system, so the tests exercise
 * the real implementation against this mock rather than mocking the store
 * itself. It supports exactly the slice of the Mongo API the store uses:
 * equality filters with `$ne`/`$gt`/`$gte`/`$lt`/`$lte`/`$in`/`$nin`, and the
 * `$set`/`$unset`/`$inc`/`$pull` update operators.
 */

export type MockFilter = Record<string, unknown>

export interface MockCursor<T> {
  sort(spec: Record<string, 1 | -1>): MockCursor<T>
  limit(count: number): MockCursor<T>
  skip(count: number): MockCursor<T>
  toArray(): Promise<T[]>
}

export interface MockCollection<T extends Record<string, unknown>> {
  readonly docs: T[]
  find(filter?: MockFilter): MockCursor<T>
  findOne(filter?: MockFilter): Promise<T | null>
  insertOne(doc: T): Promise<{ acknowledged: boolean; insertedId: string }>
  insertMany(docs: T[]): Promise<{ acknowledged: boolean; insertedCount: number }>
  replaceOne(
    filter: MockFilter,
    doc: T,
    options?: { upsert?: boolean },
  ): Promise<{ matchedCount: number; modifiedCount: number; upsertedCount: number }>
  updateOne(
    filter: MockFilter,
    update: Record<string, unknown>,
    options?: { upsert?: boolean },
  ): Promise<{ matchedCount: number; modifiedCount: number; upsertedCount: number }>
  updateMany(
    filter: MockFilter,
    update: Record<string, unknown>,
  ): Promise<{ matchedCount: number; modifiedCount: number }>
  deleteOne(filter: MockFilter): Promise<{ deletedCount: number }>
  deleteMany(filter?: MockFilter): Promise<{ deletedCount: number }>
  countDocuments(filter?: MockFilter): Promise<number>
  createIndex(): Promise<string>
}

const OPERATORS = new Set(["$ne", "$gt", "$gte", "$lt", "$lte", "$in", "$nin"])

function matchesValue(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === "object" && !(expected instanceof Date) && !Array.isArray(expected)) {
    const entries = Object.entries(expected as Record<string, unknown>)
    if (entries.length > 0 && entries.every(([key]) => OPERATORS.has(key))) {
      return entries.every(([operator, operand]) => {
        switch (operator) {
          case "$ne":
            return actual !== operand
          case "$gt":
            return Number(actual) > Number(operand)
          case "$gte":
            return Number(actual) >= Number(operand)
          case "$lt":
            return Number(actual) < Number(operand)
          case "$lte":
            return Number(actual) <= Number(operand)
          case "$in":
            return Array.isArray(operand) && operand.includes(actual)
          case "$nin":
            return Array.isArray(operand) && !operand.includes(actual)
          default:
            throw new Error(`mongo-mock: unsupported operator ${operator}`)
        }
      })
    }
  }
  if (Array.isArray(actual) && !Array.isArray(expected)) return actual.includes(expected)
  return actual === expected
}

function readPath(doc: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, part) => {
    if (value && typeof value === "object") return (value as Record<string, unknown>)[part]
    return undefined
  }, doc)
}

export function matchesFilter(doc: Record<string, unknown>, filter: MockFilter | undefined): boolean {
  if (!filter) return true
  return Object.entries(filter).every(([key, expected]) => {
    if (key === "$or") {
      const clauses = expected as MockFilter[]
      return clauses.some((clause) => matchesFilter(doc, clause))
    }
    if (key === "$and") {
      const clauses = expected as MockFilter[]
      return clauses.every((clause) => matchesFilter(doc, clause))
    }
    return matchesValue(readPath(doc, key), expected)
  })
}

function applyUpdate(doc: Record<string, unknown>, update: Record<string, unknown>): void {
  if (update.$set) {
    // The driver omits `undefined` values instead of writing them, so an
    // unset field keeps its current value.
    for (const [key, value] of Object.entries(update.$set as Record<string, unknown>)) {
      if (value === undefined) continue
      doc[key] = value
    }
  }
  if (update.$unset) {
    for (const key of Object.keys(update.$unset as Record<string, unknown>)) delete doc[key]
  }
  if (update.$inc) {
    for (const [key, delta] of Object.entries(update.$inc as Record<string, number>)) {
      doc[key] = ((doc[key] as number | undefined) ?? 0) + delta
    }
  }
  if (update.$pull) {
    for (const [key, condition] of Object.entries(update.$pull as Record<string, unknown>)) {
      const list = Array.isArray(doc[key]) ? (doc[key] as unknown[]) : []
      doc[key] = list.filter((item) => {
        if (!item || typeof item !== "object") return true
        return !matchesFilter(item as Record<string, unknown>, condition as MockFilter)
      })
    }
  }
  if (update.$push) {
    for (const [key, value] of Object.entries(update.$push as Record<string, unknown>)) {
      const list = Array.isArray(doc[key]) ? (doc[key] as unknown[]) : []
      doc[key] = [...list, value]
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Mirrors the driver's `ignoreUndefined` behaviour: a key whose value is
 * `undefined` is omitted from the stored document rather than written as
 * `null`. Without this the mock would hide the exact class of bug that
 * `ignoreUndefined` prevents — a document read back with `null` where the
 * writer meant "not set".
 */
function omitUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => omitUndefined(item)) as unknown as T
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue
      out[key] = omitUndefined(item)
    }
    return out as unknown as T
  }
  return value
}

export function createCollection<T extends Record<string, unknown>>(seed: T[] = []): MockCollection<T> {
  const docs: T[] = seed.map((doc) => omitUndefined({ ...doc }))

  function cursor(filter?: MockFilter): MockCursor<T> {
    let result = docs.filter((doc) => matchesFilter(doc, filter))
    let limitCount = Number.POSITIVE_INFINITY
    let skipCount = 0
    const chain: MockCursor<T> = {
      sort(spec) {
        result = [...result].sort((a, b) => {
          for (const [key, direction] of Object.entries(spec)) {
            const left = readPath(a, key)
            const right = readPath(b, key)
            if (left === right) continue
            if (left === undefined || left === null) return 1
            if (right === undefined || right === null) return -1
            const order = (left as number) < (right as number) ? -1 : 1
            return direction === -1 ? -order : order
          }
          return 0
        })
        return chain
      },
      limit(count) {
        limitCount = count
        return chain
      },
      skip(count) {
        skipCount = count
        return chain
      },
      async toArray() {
        return result.slice(skipCount, skipCount + limitCount).map((doc) => ({ ...doc }))
      },
    }
    return chain
  }

  return {
    docs,
    find: (filter) => cursor(filter),
    async findOne(filter) {
      const found = docs.find((doc) => matchesFilter(doc, filter))
      return found ? ({ ...found } as T) : null
    },
    async insertOne(doc) {
      docs.push(omitUndefined({ ...doc }))
      return { acknowledged: true, insertedId: String(docs.length) }
    },
    async insertMany(newDocs) {
      docs.push(...newDocs.map((doc) => omitUndefined({ ...doc })))
      return { acknowledged: true, insertedCount: newDocs.length }
    },
    async replaceOne(filter, doc, options) {
      const index = docs.findIndex((entry) => matchesFilter(entry, filter))
      if (index === -1) {
        if (!options?.upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 }
        docs.push(omitUndefined({ ...doc }))
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 }
      }
      docs[index] = omitUndefined({ ...doc })
      return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 }
    },
    async updateOne(filter, update, options) {
      const index = docs.findIndex((entry) => matchesFilter(entry, filter))
      if (index === -1) {
        if (!options?.upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 }
        // Mongo seeds an upserted document from the filter's equality
        // conditions, then applies the update operators on top.
        const created: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(filter)) {
          if (value === null || typeof value !== "object") created[key] = value
        }
        applyUpdate(created, update)
        docs.push(created as T)
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 }
      }
      applyUpdate(docs[index], update)
      return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 }
    },
    async updateMany(filter, update) {
      const targets = docs.filter((doc) => matchesFilter(doc, filter))
      for (const doc of targets) applyUpdate(doc, update)
      return { matchedCount: targets.length, modifiedCount: targets.length }
    },
    async deleteOne(filter) {
      const index = docs.findIndex((entry) => matchesFilter(entry, filter))
      if (index === -1) return { deletedCount: 0 }
      docs.splice(index, 1)
      return { deletedCount: 1 }
    },
    async deleteMany(filter) {
      const before = docs.length
      const kept = docs.filter((doc) => !matchesFilter(doc, filter))
      docs.length = 0
      docs.push(...kept)
      return { deletedCount: before - kept.length }
    },
    async countDocuments(filter) {
      return docs.filter((doc) => matchesFilter(doc, filter)).length
    },
    async createIndex() {
      return "index"
    },
  }
}

export interface MongoMock {
  collections: Record<string, MockCollection<Record<string, unknown>>>
  collection<T extends Record<string, unknown>>(name: string): MockCollection<T>
  reset(): void
}

/** Creates one isolated set of collections per test file. */
export function createMongoMock(): MongoMock {
  const names = [
    "blog_articles",
    "blog_categories",
    "blog_redirects",
    "blog_revisions",
    "blog_stats",
    "blog_newsletter",
    "blog_settings",
  ] as const

  const collections: Record<string, MockCollection<Record<string, unknown>>> = {}
  for (const name of names) collections[name] = createCollection()

  return {
    collections,
    collection<T extends Record<string, unknown>>(name: string): MockCollection<T> {
      if (!collections[name]) collections[name] = createCollection()
      return collections[name] as MockCollection<T>
    },
    reset() {
      for (const name of Object.keys(collections)) {
        collections[name] = createCollection()
      }
    },
  }
}
