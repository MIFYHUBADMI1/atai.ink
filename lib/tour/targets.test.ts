import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { TOUR_TARGETS, TOUR_TARGET_ATTR, isTourTargetId } from "./targets"
import { referencedTargets } from "./registry"

/**
 * A registered target is a promise that a real control exists. This test keeps
 * that promise: it reads the shipped markup, not a snapshot, so deleting or
 * renaming an annotated element fails here rather than leaving a founder
 * staring at a tour that points at nothing.
 *
 * Three ways an element declares itself, all produced by this product:
 *   data-atai-tour="projects-list"                 a literal anchor
 *   data-atai-tour={`new-method-${source.id}`}     one anchor per item in a list
 *   data-atai-tour={item.tour} with tour: "..."    a navigation table entry
 * A shell component can also take the id as a prop (`heroTourTarget="…"` on the
 * caller, `data-atai-tour={heroTourTarget}` inside), which the second pass below
 * resolves. Without it a tour would look unanchored while really pointing at the
 * element the shell renders.
 */

const ROOT = path.resolve(__dirname, "..", "..")
const DIRS = ["app", "components"]

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(path.join(ROOT, dir))) {
    const full = path.join(ROOT, dir, entry)
    if (entry === "node_modules" || entry.startsWith(".")) continue
    if (statSync(full).isDirectory()) out.push(...sourceFilesRelative(full))
    else if (/\.(tsx|ts)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

function sourceFilesRelative(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...sourceFilesRelative(full))
    else if (/\.(tsx|ts)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

/** Absolute paths of every id found, so a failure names the file to fix. */
function annotatedTargets(): Map<string, string[]> {
  const found = new Map<string, string[]>()
  const add = (id: string, file: string) => {
    const list = found.get(id) ?? []
    if (!list.includes(file)) list.push(file)
    found.set(id, list)
  }

  const files = DIRS.flatMap(sourceFiles).map((file) => ({
    file,
    relative: path.relative(ROOT, file).replace(/\\/g, "/"),
    text: readFileSync(file, "utf8"),
  }))

  const propNames = new Set<string>()

  for (const { relative, text } of files) {
    for (const match of text.matchAll(new RegExp(`${TOUR_TARGET_ATTR}="([a-z0-9-]+)"`, "g"))) {
      add(match[1], relative)
    }

    // A template anchor yields one id per `id: "…"` in the same component.
    for (const match of text.matchAll(new RegExp(`${TOUR_TARGET_ATTR}=\\{` + "`" + `([a-z0-9-]*)\\$\\{`, "g"))) {
      const prefix = match[1]
      for (const item of text.matchAll(/\bid:\s*"([a-z0-9-]+)"/g)) {
        add(`${prefix}${item[1]}`, relative)
      }
    }

    // Navigation tables feed `data-atai-tour={item.tour}`.
    for (const match of text.matchAll(/\btour:\s*"([a-z0-9-]+)"/g)) {
      add(match[1], relative)
    }

    for (const match of text.matchAll(new RegExp(`${TOUR_TARGET_ATTR}=\\{([A-Za-z][A-Za-z0-9]*)\\}`, "g"))) {
      propNames.add(match[1])
    }
  }

  // A shell renders the attribute from a prop; the caller supplies the literal.
  for (const prop of propNames) {
    const pattern = new RegExp(`\\b${prop}="([a-z0-9-]+)"`, "g")
    for (const { relative, text } of files) {
      for (const match of text.matchAll(pattern)) add(match[1], relative)
    }
  }

  return found
}

const annotated = annotatedTargets()

describe("guided-tour target registry matches the real interface", () => {
  it("scans some markup", () => {
    // Guards the test itself: an empty scan would pass everything vacuously.
    expect(annotated.size).toBeGreaterThan(30)
  })

  it("only registers ids that exist as an element in the product", () => {
    const missing = Object.keys(TOUR_TARGETS).filter((id) => !annotated.has(id))
    expect(missing, `Registered with no element: ${missing.join(", ")}`).toEqual([])
  })

  it("only points tours at registered, existing elements", () => {
    const referenced = referencedTargets()
    const unregistered = referenced.filter((id) => !isTourTargetId(id))
    expect(unregistered, `Steps target unregistered ids: ${unregistered.join(", ")}`).toEqual([])

    const absent = referenced.filter((id) => !annotated.has(id))
    expect(absent, `Steps target ids with no element: ${absent.join(", ")}`).toEqual([])
  })

  it("has no anchor in markup that the registry does not know", () => {
    // An attribute nobody can address is a maintenance trap: it looks wired up
    // and silently stops working the day the element moves.
    const orphans = [...annotated.keys()].filter((id) => !isTourTargetId(id))
    expect(orphans, `In markup but not registered: ${orphans.join(", ")}`).toEqual([])
  })
})
