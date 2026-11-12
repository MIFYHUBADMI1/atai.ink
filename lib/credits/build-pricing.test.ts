import { beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * Phase 0 W3 — build pricing authority (R-01).
 *
 * The manual build route (app/api/projects/[id]/build/route.ts) used to reserve
 * with the legacy-only `getBuildCost`, while the automatic pipeline
 * (lib/analysis/pipeline.ts) reserved with the mode-aware `getTierCost`. A
 * heavy-mode project was therefore quoted heavy and charged legacy. Both paths
 * now derive the reservation from the SAME authority call, and the pricing page
 * reads that authority too, so displayed == charged.
 *
 * Part 1 pins the real getTierCost math (modes, tiers, rounding, admin
 * overrides). Part 2 is a structural guard — same precedent style as
 * lib/finances/provider-cost-currency.test.ts — that keeps the two call sites
 * and the pricing page from drifting back apart.
 */

vi.mock("server-only", () => ({}))

const mocks = vi.hoisted(() => ({
  getBuildTierCosts: vi.fn(),
}))

vi.mock("@/lib/store/store", () => ({ store: {}, cryptoId: vi.fn(() => "id") }))
vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock("@/lib/billing/credit-service", () => ({ getAvailableCredits: vi.fn() }))
vi.mock("@/lib/billing/runtime-config", () => ({
  getBuildTierCosts: mocks.getBuildTierCosts,
  getMirrorPipelineCosts: vi.fn(),
  DEFAULT_MIRROR_PIPELINE_COSTS: {
    scrapeCost: 5,
    heavyScrapeCost: 100,
    planCost: 5,
    heavyPlanCost: 100,
    deepCrawlCost: 500,
    heavyDeepCrawlCost: 1000,
  },
}))

import { getTierCost } from "./credits"

// The documented heavy/legacy ratios (HEAVY_TIER_COSTS / TIER_COSTS in credits.ts).
const HEAVY_SCALE = { simple: 2, medium: 1.5, complex: 100000 / 75000 } as const
const DEFAULT_BASE = { simple: 50000, medium: 75000, complex: 100000 } as const

beforeEach(() => {
  mocks.getBuildTierCosts.mockReset()
  mocks.getBuildTierCosts.mockResolvedValue({ ...DEFAULT_BASE })
})

describe("getTierCost — legacy mode charges the runtime base", () => {
  for (const tier of ["simple", "medium", "complex"] as const) {
    it(`returns the base cost for ${tier}`, async () => {
      expect(await getTierCost(tier, "legacy")).toBe(DEFAULT_BASE[tier])
    })
  }

  it("treats an omitted mode as legacy", async () => {
    expect(await getTierCost("simple")).toBe(await getTierCost("simple", "legacy"))
    expect(await getTierCost("complex")).toBe(DEFAULT_BASE.complex)
  })
})

describe("getTierCost — heavy mode scales the base by the tier ratio", () => {
  it("prices simple ×2, medium ×1.5, complex ×4/3 (rounded)", async () => {
    expect(await getTierCost("simple", "heavy")).toBe(100000)
    expect(await getTierCost("medium", "heavy")).toBe(112500)
    expect(await getTierCost("complex", "heavy")).toBe(133333)
  })

  for (const tier of ["simple", "medium", "complex"] as const) {
    it(`charges heavy ${tier} above legacy ${tier}`, async () => {
      const legacy = await getTierCost(tier, "legacy")
      const heavy = await getTierCost(tier, "heavy")
      expect(heavy).toBe(Math.round(DEFAULT_BASE[tier] * HEAVY_SCALE[tier]))
      expect(heavy).toBeGreaterThan(legacy)
    })
  }
})

describe("getTierCost — admin overrides flow through both modes", () => {
  beforeEach(() => {
    mocks.getBuildTierCosts.mockResolvedValue({ simple: 10000, medium: 20000, complex: 30000 })
  })

  it("legacy charges the overridden base, not the code default", async () => {
    expect(await getTierCost("simple", "legacy")).toBe(10000)
    expect(await getTierCost("medium", "legacy")).toBe(20000)
    expect(await getTierCost("complex", "legacy")).toBe(30000)
  })

  it("heavy scales the overridden base, so display and charge move together", async () => {
    expect(await getTierCost("simple", "heavy")).toBe(20000)
    expect(await getTierCost("medium", "heavy")).toBe(30000)
    expect(await getTierCost("complex", "heavy")).toBe(40000)
  })
})

describe("getTierCost — unknown tier falls back to medium", () => {
  it("uses the medium base in legacy mode", async () => {
    expect(await getTierCost("galaxy", "legacy")).toBe(DEFAULT_BASE.medium)
  })

  it("uses the medium ratio in heavy mode", async () => {
    expect(await getTierCost("galaxy", "heavy")).toBe(await getTierCost("medium", "heavy"))
  })
})

// ─── Structural parity guard ─────────────────────────────────────────────────

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\s+/g, " ")

const MANUAL_ROUTE = "app/api/projects/[id]/build/route.ts"
const PIPELINE = "lib/analysis/pipeline.ts"
const PRICING_PAGE = "app/pricing/page.tsx"

// The identical reservation derivation both build paths must use.
const DERIVATION = [
  `const tier = project.specification.complexity ?? classifyComplexity(project.specification)`,
  `const pipelineMode = project.pipelineMode ?? "legacy"`,
  `const creditsNeeded = await getTierCost(tier, pipelineMode)`,
]

describe("manual and automatic builds reserve from the same authority", () => {
  for (const file of [MANUAL_ROUTE, PIPELINE]) {
    describe(file, () => {
      const source = read(file)
      for (const snippet of DERIVATION) {
        it(`derives the reservation with: ${snippet.slice(0, 48)}…`, () => {
          expect(source).toContain(snippet)
        })
      }
    })
  }

  it("the manual route no longer prices the initial build with legacy-only getBuildCost", () => {
    expect(read(MANUAL_ROUTE)).not.toContain("getBuildCost")
  })
})

describe("pricing page reads the billing authority instead of hardcoded numbers", () => {
  const source = read(PRICING_PAGE)

  it("imports the runtime build-tier and deployment costs", () => {
    expect(source).toContain(
      `import { getBuildTierCosts, getDeploymentCosts } from "@/lib/billing/runtime-config"`,
    )
  })

  it("derives the displayed launch and publishing costs from the authority", () => {
    expect(source).toContain("const simpleCredits = buildTierCosts.simple")
    expect(source).toContain("const deployCost = deploymentCosts.deployCost")
    expect(source).toContain("credits: tierCosts[entry.tier.id]")
  })

  it("no longer hardcodes the 500-credit publishing cost", () => {
    expect(source).not.toContain("500 {CREDIT_UNIT_NAME}")
    expect(source).not.toContain("Publishing takes 500 credits")
  })
})