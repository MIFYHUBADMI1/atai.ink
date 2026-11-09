import { describe, expect, it } from "vitest"
import { TotalumError, friendlyMessageFor, mapTotalumError } from "./errors"

describe("mapTotalumError", () => {
  it("keeps documented provider codes", () => {
    expect(mapTotalumError(409, "AGENT_RUNNING: build in progress").code).toBe("AGENT_RUNNING")
    expect(mapTotalumError(402, "INSUFFICIENT_CREDITS").code).toBe("INSUFFICIENT_CREDITS")
    expect(mapTotalumError(429, "slow down").code).toBe("RATE_LIMIT_EXCEEDED")
  })

  it("treats a 5xx as the provider failing, not the founder's request", () => {
    const err = mapTotalumError(502, "bad gateway from upstream")
    expect(err.code).toBe("PROVIDER_UNREACHABLE")
    expect(err.friendlyMessage).toMatch(/safe to try again/)
  })

  it("still reports a genuine 4xx contract break as UNKNOWN", () => {
    expect(mapTotalumError(400, "malformed payload").code).toBe("UNKNOWN")
  })
})

describe("transport failures", () => {
  it("names the clock as the cause of a not-yet-valid certificate", () => {
    const err = new TotalumError("TLS_CLOCK", "certificate is not yet valid")
    expect(err.friendlyMessage).toMatch(/clock/)
    expect(friendlyMessageFor("TLS_CLOCK")).toMatch(/certificate/)
  })

  it("says nothing was sent or charged when the connection died first", () => {
    expect(friendlyMessageFor("PROVIDER_UNREACHABLE")).toMatch(/before your plan was sent/)
  })
})
