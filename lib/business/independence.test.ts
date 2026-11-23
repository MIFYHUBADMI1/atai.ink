import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = process.cwd()

function sourceFiles(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

function importedSpecifiers(file: string): string[] {
  const source = readFileSync(file, "utf8")
  return [...source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((match) => match[1])
}

/** `@/x` and `./x` both become absolute paths, so a relative import cannot slip past. */
function resolveSpecifier(specifier: string, fromFile: string): string {
  if (specifier.startsWith("@/")) return join(ROOT, specifier.slice(2))
  if (specifier.startsWith(".")) return resolve(dirname(fromFile), specifier)
  return specifier
}

function underPrefix(target: string, prefix: string): boolean {
  return target === prefix || target.startsWith(`${prefix}/`)
}

const PROJECT_SIDE = ["lib/projects", "lib/marketing", "lib/cofounder", "lib/runtime", "app/project"]

describe("business and project stay separate", () => {
  it("keeps lib/business free of project, marketing, cofounder and runtime imports", () => {
    const forbidden = [
      ...PROJECT_SIDE.map((tree) => join(ROOT, tree)),
      join(ROOT, "lib/types/project"),
      join(ROOT, "lib/dashboard"),
      join(ROOT, "components/dashboard"),
    ]
    const offenders: string[] = []
    for (const file of sourceFiles(join(ROOT, "lib/business"))) {
      for (const specifier of importedSpecifiers(file)) {
        const target = resolveSpecifier(specifier, file)
        if (forbidden.some((prefix) => underPrefix(target, prefix))) {
          offenders.push(`${relative(ROOT, file)} → ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it("keeps the project side free of business imports", () => {
    const business = join(ROOT, "lib/business")
    const offenders: string[] = []
    for (const tree of PROJECT_SIDE) {
      for (const file of sourceFiles(join(ROOT, tree))) {
        for (const specifier of importedSpecifiers(file)) {
          if (underPrefix(resolveSpecifier(specifier, file), business)) {
            offenders.push(`${relative(ROOT, file)} → ${specifier}`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it("catches a relative import that crosses the boundary", () => {
    const from = join(ROOT, "lib/business/access.ts")
    expect(underPrefix(resolveSpecifier("../../lib/projects/foo", from), join(ROOT, "lib/projects"))).toBe(true)
    expect(underPrefix(resolveSpecifier("./members", from), join(ROOT, "lib/projects"))).toBe(false)
  })
})
