import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = process.cwd()
const SELF = "no-owner-shortcut.test.ts"

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.(ts|tsx)$/.test(entry) && entry !== SELF) out.push(full)
  }
  return out
}

/**
 * Authorisation must go through a membership row. Comparing the business id to
 * a user id would make the owner implicit and the gate bypassable.
 */
const OWNER_SHORTCUTS = [
  /businessId\s*===?\s*(?:actor\.id|user\.id|userId|user\?\.id)/,
  /(?:actor\.id|user\.id|userId|user\?\.id)\s*===?\s*businessId/,
  /ownerId\s*===?\s*(?:actor\.id|user\.id|userId|user\?\.id)/,
]

describe("no owner shortcut", () => {
  it("never authorises by comparing a business or owner id to a user id", () => {
    const offenders: string[] = []
    for (const file of sourceFiles(join(ROOT, "lib/business"))) {
      const source = readFileSync(file, "utf8")
      for (const pattern of OWNER_SHORTCUTS) {
        if (pattern.test(source)) offenders.push(`${relative(ROOT, file)} matches ${pattern}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("keeps membership lookups keyed by business and user together", () => {
    const access = readFileSync(join(ROOT, "lib/business/access.ts"), "utf8")
    expect(access).toMatch(/businessMembersCol\(\)\)\.findOne\(\{[\s\S]*businessId:[\s\S]*userId:[\s\S]*status: "active"/)
  })
})
