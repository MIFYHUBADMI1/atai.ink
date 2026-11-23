import { readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Structural guard: every exported business operation either authorises itself
 * or sits on a short, justified allowlist.
 *
 * This is deliberately source-based rather than behavioural. A new mutating
 * service added without a gate fails here even if nobody writes a test for it.
 */

const ROOT = process.cwd()
const BUSINESS_DIR = join(ROOT, "lib/business")

/** Modules that hold no business data: constants, pure helpers, env reads. */
const PURE_MODULES = new Set(["paths.ts", "permissions.ts", "flags.ts"])

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

function operationsIn(source: string, file: string): Operation[] {
  return source
    .split(/\nexport (?:async )?function /)
    .slice(1)
    .map((part) => ({ name: part.slice(0, part.indexOf("(")), body: part, file }))
}

function serviceOperations(): Operation[] {
  return readdirSync(BUSINESS_DIR)
    .filter((entry) => entry.endsWith(".ts") && !entry.endsWith(".test.ts"))
    .filter((entry) => !PURE_MODULES.has(entry))
    .flatMap((entry) => {
      const file = join(BUSINESS_DIR, entry)
      return operationsIn(readFileSync(file, "utf8"), relative(ROOT, file))
    })
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

  it("fails when a new ungated mutating operation is introduced", () => {
    const synthetic = `
export async function deleteBusiness(input: { businessId: string }) {
  await (await businessesCol()).deleteOne({ id: input.businessId })
}
`
    expect(ungated(operationsIn(synthetic, "synthetic.ts"))).toEqual(["synthetic.ts:deleteBusiness"])
  })
})
