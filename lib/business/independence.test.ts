import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
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

const PROJECT_SIDE = ["lib/projects", "lib/marketing", "lib/cofounder", "lib/runtime", "app/project"]

function underPrefix(specifier: string, prefix: string): boolean {
  return specifier === prefix || specifier.startsWith(`${prefix}/`)
}

describe("business and project stay separate", () => {
  it("keeps lib/business free of project, marketing, cofounder and runtime imports", () => {
    const forbidden = [
      ...PROJECT_SIDE.map((tree) => `@/${tree}`),
      "@/lib/types/project",
      "@/lib/dashboard",
      "@/components/dashboard",
    ]
    const offenders: string[] = []
    for (const file of sourceFiles(join(ROOT, "lib/business"))) {
      for (const specifier of importedSpecifiers(file)) {
        if (forbidden.some((prefix) => underPrefix(specifier, prefix))) {
          offenders.push(`${relative(ROOT, file)} → ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it("keeps the project side free of business imports", () => {
    const offenders: string[] = []
    for (const tree of PROJECT_SIDE) {
      for (const file of sourceFiles(join(ROOT, tree))) {
        for (const specifier of importedSpecifiers(file)) {
          if (underPrefix(specifier, "@/lib/business")) {
            offenders.push(`${relative(ROOT, file)} → ${specifier}`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
