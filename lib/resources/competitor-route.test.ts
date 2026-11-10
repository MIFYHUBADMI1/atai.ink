import { beforeEach, describe, expect, it, vi } from "vitest"
import { scopedIntentKey } from "@/lib/billing/operation-identity"

const mocks = vi.hoisted(() => ({
  user: vi.fn(), getProject: vi.fn(), updateProject: vi.fn(), charge: vi.fn(), refund: vi.fn(),
  generate: vi.fn(), available: vi.fn(), ledger: vi.fn(),
}))
vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.user }))
vi.mock("@/lib/store/store", () => ({ store: { getProject: mocks.getProject, updateProject: mocks.updateProject } }))
vi.mock("@/lib/resources/resources-credits", () => ({ chargeCompetitors: mocks.charge, refundResources: mocks.refund }))
vi.mock("@/lib/resources/ai-retry", () => ({ generateWithRetry: mocks.generate, logAIFailure: vi.fn() }))
vi.mock("@/lib/billing/credit-service", () => ({ getAvailableCredits: mocks.available }))
vi.mock("@/lib/db/collections", () => ({ creditLedgerCol: async () => ({ findOne: mocks.ledger }) }))
vi.mock("@/lib/api/ai-protection", () => ({ withAiProtection: (_kind: string, handler: unknown) => handler }))
vi.mock("@/lib/api/respond", () => ({
  ok: (data: unknown) => Response.json({ ok: true, data }),
  fail: (code: string, message: string, status = 400) => Response.json({ ok: false, error: { code, message } }, { status }),
  handleRouteError: (_stage: string, error: { code?: string; status?: number }) => Response.json({ ok: false, error: { code: error.code ?? "ERROR" } }, { status: error.status ?? 500 }),
}))
vi.mock("@/lib/api/credit-refusal", () => ({ refuseInsufficientCredits: async () => Response.json({ ok: false }, { status: 402 }) }))
import { POST } from "@/app/api/projects/[id]/resources/competitors/route"

const key = scopedIntentKey("request-123", { userId: "u1", projectId: "p1", operation: "resources_competitors" })!
const project = { id: "p1", userId: "u1", specification: { title: "Acme", description: "Portal", targetUsers: ["Bookkeepers"] }, resourcesCache: { marketResearch: { text: "Existing research" } } }
const request = (body: unknown = { requestId: "request-123" }) => new Request("http://localhost/api/projects/p1/resources/competitors", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } })
const invoke = (body?: unknown) => POST(request(body), { params: Promise.resolve({ id: "p1" }) })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.user.mockResolvedValue({ id: "u1" })
  mocks.getProject.mockResolvedValue(structuredClone(project))
  mocks.updateProject.mockResolvedValue(project)
  mocks.charge.mockResolvedValue(true)
  mocks.available.mockResolvedValue(900)
  mocks.generate.mockResolvedValue('[{"name":"Other","strengths":["Possible familiarity"]}]')
  mocks.ledger.mockResolvedValue(null)
})

describe("Resources competitor route boundaries", () => {
  it.each([null, [], {}, { requestId: "x" }, { requestId: "unsafe~id" }, { requestId: {} }])("rejects invalid request identity before charging", async (body) => {
    const response = await invoke(body)
    expect(response.status).toBe(422)
    expect((await response.json()).error.code).toBe("VALIDATION")
    expect(mocks.charge).not.toHaveBeenCalled()
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it("rejects foreign and missing projects before reading results or billing", async () => {
    for (const value of [null, { ...project, userId: "u2" }]) {
      mocks.getProject.mockResolvedValue(value)
      expect((await invoke()).status).toBe(404)
    }
    expect(mocks.ledger).not.toHaveBeenCalled()
    expect(mocks.charge).not.toHaveBeenCalled()
  })
  it("does not generate when authentication fails", async () => {
    mocks.user.mockRejectedValue({ code: "UNAUTHORIZED", status: 401 })
    expect((await invoke()).status).toBe(401)
    expect(mocks.getProject).not.toHaveBeenCalled()
  })
  it("preserves the existing charge attribution and returns the persisted generation time", async () => {
    const response = await invoke()
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(mocks.charge).toHaveBeenCalledWith("u1", "p1", key)
    const cache = mocks.updateProject.mock.calls[0][1].resourcesCache
    expect(cache.marketResearch).toEqual(project.resourcesCache.marketResearch)
    expect(cache.competitors).toMatchObject({ intentKey: key, data: [{ name: "Other", strengths: ["Possible familiarity"] }], generatedAt: body.data.generatedAt })
    expect(mocks.generate.mock.calls[0][0].system).toContain("NO web search")
    expect(mocks.generate.mock.calls[0][0].prompt).not.toContain("approximate price")
  })
  it("recovers the latest successful result after a lost response without another charge, even at zero balance", async () => {
    mocks.available.mockResolvedValue(0)
    mocks.getProject.mockResolvedValue({ ...project, resourcesCache: { competitors: { data: [{ name: "Original" }], generatedAt: 123, intentKey: key } } })
    const body = await (await invoke()).json()
    expect(body.data).toMatchObject({ competitors: [{ name: "Original" }], generatedAt: 123, cached: true, availableCredits: 0 })
    expect(mocks.charge).not.toHaveBeenCalled()
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it("refuses to rerun a refunded intent as a free generation", async () => {
    mocks.ledger.mockResolvedValueOnce({ idempotencyKey: `resources_${key}_refund` })
    const response = await invoke()
    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe("RESOURCE_REQUEST_REFUNDED")
    expect(mocks.charge).not.toHaveBeenCalled()
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it("fails closed when a prior charge has no recoverable cache entry", async () => {
    mocks.ledger.mockResolvedValueOnce(null).mockResolvedValueOnce({ idempotencyKey: `resources_${key}_sub` })
    const response = await invoke()
    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe("RESOURCE_RECOVERY_REQUIRED")
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it("leaves stored records untouched for invalid model output", async () => {
    mocks.generate.mockResolvedValue('[{"name":"Other","url":"javascript:alert(1)"}]')
    const response = await invoke()
    expect((await response.json()).error.code).toBe("AI_INVALID_OUTPUT")
    expect(mocks.updateProject).not.toHaveBeenCalled()
    expect(mocks.refund).toHaveBeenCalledWith("u1", "p1", "competitors", key)
  })
  it("normalizes legacy fallback data without marking it researched", async () => {
    mocks.getProject.mockResolvedValue({ ...project, resourcesCache: { competitors: { data: [null, { name: "Legacy" }], generatedAt: 10 } } })
    mocks.generate.mockRejectedValue(new Error("Unavailable"))
    const body = await (await invoke()).json()
    expect(body.data.competitors).toEqual([{ name: "Legacy" }])
    expect(body.data.note).toContain("unverified")
    expect(body.data.note).not.toContain("have been refunded")
    expect(mocks.updateProject).not.toHaveBeenCalled()
  })
  it.each(["missing project", "lost write acknowledgement"])("does not claim success or refund blindly on %s", async (failure) => {
    if (failure === "missing project") mocks.updateProject.mockResolvedValue(null)
    else mocks.updateProject.mockRejectedValue(new Error("Write acknowledgement lost"))
    const response = await invoke()
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.error.code).toBe("PERSISTENCE_FAILED")
    expect(body.error.message).toContain("has not been refunded")
    expect(mocks.refund).not.toHaveBeenCalled()
  })
  it.todo("atomically claims concurrent identical requests before provider execution (missing durable operation primitive)")
  it.todo("recovers historical results and reconciles ambiguous persistence/refunds across process crashes")
})
