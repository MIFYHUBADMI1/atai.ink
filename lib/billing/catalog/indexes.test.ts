import { describe, expect, it } from "vitest"
import { ensureCommercialCatalogIndexes, type CatalogIndexCollection } from "./indexes"

type Call = { keys: Record<string, 1 | -1>; options?: Record<string, unknown> }

function capture() {
  const calls: Call[] = []
  const collection: CatalogIndexCollection = {
    async createIndex(keys, options) {
      calls.push({ keys, options })
      return "ok"
    },
  }
  return { collection, calls }
}

describe("A7.0 catalog indexes", () => {
  it("creates the uniqueness and lookup constraints the catalog depends on", async () => {
    const products = capture()
    const versions = capture()
    const mappings = capture()
    const catalogVersions = capture()

    await ensureCommercialCatalogIndexes({
      products: products.collection,
      versions: versions.collection,
      mappings: mappings.collection,
      catalogVersions: catalogVersions.collection,
    })

    expect(products.calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          keys: { id: 1 },
          options: expect.objectContaining({ unique: true }),
        }),
        expect.objectContaining({
          keys: { slug: 1 },
          options: expect.objectContaining({ unique: true }),
        }),
      ]),
    )
    expect(versions.calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          keys: { productId: 1, version: 1 },
          options: expect.objectContaining({ unique: true }),
        }),
      ]),
    )
    expect(mappings.calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          keys: { productVersionId: 1, cycle: 1, environment: 1 },
          options: expect.objectContaining({ unique: true }),
        }),
        expect.objectContaining({
          keys: { environment: 1, dodoProductId: 1 },
          options: expect.objectContaining({ unique: true }),
        }),
      ]),
    )
    expect(catalogVersions.calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          keys: { version: 1 },
          options: expect.objectContaining({ unique: true }),
        }),
      ]),
    )
    expect(
      products.calls.length + versions.calls.length + mappings.calls.length + catalogVersions.calls.length,
    ).toBe(13)
  })
})
