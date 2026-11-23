import { beforeEach, describe, expect, it, vi } from "vitest"

const { requireUser, listBusinessesForUser, createBusiness, isBusinessWorkspaceEnabled } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  listBusinessesForUser: vi.fn(),
  createBusiness: vi.fn(),
  isBusinessWorkspaceEnabled: vi.fn(),
}))

vi.mock("@/lib/auth/session", () => ({ requireUser }))
vi.mock("@/lib/business/service", () => ({ listBusinessesForUser, createBusiness }))
vi.mock("@/lib/business/flags", () => ({ isBusinessWorkspaceEnabled }))

const { GET, POST } = await import("./route")

function request(body: unknown) {
  return new Request("http://localhost/api/businesses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  requireUser.mockResolvedValue({ id: "u1" })
  isBusinessWorkspaceEnabled.mockReturnValue(true)
})

describe("GET /api/businesses", () => {
  it("hides the surface when the rollout is off", async () => {
    isBusinessWorkspaceEnabled.mockReturnValue(false)
    const response = await GET()
    expect(response.status).toBe(404)
    expect(listBusinessesForUser).not.toHaveBeenCalled()
  })

  it("returns the acting user's businesses", async () => {
    listBusinessesForUser.mockResolvedValue([{ id: "biz_1" }])
    const response = await GET()
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.data.businesses).toEqual([{ id: "biz_1" }])
    expect(listBusinessesForUser).toHaveBeenCalledWith({ actor: { kind: "user", id: "u1" } })
  })
})

describe("POST /api/businesses", () => {
  it("creates the business for the acting user", async () => {
    createBusiness.mockResolvedValue({ id: "biz_1", name: "Acme" })
    const response = await POST(request({ name: "Acme" }))
    expect(response.status).toBe(201)
    expect(createBusiness).toHaveBeenCalledWith({
      actor: { kind: "user", id: "u1" },
      name: "Acme",
    })
  })

  it("rejects a nameless business", async () => {
    const response = await POST(request({ name: "   " }))
    expect(response.status).toBe(422)
    expect(createBusiness).not.toHaveBeenCalled()
  })

  it("hides the surface when the rollout is off", async () => {
    isBusinessWorkspaceEnabled.mockReturnValue(false)
    const response = await POST(request({ name: "Acme" }))
    expect(response.status).toBe(404)
    expect(createBusiness).not.toHaveBeenCalled()
  })
})
