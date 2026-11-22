import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The price of finishing an existing business, quoted before anything is
 * created. The wizard relies on `shortfall` to decide whether to let the
 * founder press Connect, so it must be exact and never negative — and with a
 * project in hand it must quote only what is still unpaid.
 */

const {
  requireUser,
  getProject,
  businessJourneyCost,
  buildIntakeRecord,
  assessmentEngineSurcharge,
  getExistingBusinessCosts,
  getAvailableCredits,
} = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getProject: vi.fn(),
  businessJourneyCost: vi.fn(),
  buildIntakeRecord: vi.fn(() => ({})),
  assessmentEngineSurcharge: vi.fn(),
  getExistingBusinessCosts: vi.fn(),
  getAvailableCredits: vi.fn(),
}))

vi.mock("@/lib/auth/session", () => ({ requireUser }))
vi.mock("@/lib/store/store", () => ({ store: { getProject } }))
vi.mock("@/lib/existing-business/intake", () => ({
  businessJourneyCost,
  buildIntakeRecord,
  assessmentEngineSurcharge,
}))
vi.mock("@/lib/billing/runtime-config", () => ({ getExistingBusinessCosts }))
vi.mock("@/lib/billing/credit-service", () => ({ getAvailableCredits }))
vi.mock("@/lib/logging/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { GET } from "./route"

const req = (projectId?: string) =>
  new Request(`https://atai.ink/api/billing/business-connect${projectId ? `?projectId=${projectId}` : ""}`)

describe("GET /api/billing/business-connect", () => {
  beforeEach(() => {
    requireUser.mockResolvedValue({ id: "user-1" })
    getExistingBusinessCosts.mockResolvedValue({ readCost: 40, assessmentCost: 60 })
    assessmentEngineSurcharge.mockResolvedValue({ cost: 5, name: "Ember" })
    getProject.mockResolvedValue({ id: "p1", userId: "user-1", intake: { website: { status: "completed" } } })
    businessJourneyCost.mockResolvedValue({
      readCost: 40,
      assessmentCost: 60,
      engineCost: 5,
      engineName: "Ember",
      required: 65,
      available: 20,
      shortfall: 45,
    })
  })

  it("quotes the whole journey before a project exists, gap included", async () => {
    getAvailableCredits.mockResolvedValue(35)
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({
      readCost: 40,
      assessmentCost: 60,
      engineCost: 5,
      engineName: "Ember",
      required: 105,
      available: 35,
      shortfall: 70,
    })
  })

  it("never reports a negative gap once the balance covers the journey", async () => {
    getAvailableCredits.mockResolvedValue(400)
    expect((await (await GET(req())).json()).data).toMatchObject({ required: 105, available: 400, shortfall: 0 })
  })

  it("prices only the unpaid stages once a project is given", async () => {
    const body = await (await GET(req("p1"))).json()
    expect(businessJourneyCost).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }), expect.anything())
    expect(body.data).toMatchObject({ required: 65, shortfall: 45, engineCost: 5 })
  })

  it("refuses another founder's project without leaking its price", async () => {
    getProject.mockResolvedValue({ id: "p1", userId: "user-2" })
    const res = await GET(req("p1"))
    expect(res.status).toBe(404)
    expect(businessJourneyCost).not.toHaveBeenCalled()
  })

  it("follows the admin's runtime prices rather than a hard-coded total", async () => {
    getExistingBusinessCosts.mockResolvedValue({ readCost: 5, assessmentCost: 20 })
    getAvailableCredits.mockResolvedValue(10)
    expect((await (await GET(req())).json()).data).toMatchObject({ required: 30, shortfall: 20 })
  })

  it("adds the founder's engine on top of the write, and says which engine", async () => {
    getAvailableCredits.mockResolvedValue(500)
    const body = await (await GET(req())).json()
    expect(assessmentEngineSurcharge).toHaveBeenCalledWith("user-1")
    expect(body.data).toMatchObject({ assessmentCost: 60, engineCost: 5, engineName: "Ember", required: 105 })
  })

  it("charges nothing extra when the founder is on a free engine", async () => {
    assessmentEngineSurcharge.mockResolvedValue({ cost: 0, name: "Spark" })
    getAvailableCredits.mockResolvedValue(500)
    const body = await (await GET(req())).json()
    expect(body.data).toMatchObject({ engineCost: 0, required: 100 })
  })
})
