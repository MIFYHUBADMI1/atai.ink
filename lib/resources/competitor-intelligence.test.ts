import { beforeEach, describe, expect, it, vi } from "vitest"
const { getProject } = vi.hoisted(() => ({ getProject: vi.fn() }))
vi.mock("@/lib/store/store", () => ({ store: { getProject } }))
import { getResourcesCompetitorIntelligence } from "./competitor-intelligence"

beforeEach(() => vi.clearAllMocks())
describe("project-scoped Resources intelligence", () => {
  it("reads the original cache without generating or copying records", async () => {
    const project = { id: "p1", userId: "u1", resourcesCache: { competitors: { data: [{ name: "Acme", url: "https://acme.example" }], generatedAt: 100 } } }
    getProject.mockResolvedValue(project)
    const before = structuredClone(project)
    expect(await getResourcesCompetitorIntelligence("u1", "p1")).toMatchObject({ sourceSection: "resources", generatedAt: 100, verificationStatus: "unverified", competitors: [{ name: "Acme", url: "https://acme.example/" }] })
    expect(getProject).toHaveBeenCalledWith("p1")
    expect(project).toEqual(before)
  })
  it("does not return another owner's intelligence", async () => {
    getProject.mockResolvedValue({ id: "p2", userId: "u2", resourcesCache: { competitors: { data: [{ name: "Private" }] } } })
    await expect(getResourcesCompetitorIntelligence("u1", "p2")).rejects.toThrow()
  })
  it("rejects missing projects and permits owned projects without Resources data", async () => {
    getProject.mockResolvedValue(null)
    await expect(getResourcesCompetitorIntelligence("u1", "missing")).rejects.toThrow()
    getProject.mockResolvedValue({ id: "p1", userId: "u1" })
    expect((await getResourcesCompetitorIntelligence("u1", "p1")).competitors).toEqual([])
  })
})
