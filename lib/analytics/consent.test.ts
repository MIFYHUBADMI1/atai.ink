import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/store/store", () => ({
  store: { getProject: vi.fn(), updateProject: vi.fn() },
}))

import { store } from "@/lib/store/store"
import { analyticsConsentEnabled, readAnalyticsConsent, setAnalyticsConsent } from "./consent"

/**
 * Per-project consent is the founder's permission gate for co-founder analytics
 * insights. It must default OFF and only the owner may flip it.
 */

const getProject = vi.mocked(store.getProject)
const updateProject = vi.mocked(store.updateProject)

beforeEach(() => {
  vi.clearAllMocks()
})

describe("readAnalyticsConsent / analyticsConsentEnabled — default OFF", () => {
  it("treats an absent flag as disabled", () => {
    expect(analyticsConsentEnabled({})).toBe(false)
    expect(readAnalyticsConsent({})).toEqual({ enabled: false, updatedAt: 0 })
  })

  it("treats enabled:false as disabled", () => {
    expect(analyticsConsentEnabled({ analyticsConsent: { enabled: false, updatedAt: 5 } })).toBe(false)
    expect(readAnalyticsConsent({ analyticsConsent: { enabled: false, updatedAt: 5 } }).enabled).toBe(false)
  })

  it("reads an explicit grant", () => {
    expect(analyticsConsentEnabled({ analyticsConsent: { enabled: true, updatedAt: 9 } })).toBe(true)
    expect(readAnalyticsConsent({ analyticsConsent: { enabled: true, updatedAt: 9 } })).toEqual({ enabled: true, updatedAt: 9 })
  })
})

describe("setAnalyticsConsent — ownership enforced", () => {
  it("refuses a missing project and writes nothing", async () => {
    getProject.mockResolvedValue(null as never)
    const result = await setAnalyticsConsent("p", "owner", true)
    expect(result).toBeNull()
    expect(updateProject).not.toHaveBeenCalled()
  })

  it("refuses a non-owner and writes nothing", async () => {
    getProject.mockResolvedValue({ id: "p", userId: "someone-else" } as never)
    const result = await setAnalyticsConsent("p", "owner", true)
    expect(result).toBeNull()
    expect(updateProject).not.toHaveBeenCalled()
  })

  it("persists the owner's choice", async () => {
    getProject.mockResolvedValue({ id: "p", userId: "owner" } as never)
    updateProject.mockResolvedValue({ id: "p" } as never)
    const result = await setAnalyticsConsent("p", "owner", true)
    expect(result?.enabled).toBe(true)
    expect(typeof result?.updatedAt).toBe("number")
    expect(updateProject).toHaveBeenCalledWith("p", { analyticsConsent: result })
  })

  it("can revoke a previously granted consent", async () => {
    getProject.mockResolvedValue({ id: "p", userId: "owner", analyticsConsent: { enabled: true, updatedAt: 1 } } as never)
    updateProject.mockResolvedValue({ id: "p" } as never)
    const result = await setAnalyticsConsent("p", "owner", false)
    expect(result?.enabled).toBe(false)
  })
})