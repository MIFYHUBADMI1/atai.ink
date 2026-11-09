import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

// Phase 1 — historical Mobile Money top-up records must survive startup
// routines. The legacy `expiresAt` TTL index auto-deleted documents; it must
// not be re-created, and the legacy index must be actively dropped.

const source = readFileSync(resolve(process.cwd(), "lib/db/collections.ts"), "utf8")

describe("topups collection is not TTL-deleted at startup", () => {
  it("creates no expireAfterSeconds index on topups", () => {
    const topupsBlock = source.slice(
      source.indexOf("const topups = await topupsCol()"),
      source.indexOf("// Referral indexes"),
    )
    expect(topupsBlock).not.toBe("")
    expect(topupsBlock).not.toMatch(/expireAfterSeconds/)
  })

  it("drops the legacy topups TTL index in dropLegacyIndexes", () => {
    const dropBlock = source.slice(
      source.indexOf("async function dropLegacyIndexes"),
      source.indexOf("export async function ensureIndexes"),
    )
    expect(dropBlock).toMatch(/topups\.dropIndex\("expiresAt_1"\)/)
  })
})
