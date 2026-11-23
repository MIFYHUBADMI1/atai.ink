import { describe, expect, it, vi } from "vitest"
const { PLAN, PACK } = vi.hoisted(() => ({
  PLAN: {
    id: "starter",
    name: "SENTINEL_PLAN",
    tagline: "Resolved plan",
    priceUSD: 89.99,
    mirrorCredits: 150_000,
    interval: "monthly",
    active: true,
    features: ["Resolved feature"],
  },
  PACK: {
    id: "perm_200k",
    label: "SENTINEL_PACK",
    credits: 200_000,
    priceUSD: 20,
  },
}))

vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => ({ id: "user_1" })),
}))

vi.mock("@/lib/billing/credit-service", () => ({
  getBalance: vi.fn(async () => ({ total: 100, subscription: 100, permanent: 0 })),
  getCreditHistory: vi.fn(async () => []),
}))

vi.mock("@/lib/db/collections", () => ({
  subscriptionRecordsCol: vi.fn(async () => ({
    find: () => ({
      sort: () => ({
        limit: () => ({
          toArray: async () => [],
        }),
      }),
    }),
  })),
}))

vi.mock("@/lib/billing/entitlements", () => ({
  resolveEntitlements: vi.fn(async () => ({ credits: { monthlyGrant: 100 } })),
  getBusinessCount: vi.fn(async () => 0),
  computeUsageAlerts: vi.fn(() => null),
  resolveCommercialPlan: vi.fn(() => ({ commercialPlanId: "starter" })),
}))

vi.mock("@/lib/billing/catalog/published-resolver", () => ({
  resolvePublicCommercialCatalog: vi.fn(async () => ({
    source: "db",
    plans: [PLAN],
    packs: [PACK],
  })),
}))

import { GET } from "./route"
import { resolvePublicCommercialCatalog } from "@/lib/billing/catalog/published-resolver"

describe("GET /api/billing/overview catalog source", () => {
  it("returns the published resolver plans and packs", async () => {
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.plans).toEqual([PLAN])
    expect(body.data.packs).toEqual([PACK])
    expect(resolvePublicCommercialCatalog).toHaveBeenCalledTimes(1)
  })
})
