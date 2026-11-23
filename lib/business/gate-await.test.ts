import { readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The workspace gate became asynchronous when the rollout moved into admin
 * control. An unawaited async call is not a type error: it returns a Promise,
 * which is always truthy, so `if (!requireWorkspace(...))` silently stops
 * refusing anything. TypeScript cannot catch that, so this test does.
 *
 * Every entry point that gates on the rollout must await the gate.
 */

const ROOT = process.cwd()

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return entry.name === "route.ts" || entry.name === "page.tsx" ? [full] : []
  })
}

const GATED_CALLS = ["requireWorkspace(", "isBusinessWorkspaceEnabled("]

describe("workspace gate is always awaited", () => {
  const files = [...walk(join(ROOT, "app/api/businesses")), ...walk(join(ROOT, "app/business"))]

  it("covers the business surface", () => {
    expect(files.length).toBeGreaterThanOrEqual(8)
  })

  it.each(files.map((file) => [relative(ROOT, file), file] as const))("%s awaits every gate call", (_name, file) => {
    const lines = readFileSync(file, "utf8").split("\n")
    const offenders = lines
      .map((line, index) => ({ line, index: index + 1 }))
      .filter(({ line }) => GATED_CALLS.some((call) => line.includes(call)))
      .filter(({ line }) => !GATED_CALLS.some((call) => line.includes(`await ${call}`)))
      .filter(({ line }) => !line.trimStart().startsWith("import "))

    expect(offenders.map(({ line, index }) => `${index}: ${line.trim()}`)).toEqual([])
  })
})
