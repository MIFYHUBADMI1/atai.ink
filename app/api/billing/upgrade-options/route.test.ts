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
    features: [],
  },
  PACK: {
    id: "perm_200k",
    label: "SENTINEL_PACK",
    credits: 200_000,
    priceUSD: 20,
  },
}))

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: vi.fn(async () => ({ id: "user_1" })),
}))

vi.mock("@/lib/billing/credit-service", () => ({
  getAvailableCredits: vi.fn(async () => 100),
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

describe("GET /api/billing/upgrade-options catalog source", () => {
  it("advises from the published resolver plans and packs", async () => {
    const response = await GET(
      new Request("https://atai.example/api/billing/upgrade-options?required=50000"),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "plan", title: "SENTINEL_PLAN" }),
        expect.objectContaining({ kind: "pack", title: "SENTINEL_PACK" }),
      ]),
    )
    expect(resolvePublicCommercialCatalog).toHaveBeenCalledTimes(1)
  })
})
