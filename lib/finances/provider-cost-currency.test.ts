import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * Phase 2 — provider-cost currency purity (structural guard).
 *
 * Before Phase 2 every rollup summed `costMetadata.providerCost` into a
 * field named providerCostUsd filtered ONLY by BSON numeric type — so a
 * provider price in UGX would silently inflate "USD" totals. The fix: USD-only
 * sums + a COUNTED (never summed) non-USD event counter. This scan keeps
 * that invariant visible in the test suite (same precedent style as
 * lib/db/collections-topups-retention.test.ts — source structure, not
 * behavior; behavior is covered by the rollup unit tests).
 */

const read = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8").replace(/\s+/g, " ")

const ROLLUPS = [
  "lib/runtime/control/breakdown.ts",
  "lib/runtime/control/analytics.ts",
  "lib/finances/project-finances.ts",
  "lib/finances/platform-finances.ts",
]

describe("provider-cost rollups are USD-guarded", () => {
  for (const file of ROLLUPS) {
    describe(file, () => {
      const source = read(file)

      it("sums providerCostUsd only for currency === USD", () => {
        expect(source).toContain(`$eq: ["$costMetadata.providerCostCurrency", "USD"]`)
      })

      it("counts non-USD numeric-cost events instead of silently dropping them", () => {
        expect(source).toMatch(/providerNonUsd/)
      })
    })
  }
})

describe("meter persists the explicit cost status (Phase 2 Workstream A)", () => {
  const source = read("lib/runtime/metering/meter.ts")

  it("stamps costStatus into costMetadata", () => {
    expect(source).toMatch(/costStatus:\s*costStatusFromProviderCost\(providerCost\)/)
    expect(source).toMatch(/costStatus:\s*"unavailable"\s*as const/)
  })
})

describe("economics endpoint enforces auth + ownership (Workstream F)", () => {
  const source = read("app/api/projects/[id]/economics/route.ts")

  it("gates on requireOwnedProject before computing anything", () => {
    expect(source).toContain("requireOwnedProject(id)")
    expect(source).toContain("gate.ok")
  })

  it("rejects non-finite window params with 422 VALIDATION", () => {
    expect(source).toContain('fail("VALIDATION"')
    expect(source).toContain("422")
  })
})
