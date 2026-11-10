import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  deleteProject: vi.fn(),
  findProject: vi.fn(),
  revokeKeys: vi.fn(),
  deleteRuns: vi.fn(),
  deleteAttachments: vi.fn(),
  artifacts: Object.fromEntries([
    "projectAssetsCol", "projectChatsCol", "planningRunsCol", "contentItemsCol",
    "brandProfilesCol", "growthTasksCol", "campaignsCol", "businessLessonsCol",
    "analyticsEventsCol", "projectLikesCol", "projectGitHubCol", "projectRuntimeConfigCol",
  ].map((name) => [name, { deleteMany: vi.fn() }])),
  deleteForks: vi.fn(),
  updateConversations: vi.fn(),
  expireActions: vi.fn(),
  session: {
    withTransaction: vi.fn(),
    endSession: vi.fn(),
  },
}))

vi.mock("@/lib/db/collections", () => ({
  projectsCol: async () => ({ deleteOne: mocks.deleteProject, findOne: mocks.findProject }),
  buildRunsCol: async () => ({ deleteMany: mocks.deleteRuns }),
  projectAttachmentsCol: async () => ({ deleteMany: mocks.deleteAttachments }),
  ...Object.fromEntries(Object.entries(mocks.artifacts).map(([name, collection]) => [name, async () => collection])),
  projectForksCol: async () => ({ deleteMany: mocks.deleteForks }),
  cofounderConversationsCol: async () => ({ updateMany: mocks.updateConversations }),
  cofounderPendingActionsCol: async () => ({ updateMany: mocks.expireActions }),
  usersCol: vi.fn(),
}))
vi.mock("@/lib/db/runtime-collections", () => ({
  apiKeysCol: async () => ({ updateMany: mocks.revokeKeys }),
  projectRuntimeConfigCol: async () => mocks.artifacts.projectRuntimeConfigCol,
}))
vi.mock("@/lib/db/mongodb", () => ({
  getMongoClient: async () => ({ startSession: () => mocks.session }),
}))
vi.mock("@/lib/billing/credit-service", () => ({
  getAvailableCredits: vi.fn(),
  getCreditHistory: vi.fn(),
  grantCredits: vi.fn(),
  consumeCredits: vi.fn(),
  reserveCredits: vi.fn(),
}))
vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { MongoStore } from "./mongo-store"

beforeEach(() => {
  vi.resetAllMocks()
  mocks.deleteProject.mockResolvedValue({ deletedCount: 1 })
  mocks.revokeKeys.mockResolvedValue({ modifiedCount: 2 })
  mocks.deleteRuns.mockResolvedValue({ deletedCount: 1 })
  mocks.deleteAttachments.mockResolvedValue({ deletedCount: 1 })
  mocks.session.withTransaction.mockImplementation(async (callback: () => Promise<void>) => callback())
  mocks.session.endSession.mockResolvedValue(undefined)
})

describe("MongoStore project deletion", () => {
  it("revokes every active project key in the same owner-checked deletion transaction", async () => {
    await expect(new MongoStore().deleteProject("proj_own", "user_owner")).resolves.toBe(true)

    expect(mocks.deleteProject).toHaveBeenCalledWith(
      { id: "proj_own", userId: "user_owner" }, { session: mocks.session },
    )
    expect(mocks.revokeKeys).toHaveBeenCalledWith(
      { projectId: "proj_own", status: "active" },
      { $set: { status: "revoked", revokedAt: expect.any(Number), revokedReason: "project_deleted" } },
      { session: mocks.session },
    )
    expect(mocks.deleteRuns).toHaveBeenCalledWith({ mirrorProjectId: "proj_own" }, { session: mocks.session })
    expect(mocks.deleteAttachments).toHaveBeenCalledWith({ projectId: "proj_own" }, { session: mocks.session })
    expect(mocks.revokeKeys.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.deleteProject.mock.invocationCallOrder[0])
    expect(mocks.revokeKeys.mock.invocationCallOrder[0]).toBeLessThan(mocks.deleteRuns.mock.invocationCallOrder[0])
    expect(mocks.session.endSession).toHaveBeenCalledOnce()
  })

  it("does not revoke keys or cascade when the project is missing or belongs to someone else", async () => {
    mocks.deleteProject.mockResolvedValue({ deletedCount: 0 })
    await expect(new MongoStore().deleteProject("proj_foreign", "user_owner")).resolves.toBe(false)
    expect(mocks.revokeKeys).not.toHaveBeenCalled()
    expect(mocks.deleteRuns).not.toHaveBeenCalled()
    expect(mocks.deleteAttachments).not.toHaveBeenCalled()
    expect(mocks.session.endSession).toHaveBeenCalledOnce()
  })

  it("propagates revocation failure out of the transaction rather than committing an unsafe deletion", async () => {
    mocks.revokeKeys.mockRejectedValueOnce(new Error("revocation failed"))
    await expect(new MongoStore().deleteProject("proj_own", "user_owner")).rejects.toThrow("revocation failed")
    expect(mocks.deleteRuns).not.toHaveBeenCalled()
    expect(mocks.deleteAttachments).not.toHaveBeenCalled()
    expect(mocks.session.endSession).toHaveBeenCalledOnce()
  })

  it("propagates cascade failure out of the transaction", async () => {
    mocks.deleteAttachments.mockRejectedValueOnce(new Error("cascade failed"))
    await expect(new MongoStore().deleteProject("proj_own", "user_owner")).rejects.toThrow("cascade failed")
    expect(mocks.session.endSession).toHaveBeenCalledOnce()
  })

  it("invalidates cached project reads after a committed deletion", async () => {
    const store = new MongoStore()
    mocks.findProject.mockResolvedValueOnce({ id: "proj_own", userId: "user_owner" }).mockResolvedValue(null)
    expect(await store.getProject("proj_own")).not.toBeNull()
    await store.deleteProject("proj_own", "user_owner")
    expect(await store.getProject("proj_own")).toBeNull()
    expect(mocks.findProject).toHaveBeenCalledTimes(2)
  })
})
