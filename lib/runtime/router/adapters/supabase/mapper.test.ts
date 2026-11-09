import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  NotificationSendInputSchema,
  scopedChannel,
  toNotificationResult,
  toSupabaseRequest,
} from "./mapper"

const validInput = {
  channel: "orders",
  title: "New order",
  body: "Table 4 ordered.",
}

describe("Supabase notifications mapper", () => {
  it("scopes channels to the authenticated project and defaults the event", () => {
    const translated = toSupabaseRequest(validInput, "proj_a")
    expect(translated.channel).toBe("project:proj_a:orders")
    expect(translated.event).toBe("notification")
    expect(translated.payload).toEqual({ title: "New order", body: "Table 4 ordered." })
    expect(translated.privateChannel).toBe(false)
  })

  it("keeps projects isolated even when callers pick the same channel", () => {
    const a = toSupabaseRequest(validInput, "proj_a")
    const b = toSupabaseRequest(validInput, "proj_b")
    expect(a.channel).not.toBe(b.channel)
    expect(a.channel).toBe(scopedChannel("proj_a", "orders"))
  })

  it("carries event, data, and the private flag through", () => {
    const translated = toSupabaseRequest(
      { ...validInput, event: "new-order", data: { table: 4 }, private: true },
      "proj_a",
    )
    expect(translated.event).toBe("new-order")
    expect(translated.payload.data).toEqual({ table: 4 })
    expect(translated.privateChannel).toBe(true)
  })

  it("rejects the retired Firebase token contract", () => {
    expect(() =>
      toSupabaseRequest({ token: "fcm-token", title: "Hi", body: "There" }, "proj_a"),
    ).toThrow(/invalid/i)
  })

  it("rejects channel names that are unsafe in a URL path", () => {
    expect(NotificationSendInputSchema.safeParse({ ...validInput, channel: "orders/../admin" }).success).toBe(false)
    expect(NotificationSendInputSchema.safeParse({ ...validInput, channel: "two words" }).success).toBe(false)
  })

  it("bounds the structured payload", () => {
    let caught: unknown
    try {
      toSupabaseRequest({ ...validInput, data: { blob: "x".repeat(17 * 1024) } }, "proj_a")
    } catch (e) {
      caught = e
    }
    expect((caught as { detail?: string } | undefined)?.detail).toMatch(/data must serialize/i)
  })

  it("normalizes acceptance without inventing a provider message id", () => {
    const result = toNotificationResult(toSupabaseRequest(validInput, "proj_a"))
    expect(result.provider).toBe("supabase")
    expect(result.data).toEqual({
      channel: "project:proj_a:orders",
      event: "notification",
      accepted: true,
    })
    expect(result.usage).toBeUndefined()
  })
})
