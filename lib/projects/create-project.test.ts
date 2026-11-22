import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createProject: vi.fn(),
  getProject: vi.fn(),
  listProjects: vi.fn(async () => []),
  appendEvent: vi.fn(async () => undefined),
  reserveBusinessClaim: vi.fn(),
  releaseProjectClaims: vi.fn(async () => 1),
  startBusinessIntake: vi.fn(),
}))

vi.mock("@/lib/store/store", () => ({
  cryptoId: () => `id-${Math.random().toString(36).slice(2, 10)}`,
  store: {
    createProject: mocks.createProject,
    getProject: mocks.getProject,
    listProjects: mocks.listProjects,
    appendEvent: mocks.appendEvent,
  },
}))
vi.mock("@/lib/domain/service", () => ({
  BUSINESS_ALREADY_CONNECTED_MESSAGE:
    "This website is already connected to another Atai account. Only that account can disconnect it. If this is the business you own, contact support to recover it.",
  reserveBusinessClaim: mocks.reserveBusinessClaim,
  releaseProjectClaims: mocks.releaseProjectClaims,
}))
vi.mock("@/lib/existing-business/intake", () => ({
  buildIntakeRecord: (input: Record<string, unknown>) => ({ collectedAt: Date.now(), objectives: [], ...input }),
  sanitizeIntakeInput: (input: Record<string, unknown>) => input,
  startBusinessIntake: mocks.startBusinessIntake,
}))
vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit: vi.fn(async () => undefined) }))
vi.mock("@/lib/billing/entitlements/require", () => ({
  ENTITLEMENT_ENFORCEMENT_ENABLED: false,
  authorizeProjectCreation: vi.fn(async () => ({ allowed: true })),
}))
vi.mock("@/lib/projects/pipeline-recovery", () => ({ startProjectPipeline: vi.fn() }))
vi.mock("@/lib/projects/attachments", () => ({
  saveProjectAttachments: vi.fn(async () => []),
  clearProjectAttachments: vi.fn(async () => undefined),
}))
vi.mock("@/lib/integrations/firecrawl/service", () => ({ normalizeUrl: (url: string) => url }))

import { createUserProject } from "./create-project"

const USER = "user-1"
const BUSINESS = {
  startingPoint: "existing_business",
  name: "Corner Bakery",
  intake: { websiteUrl: "https://example.com", description: "A bakery in Lisbon" },
}

beforeEach(() => {
  mocks.createProject.mockReset()
  mocks.getProject.mockReset()
  mocks.listProjects.mockReset().mockResolvedValue([])
  mocks.reserveBusinessClaim.mockReset()
  mocks.releaseProjectClaims.mockReset().mockResolvedValue(1)
  mocks.startBusinessIntake.mockReset()
})

describe("createUserProject — one business, one account", () => {
  it("reserves the business before creating the project and reuses the reservation id", async () => {
    mocks.reserveBusinessClaim.mockResolvedValue({ state: "reserved", doc: {}, created: true, canonicalHostname: "example.com" })
    mocks.createProject.mockResolvedValue(undefined)

    const result = await createUserProject(USER, BUSINESS)

    expect(mocks.reserveBusinessClaim).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER, rawUrl: "https://example.com" }),
    )
    const reservedId = mocks.reserveBusinessClaim.mock.calls[0][0].projectId
    expect(mocks.createProject).toHaveBeenCalledTimes(1)
    expect(mocks.createProject.mock.calls[0][0].id).toBe(reservedId)
    expect("project" in result && result.project.id).toBe(reservedId)
    expect(mocks.startBusinessIntake).toHaveBeenCalledWith(reservedId)
  })

  it("refuses a business held by another account without creating a project", async () => {
    mocks.reserveBusinessClaim.mockResolvedValue({
      state: "refused",
      code: "BUSINESS_ALREADY_CONNECTED",
      message: "This website is already connected to another Atai account.",
      status: 409,
    })

    const result = await createUserProject(USER, BUSINESS)

    expect(mocks.createProject).not.toHaveBeenCalled()
    expect(mocks.startBusinessIntake).not.toHaveBeenCalled()
    expect(result).toHaveProperty("error")
    const error = (result as { error: Response }).error
    expect(error.status).toBe(409)
    const body = await error.json()
    expect(body.error.code).toBe("BUSINESS_ALREADY_CONNECTED")
    expect(JSON.stringify(body)).not.toContain("user-2")
  })

  it("lands a repeat attempt on the business the founder already has", async () => {
    mocks.reserveBusinessClaim.mockResolvedValue({ state: "reuse", projectId: "proj-existing" })
    mocks.getProject.mockResolvedValue({ id: "proj-existing", userId: USER, name: "Corner Bakery" })

    const result = await createUserProject(USER, BUSINESS)

    expect(result).toMatchObject({ reused: true })
    expect((result as { project: { id: string } }).project.id).toBe("proj-existing")
    expect(mocks.createProject).not.toHaveBeenCalled()
  })

  it("reclaims a claim whose project is gone and creates a fresh business", async () => {
    mocks.reserveBusinessClaim
      .mockResolvedValueOnce({ state: "reuse", projectId: "proj-deleted" })
      .mockResolvedValueOnce({ state: "reserved", doc: {}, created: true, canonicalHostname: "example.com" })
    mocks.getProject.mockResolvedValue(null)
    mocks.createProject.mockResolvedValue(undefined)

    const result = await createUserProject(USER, BUSINESS)

    expect(mocks.releaseProjectClaims).toHaveBeenCalledWith("proj-deleted", expect.any(String))
    expect(mocks.createProject).toHaveBeenCalledTimes(1)
    expect("project" in result).toBe(true)
  })

  it("frees the reservation when the project row cannot be written", async () => {
    mocks.reserveBusinessClaim.mockResolvedValue({ state: "reserved", doc: {}, created: true, canonicalHostname: "example.com" })
    mocks.createProject.mockRejectedValue(new Error("db down"))

    await expect(createUserProject(USER, BUSINESS)).rejects.toThrow("db down")
    const reservedId = mocks.reserveBusinessClaim.mock.calls[0][0].projectId
    expect(mocks.releaseProjectClaims).toHaveBeenCalledWith(reservedId, "project creation failed")
  })

  it("keeps the build-from-idea journey free of claims", async () => {
    mocks.createProject.mockResolvedValue(undefined)

    await createUserProject(USER, {
      mode: "scratch",
      name: "Clinic OS",
      idea: "Software for small clinics to schedule visits",
    })

    expect(mocks.reserveBusinessClaim).not.toHaveBeenCalled()
    expect(mocks.createProject).toHaveBeenCalledTimes(1)
  })
})
