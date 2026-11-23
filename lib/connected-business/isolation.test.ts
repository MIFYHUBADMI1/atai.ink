import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The isolation rule, enforced on the shipped source rather than a snapshot.
 *
 * I1: the connected-business surface never links into the build workspace.
 * I2: the build workspace never links into the business surface — the only
 *     mentions of a business route there are redirects, because a project that
 *     turns out to be an operate anchor must be forwarded, not rendered.
 */

const ROOT = path.resolve(__dirname, "..", "..")

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

function relative(files: string[]): string[] {
  return files.map((file) => path.relative(ROOT, file).replace(/\\/g, "/"))
}

const BUSINESS_LINK = /href\s*=\s*\{\s*[`"']\s*\/project\/|href\s*=\s*["'`]\/project\/|router\.(?:push|replace)\(\s*[`"']\/project\//
const BUSINESS_ROUTE = /\/business\/(?:\$\{|\w)/

describe("the two workspaces never link to each other", () => {
  it("writes no /project/ navigation inside the connected-business surface", () => {
    const files = [...walk(path.join(ROOT, "app/business")), ...walk(path.join(ROOT, "components/connected-business"))]
    const offenders = files.filter((file) => BUSINESS_LINK.test(readFileSync(file, "utf8")))
    expect(relative(offenders)).toEqual([])
  })

  it("mentions a business route in the build tree only to redirect there", () => {
    const files = walk(path.join(ROOT, "app/project"))
    const mentioning = files.filter((file) => BUSINESS_ROUTE.test(readFileSync(file, "utf8")))
    expect(relative(mentioning)).not.toEqual([])
    for (const file of mentioning) {
      const source = readFileSync(file, "utf8")
      expect(source, `${path.relative(ROOT, file)} must forward with redirect(), never link`).toContain("redirect(")
      expect(BUSINESS_LINK.test(source), `${path.relative(ROOT, file)} links into a business`).toBe(false)
    }
  })
})
