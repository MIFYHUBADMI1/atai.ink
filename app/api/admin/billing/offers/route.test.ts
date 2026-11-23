import { beforeEach, describe, expect, it, vi } from "vitest"

const { offers, getPromotionalOffers, updatePromotionalOffers, requireAdmin } = vi.hoisted(() => ({
  offers: { current: [] as unknown[] },
  getPromotionalOffers: vi.fn(),
  updatePromotionalOffers: vi.fn(),
  requireAdmin: vi.fn(),
}))

vi.mock("@/lib/auth/session", () => ({ requireAdmin }))
vi.mock("@/lib/billing/runtime-config", () => ({
  getPromotionalOffers,
  updatePromotionalOffers,
}))
vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock("@/lib/store/id", () => ({ cryptoId: () => "fixed" }))

import { DELETE, GET, POST } from "./route"

function request(body: Record<string, unknown>, method = "POST") {
  return new Request("http://localhost/api/admin/billing/offers", {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body),
  })
}

describe("admin billing offers", () => {
  beforeEach(() => {
    offers.current = []
    requireAdmin.mockReset().mockResolvedValue({ id: "admin_1" })
    getPromotionalOffers.mockReset().mockImplementation(async () => offers.current)
    updatePromotionalOffers.mockReset().mockImplementation(async (next: unknown[]) => {
      offers.current = next
      return next
    })
  })

  it("lists offers", async () => {
    offers.current = [{ id: "offer_1", name: "Launch" }]
    const response = await GET()
    expect(response.status).toBe(200)
    expect((await response.json()).data.offers).toEqual(offers.current)
  })

  it("creates an offer and rejects an end before its start", async () => {
    const response = await POST(
      request({
        name: "Launch bonus",
        description: "Extra credits",
        status: "active",
        target: "all",
        productIds: [],
        bonusCredits: 2_000,
        startsAt: 2_000,
        endsAt: 1_000,
      }),
    )
    expect(response.status).toBe(422)

    const created = await POST(
      request({
        name: "Launch bonus",
        description: "Extra credits",
        status: "active",
        target: "all",
        productIds: [],
        bonusCredits: 2_000,
        startsAt: null,
        endsAt: null,
      }),
    )
    expect(created.status).toBe(200)
    expect(updatePromotionalOffers).toHaveBeenCalledTimes(1)
    expect((await created.json()).data.offer).toMatchObject({
      id: "offer_fixed",
      name: "Launch bonus",
      bonusCredits: 2_000,
      status: "active",
    })
  })

  it("deletes an offer", async () => {
    offers.current = [{ id: "offer_1", name: "Launch" }]
    const response = await DELETE(new Request("http://localhost/api/admin/billing/offers?id=offer_1", { method: "DELETE" }))
    expect(response.status).toBe(200)
    expect((await response.json()).data.deleted).toBe("offer_1")
    expect(offers.current).toEqual([])
  })
})
