import { readFileSync, readdirSync } from "node:fs"
import { basename, join, relative, sep } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Structural guard: every exported business operation either authorises itself
 * or sits on a short, justified allowlist.
 *
 * The check is deliberately source-based, because a behavioural test can only
 * cover the operations someone remembered to test. It is also deliberately
 * narrow about what it proves: a gate call must appear before the first write
 * in the same function body. It cannot tell that the gate's business id matches
 * the row being written — that remains a review responsibility, and every
 * operation keeps its own behavioural test for the refusal paths.
 */

const ROOT = process.cwd()
const BUSINESS_DIR = join(ROOT, "lib/business")

/** Modules that hold no business data: constants, pure helpers, env reads. */
const PURE_MODULES = new Set(["paths.ts", "permissions.ts", "flags.ts"])

/** Test-support modules, not service operations. */
const TEST_SUPPORT_DIRS = new Set(["testing"])

/**
 * Operations that legitimately do not call the gate, with the rule that
 * protects them instead. Every entry is a promise about how it is safe.
 */
const EXEMPT: Record<string, string> = {
  requireBusinessAccess: "is the authorisation mechanism itself",
  createBusiness: "creation: the owner is the acting user, never a caller-supplied id",
  addOwner: "system actor only, and only while the business has zero members",
  listBusinessesForUser: "self-scoped: queries by the acting user's id, with no ownership parameter",
  isBusinessRole: "pure type guard",
  isApplicationKind: "pure type guard",
  applicationAddress: "pure formatting, reads no stored record",
}

const GATE_CALL = "requireBusinessAccess("
const WRITE_CALL = /\.(insertOne|updateOne|deleteOne|deleteMany|findOneAndUpdate|bulkWrite)\(/

interface Operation {
  name: string
  body: string
  file: string
}

const FUNCTION_EXPORT = /\nexport (?:async )?function (\w+)/g
const ARROW_EXPORT = /\nexport const (\w+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/g

function operationsIn(source: string, file: string): Operation[] {
  const found: { name: string; start: number }[] = []
  for (const match of source.matchAll(FUNCTION_EXPORT)) {
    found.push({ name: match[1], start: match.index ?? 0 })
  }
  for (const match of source.matchAll(ARROW_EXPORT)) {
    found.push({ name: match[1], start: match.index ?? 0 })
  }
  found.sort((a, b) => a.start - b.start)
  return found.map((entry, index) => ({
    name: entry.name,
    body: source.slice(entry.start, index + 1 < found.length ? found[index + 1].start : source.length),
    file,
  }))
}

function walkSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return walkSourceFiles(full)
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [full] : []
  })
}

function collectSourceFiles(dir: string): string[] {
  return walkSourceFiles(dir).filter(
    (file) => !relative(dir, file).split(sep).some((part) => TEST_SUPPORT_DIRS.has(part)),
  )
}

function serviceOperations(): Operation[] {
  return collectSourceFiles(BUSINESS_DIR)
    .filter((file) => !PURE_MODULES.has(basename(file)))
    .flatMap((file) => operationsIn(readFileSync(file, "utf8"), relative(ROOT, file)))
}

function ungated(operations: Operation[]): string[] {
  return operations
    .filter((operation) => !EXEMPT[operation.name] && !operation.body.includes(GATE_CALL))
    .map((operation) => `${operation.file}:${operation.name}`)
}

describe("service-boundary authorization", () => {
  it("gates every exported operation, or explains why it is exempt", () => {
    expect(ungated(serviceOperations())).toEqual([])
  })

  it("keeps the exemption list honest — no stale entries", () => {
    const names = new Set(serviceOperations().map((operation) => operation.name))
    const stale = Object.keys(EXEMPT).filter((name) => !names.has(name))
    expect(stale).toEqual([])
  })

  it("authorises before the first write", () => {
    const offenders = serviceOperations()
      .filter((operation) => !EXEMPT[operation.name])
      .filter((operation) => WRITE_CALL.test(operation.body))
      .filter((operation) => {
        const gateAt = operation.body.indexOf(GATE_CALL)
        const writeAt = operation.body.search(WRITE_CALL)
        return gateAt === -1 || gateAt > writeAt
      })
      .map((operation) => `${operation.file}:${operation.name}`)

    expect(offenders).toEqual([])
  })

  it("keeps the operations that change data on the gated side", () => {
    const mustGate = [
      "createApplication",
      "archiveApplication",
      "getApplication",
      "listApplications",
      "addMember",
      "removeMember",
      "reactivateMember",
      "listMembers",
      "resolveMember",
      "getBusiness",
      "renameBusiness",
      "archiveBusiness",
    ]
    const names = serviceOperations().map((operation) => operation.name)
    for (const name of mustGate) {
      expect(names, `${name} should still exist`).toContain(name)
      expect(EXEMPT[name], `${name} must not be exempt`).toBeUndefined()
    }
  })

  it("fails when a new ungated function export is introduced", () => {
    const synthetic = `
export async function deleteBusiness(input: { businessId: string }) {
  await (await businessesCol()).deleteOne({ id: input.businessId })
}
`
    expect(ungated(operationsIn(synthetic, "synthetic.ts"))).toEqual(["synthetic.ts:deleteBusiness"])
  })

  it("fails when a new ungated arrow export is introduced", () => {
    const synthetic = `
export const deleteBusiness = async (input: { businessId: string }) => {
  await (await businessesCol()).deleteOne({ id: input.businessId })
}
`
    expect(ungated(operationsIn(synthetic, "synthetic.ts"))).toEqual(["synthetic.ts:deleteBusiness"])
  })

  it("walks nested modules, so a new subpackage cannot hide", () => {
    const walked = walkSourceFiles(BUSINESS_DIR).map((file) => relative(ROOT, file))
    const collected = collectSourceFiles(BUSINESS_DIR).map((file) => relative(ROOT, file))
    expect(walked.some((file) => file.includes("/testing/"))).toBe(true)
    expect(collected.some((file) => file.includes("/testing/"))).toBe(false)
  })
})
