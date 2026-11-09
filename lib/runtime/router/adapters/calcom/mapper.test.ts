import "server-only"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { ProviderExecutionError } from "@/lib/runtime/router/adapter"
import { toListBookingsResult, toCalComCreateBooking } from "./mapper"

vi.mock("server-only", () => ({}))

describe("calcom mapper — listBookings response shapes", () => {
  it("accepts the current v2 shape where data is a direct array", () => {
    const result = toListBookingsResult({
      status: "success",
      data: [
        { id: 7, uid: "abc123", title: "Sync", start: "2026-10-30T09:00:00.000Z", end: "2026-10-30T09:30:00.000Z", status: "accepted", attendee: { email: "a@b.c", name: "A B" } },
        { uid: "def456", start: "2026-11-01T10:00:00.000Z" },
      ],
    })
    expect(result.data.bookings).toHaveLength(2)
    expect(result.data.bookings[0]).toMatchObject({ id: "7", uid: "abc123", attendeeEmail: "a@b.c" })
    expect(result.data.bookings[1]).toMatchObject({ id: "def456", uid: "def456" })
  })

  it("still accepts the legacy nested data.bookings shape", () => {
    const result = toListBookingsResult({
      status: "success",
      data: { bookings: [{ uid: "u1", start: "2026-10-30T09:00:00.000Z" }] },
    })
    expect(result.data.bookings.map((b) => b.uid)).toEqual(["u1"])
  })

  it("skips bookings without uid or start instead of fabricating fields", () => {
    const result = toListBookingsResult({
      data: [
        { start: "2026-10-30T09:00:00.000Z" },
        { uid: "no-start" },
        { uid: "ok", start: "2026-10-30T09:00:00.000Z" },
      ],
    })
    expect(result.data.bookings.map((b) => b.uid)).toEqual(["ok"])
  })

  it("fails normalized when neither data nor data.bookings is an array", () => {
    expect(() => toListBookingsResult({ status: "success" })).toThrowError(ProviderExecutionError)
    expect(() => toListBookingsResult({ data: { other: true } as never })).toThrowError(ProviderExecutionError)
  })
})

describe("calcom mapper — createBooking event type resolution", () => {
  const original = process.env.CALCOM_DEFAULT_EVENT_TYPE_ID

  beforeEach(() => {
    delete process.env.CALCOM_DEFAULT_EVENT_TYPE_ID
  })
  afterEach(() => {
    if (original === undefined) delete process.env.CALCOM_DEFAULT_EVENT_TYPE_ID
    else process.env.CALCOM_DEFAULT_EVENT_TYPE_ID = original
  })

  it("prefers the caller-supplied eventTypeId", () => {
    const { body } = toCalComCreateBooking({
      start: "2026-11-02T09:00:00Z",
      eventTypeId: 42,
      attendee: { name: "Ada", email: "ada@example.com" },
    })
    expect(body.eventTypeId).toBe(42)
  })

  it("falls back to the server-configured default", () => {
    process.env.CALCOM_DEFAULT_EVENT_TYPE_ID = "17"
    const { body } = toCalComCreateBooking({
      start: "2026-11-02T09:00:00Z",
      attendee: { name: "Ada", email: "ada@example.com" },
    })
    expect(body.eventTypeId).toBe(17)
  })

  it("fails with a config hint when neither is available", () => {
    delete process.env.CALCOM_DEFAULT_EVENT_TYPE_ID
    let caught: unknown
    try {
      toCalComCreateBooking({
        start: "2026-11-02T09:00:00Z",
        attendee: { name: "Ada", email: "ada@example.com" },
      })
      expect.unreachable("expected toCalComCreateBooking to throw")
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ProviderExecutionError)
    expect((caught as ProviderExecutionError).detail).toMatch(/CALCOM_DEFAULT_EVENT_TYPE_ID/)
  })
})
