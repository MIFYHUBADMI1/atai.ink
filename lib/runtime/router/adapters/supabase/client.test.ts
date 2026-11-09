import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock("./config", () => ({
  getSupabaseUrl: () => "https://proj.supabase.co",
  getSupabaseServiceRoleKey: () => "test-server-key",
  getSupabaseTimeoutMs: () => 20_000,
}))
vi.mock("../shared/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../shared/http")>()
  return { ...actual, providerFetch: vi.fn() }
})

import { providerFetch } from "../shared/http"
import { executeBroadcastNotification } from "./client"

const providerFetchMock = vi.mocked(providerFetch)

const request = {
  channel: "project:proj_a:orders",
  event: "new-order",
  payload: { title: "New order", body: "Table 4 ordered." },
  privateChannel: false,
}

describe("Supabase broadcast client", () => {
  beforeEach(() => {
    providerFetchMock.mockReset()
    providerFetchMock.mockResolvedValue({ status: 202, ok: true, text: "" })
  })

  it("posts to the documented broadcast endpoint with the project key", async () => {
    await executeBroadcastNotification({ request, requestId: "rtreq_test" })

    expect(providerFetchMock).toHaveBeenCalledWith({
      url: "https://proj.supabase.co/realtime/v1/api/broadcast/project%3Aproj_a%3Aorders/events/new-order",
      method: "POST",
      headers: {
        apikey: "test-server-key",
        "content-type": "application/json",
      },
      body: JSON.stringify(request.payload),
      timeoutMs: 20_000,
      requestId: "rtreq_test",
    })
  })

  it("marks private broadcasts with the private query flag", async () => {
    await executeBroadcastNotification({ request: { ...request, privateChannel: true } })

    expect(providerFetchMock.mock.calls[0]?.[0]?.url).toContain("?private=true")
  })

  it("normalizes provider failures without leaking raw internals", async () => {
    providerFetchMock.mockResolvedValue({ status: 503, ok: false, text: "upstream exploded" })

    await expect(executeBroadcastNotification({ request })).rejects.toMatchObject({
      category: "provider_unavailable",
      message: "The notification provider returned an error.",
    })
  })
})
