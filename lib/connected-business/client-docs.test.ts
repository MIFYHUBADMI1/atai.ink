import { describe, expect, it } from "vitest"
import { ObjectId } from "mongodb"

import { withoutMongoId } from "./client-docs"

/**
 * React's Flight serializer rejects any non-plain object across the
 * server→client boundary. A Mongo document carries `_id` as an `ObjectId`,
 * which is a class instance, so passing it to a Client Component throws
 * "Only plain objects … can be passed to Client Components". These assertions
 * pin the exact property the serializer checks.
 */
describe("withoutMongoId", () => {
  it("removes the ObjectId so the result is a plain object", () => {
    const doc = {
      _id: new ObjectId(),
      id: "biz_1",
      name: "Corner Bakery",
      status: "active",
      createdAt: 1,
      updatedAt: 2,
    }

    const client = withoutMongoId(doc)

    expect("_id" in client).toBe(false)
    expect(Object.getPrototypeOf(client)).toBe(Object.prototype)
    expect(client).toMatchObject({ id: "biz_1", name: "Corner Bakery", status: "active" })
  })

  it("demonstrates the rule it avoids: an ObjectId is not a plain object", () => {
    const id = new ObjectId()
    const proto = Object.getPrototypeOf(id)

    // This is the condition the serializer rejects:
    // proto !== Object.prototype && Object.getPrototypeOf(proto) !== null.
    expect(proto).not.toBe(Object.prototype)
    expect(Object.getPrototypeOf(proto)).not.toBeNull()
  })

  it("keeps nested plain data by reference and does not mutate the source", () => {
    const scope = { applicationIds: ["app_1"], allApplications: false }
    const doc = { _id: new ObjectId(), id: "m_1", scope }

    const client = withoutMongoId(doc)

    expect(client.scope).toBe(scope)
    expect(doc._id).toBeInstanceOf(ObjectId)
  })
})
