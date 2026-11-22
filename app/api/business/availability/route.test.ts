import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ claimStateFor: vi.fn() }))

vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn(async () => ({ id: "user-1" })) }))
vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit: vi.fn(async () => undefined) }))
vi.mock("@/lib/domain/service", () => ({ claimStateFor: mocks.claimStateFor }))

import { GET } from "./route"

function request(url: string) {
  return new Request(`http://localhost/api/business/availability?url=${encodeURIComponent(url)}`)
}

beforeEach(() => {
  mocks.claimStateFor.mockReset()
})

describe("GET /api/business/availability", () => {
  it("reports an unclaimed business as available", async () => {
    mocks.claimStateFor.mockResolvedValue({ hostname: "bakery.example", state: "unclaimed" })

    const response = await GET(request("https://bakery.example"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toEqual({ hostname: "bakery.example", state: "unclaimed", available: true, mine: false })
    expect(mocks.claimStateFor).toHaveBeenCalledWith({ userId: "user-1", rawUrl: "https://bakery.example" })
  })

  it("reports a business held by another account as unavailable, without naming the holder", async () => {
    mocks.claimStateFor.mockResolvedValue({ hostname: "bakery.example", state: "held_by_other" })

    const response = await GET(request("https://www.bakery.example"))
    const body = await response.json()

    expect(body.data).toMatchObject({ available: false, state: "held_by_other" })
    expect(JSON.stringify(body)).not.toContain("user-2")
  })

  it("treats the founder's own business as available", async () => {
    mocks.claimStateFor.mockResolvedValue({ hostname: "bakery.example", state: "yours" })

    const body = await (await GET(request("https://bakery.example"))).json()

    expect(body.data).toMatchObject({ available: true, state: "yours", mine: true })
  })

  it("rejects a request without an address", async () => {
    const response = await GET(new Request("http://localhost/api/business/availability"))

    expect(response.status).toBe(422)
    expect(mocks.claimStateFor).not.toHaveBeenCalled()
  })

  it("rejects an address that cannot be a website, without pretending it is free", async () => {
    const response = await GET(request("not a host"))
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body.error.code).toBe("VALIDATION")
    expect(body.error.meta).toMatchObject({ available: false, reason: "invalid" })
    expect(mocks.claimStateFor).not.toHaveBeenCalled()
  })
})
