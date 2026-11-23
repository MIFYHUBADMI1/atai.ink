import { beforeEach, describe, expect, it, vi } from "vitest"

import { AppError } from "@/lib/errors"

/**
 * The connected-business surface has no project settings page, so this route is
 * the only way a business owner can mint the key the analytics snippet needs.
 * Two properties matter and are pinned here:
 *
 *   - it can only ever issue a PUBLISHABLE key (the anchor project id stays on
 *     the server, and the key can only write analytics);
 *   - it is gated by the business permission `runtime.keys.manage`, so a member
 *     who may not manage keys cannot create one.
 */

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireWorkspace: vi.fn(),
  resolveBusinessAnchorProject: vi.fn(),
  createApiKey: vi.fn(),
  listApiKeys: vi.fn(),
}))

vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.requireUser }))
vi.mock("@/lib/business/http", () => ({
  requireWorkspace: mocks.requireWorkspace,
  actorOf: (user: { id: string }) => ({ kind: "user", userId: user.id }),
}))
vi.mock("@/lib/connected-business/anchor", () => ({
  resolveBusinessAnchorProject: mocks.resolveBusinessAnchorProject,
}))
vi.mock("@/lib/runtime/keys/service", () => ({
  createApiKey: mocks.createApiKey,
  listApiKeys: mocks.listApiKeys,
}))
vi.mock("@/lib/api/ai-protection", () => ({
  withAiProtection: (_kind: string, handler: (...args: unknown[]) => Promise<Response>) => handler,
}))

import { GET, POST } from "./route"

const params = { params: Promise.resolve({ businessId: "biz_1" }) }

function request(body: unknown = {}): Request {
  return new Request("https://atai.ink/api/businesses/biz_1/analytics-key", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("/api/businesses/[businessId]/analytics-key", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireUser.mockResolvedValue({ id: "user_1" })
    mocks.requireWorkspace.mockResolvedValue(undefined)
    mocks.resolveBusinessAnchorProject.mockResolvedValue({
      project: { id: "proj_anchor", userId: "owner_1" },
      ownerId: "owner_1",
    })
    mocks.createApiKey.mockResolvedValue({ id: "rkey_1", secret: "atai_production_pk_x", kind: "publishable" })
    mocks.listApiKeys.mockResolvedValue([
      { id: "rkey_1", kind: "publishable", keyPrefix: "atai_production_pk_x…" },
      { id: "rkey_2", kind: undefined, keyPrefix: "atai_production_abcd…" },
    ])
  })

  it("issues a publishable key bound to the anchor project", async () => {
    const response = await POST(request({}), params)
    const body = (await response.json()) as { ok: boolean; data: { key: { secret: string } } }

    expect(response.status).toBe(200)
    expect(body.data.key.secret).toBe("atai_production_pk_x")
    expect(mocks.createApiKey).toHaveBeenCalledWith(
      "owner_1",
      expect.objectContaining({ projectId: "proj_anchor", kind: "publishable", environment: "production" }),
    )
  })

  it("requires the runtime.keys.manage permission", async () => {
    mocks.resolveBusinessAnchorProject.mockRejectedValue(
      new AppError("FORBIDDEN", "You cannot manage keys for this business.", 403),
    )

    const response = await POST(request({}), params)

    expect(response.status).toBe(403)
    expect(mocks.createApiKey).not.toHaveBeenCalled()
  })

  it("lists only publishable keys — a secret key is not this surface's business", async () => {
    const response = await GET(new Request("https://atai.ink/api/businesses/biz_1/analytics-key"), params)
    const body = (await response.json()) as { data: { keys: Array<{ id: string }> } }

    expect(response.status).toBe(200)
    expect(body.data.keys.map((key) => key.id)).toEqual(["rkey_1"])
  })
})
