import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The price of finishing an existing business, quoted before anything is
 * created. The wizard relies on `shortfall` to decide whether to let the
 * founder press Connect, so it must be exact and never negative — and with a
 * project in hand it must quote only what is still unpaid.
 */

const { requireUser, getProject, businessJourneyCost, buildIntakeRecord, getExistingBusinessCosts, getAvailableCredits } =
  vi.hoisted(() => ({
    requireUser: vi.fn(),
    getProject: vi.fn(),
    businessJourneyCost: vi.fn(),
    buildIntakeRecord: vi.fn(() => ({})),
    getExistingBusinessCosts: vi.fn(),
    getAvailableCredits: vi.fn(),
  }))

vi.mock("@/lib/auth/session", () => ({ requireUser }))
vi.mock("@/lib/store/store", () => ({ store: { getProject } }))
vi.mock("@/lib/existing-business/intake", () => ({ businessJourneyCost, buildIntakeRecord }))
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
    getProject.mockResolvedValue({ id: "p1", userId: "user-1", intake: { website: { status: "completed" } } })
    businessJourneyCost.mockResolvedValue({
      readCost: 40,
      assessmentCost: 60,
      required: 60,
      available: 20,
      shortfall: 40,
    })
  })

  it("quotes the whole journey before a project exists, gap included", async () => {
    getAvailableCredits.mockResolvedValue(35)
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({
      readCost: 40,
      assessmentCost: 60,
      required: 100,
      available: 35,
      shortfall: 65,
    })
  })

  it("never reports a negative gap once the balance covers the journey", async () => {
    getAvailableCredits.mockResolvedValue(400)
    expect((await (await GET(req())).json()).data).toMatchObject({ required: 100, available: 400, shortfall: 0 })
  })

  it("prices only the unpaid stages once a project is given", async () => {
    const body = await (await GET(req("p1"))).json()
    expect(businessJourneyCost).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }), expect.anything())
    expect(body.data).toMatchObject({ required: 60, shortfall: 40 })
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
    expect((await (await GET(req())).json()).data).toMatchObject({ required: 25, shortfall: 15 })
  })
})
