import { beforeEach, describe, expect, it, vi } from "vitest"

const { requireBusinessAccess, deleteBusiness, getProject, deleteProject } = vi.hoisted(() => ({
  requireBusinessAccess: vi.fn(),
  deleteBusiness: vi.fn(),
  getProject: vi.fn(),
  deleteProject: vi.fn(),
}))

vi.mock("@/lib/business/access", () => ({ requireBusinessAccess }))
vi.mock("@/lib/business/service", () => ({ deleteBusiness }))
vi.mock("@/lib/store/store", () => ({ store: { getProject, deleteProject } }))

vi.mock("@/lib/db/collections", async () => {
  const { fakeCollection } = await import("@/lib/business/testing/fake-collections")
  const businesses = fakeCollection()
  const applications = fakeCollection()
  const projects = fakeCollection()
  const domains = fakeCollection()
  const conversations = fakeCollection()
  const pendingActions = fakeCollection()
  return {
    businessesCol: async () => businesses,
    connectedApplicationsCol: async () => applications,
    projectsCol: async () => projects,
    businessDomainsCol: async () => domains,
    cofounderConversationsCol: async () => conversations,
    cofounderPendingActionsCol: async () => pendingActions,
    __fakes: { businesses, applications, projects, domains, conversations, pendingActions },
  }
})

import * as db from "@/lib/db/collections"
import { deleteConnectedBusiness } from "./deletion"

interface Fakes {
  businesses: { docs: Record<string, unknown>[] }
  applications: { docs: Record<string, unknown>[] }
  projects: { docs: Record<string, unknown>[] }
  domains: { docs: Record<string, unknown>[] }
  conversations: { docs: Record<string, unknown>[] }
  pendingActions: { docs: Record<string, unknown>[] }
}

const fakes = (db as unknown as { __fakes: Fakes }).__fakes

const owner = { kind: "user" as const, id: "u1" }

beforeEach(() => {
  vi.clearAllMocks()
  fakes.businesses.docs.length = 0
  fakes.applications.docs.length = 0
  fakes.projects.docs.length = 0
  fakes.domains.docs.length = 0
  fakes.conversations.docs.length = 0
  fakes.pendingActions.docs.length = 0
  requireBusinessAccess.mockResolvedValue({ business: { id: "biz_1" }, role: "owner" })
  deleteBusiness.mockResolvedValue({ business: { id: "biz_1" }, releasedClaims: 1 })
  getProject.mockResolvedValue({ id: "proj_1", userId: "u1" })
  deleteProject.mockResolvedValue(true)
})

describe("deleteConnectedBusiness", () => {
  it("removes the anchor project before the business rows", async () => {
    fakes.projects.docs.push({ id: "proj_1", businessId: "biz_1" })

    const result = await deleteConnectedBusiness({ businessId: "biz_1", actor: owner })

    expect(result).toMatchObject({ businessId: "biz_1", deletedProjectIds: ["proj_1"], releasedClaims: 1 })
    expect(deleteProject).toHaveBeenCalledWith("proj_1", "u1")
    expect(deleteProject.mock.invocationCallOrder[0]).toBeLessThan(deleteBusiness.mock.invocationCallOrder[0])
    expect(deleteBusiness).toHaveBeenCalledWith({ businessId: "biz_1", actor: owner })
  })

  it("follows the legacy project and application pointers", async () => {
    fakes.businesses.docs.push({ id: "biz_1", legacyProjectId: "proj_legacy" })
    fakes.applications.docs.push({ id: "app_1", businessId: "biz_1", legacyProjectId: "proj_app" })
    getProject.mockImplementation(async (id: string) => ({ id, userId: "u1" }))

    const result = await deleteConnectedBusiness({ businessId: "biz_1", actor: owner })

    expect(new Set(result.deletedProjectIds)).toEqual(new Set(["proj_legacy", "proj_app"]))
  })

  it("never deletes anything for an admin who is not the owner", async () => {
    requireBusinessAccess.mockResolvedValue({ business: { id: "biz_1" }, role: "admin" })

    await expect(deleteConnectedBusiness({ businessId: "biz_1", actor: owner })).rejects.toMatchObject({
      code: "BUSINESS_FORBIDDEN",
    })
    expect(deleteProject).not.toHaveBeenCalled()
    expect(deleteBusiness).not.toHaveBeenCalled()
  })

  it("removes an ownerless project and releases its claims directly", async () => {
    fakes.projects.docs.push({ id: "proj_orphan", businessId: "biz_1" })
    fakes.domains.docs.push({ id: "dom_1", projectId: "proj_orphan", status: "verified", token: "x", tokenHash: "y" })
    getProject.mockResolvedValue({ id: "proj_orphan" })

    await deleteConnectedBusiness({ businessId: "biz_1", actor: owner })

    expect(deleteProject).not.toHaveBeenCalled()
    expect(fakes.projects.docs).toHaveLength(0)
    expect(fakes.domains.docs[0]).toMatchObject({ status: "revoked" })
    expect(fakes.domains.docs[0].token).toBeUndefined()
    expect(deleteBusiness).toHaveBeenCalled()
  })

  it("is safe to retry after the project is already gone", async () => {
    fakes.projects.docs.push({ id: "proj_1", businessId: "biz_1" })
    getProject.mockResolvedValue(null)

    const result = await deleteConnectedBusiness({ businessId: "biz_1", actor: owner })

    expect(result.deletedProjectIds).toEqual([])
    expect(deleteBusiness).toHaveBeenCalled()
  })
})
