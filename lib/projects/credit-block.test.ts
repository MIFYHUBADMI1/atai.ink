import { describe, expect, it } from "vitest"

import {
  CREDIT_BLOCK_FRESH_MS,
  encodeCreditBlockHeader,
  freshCreditBlock,
  sanitizeCreditBlock,
} from "./credit-block"
import { parseCreditBlockHeader } from "@/lib/client/credit-gate"

const NOW = 1_800_000_000_000
const block = { required: 100_000, available: 420, action: "your build", at: NOW - 60_000 }

describe("sanitizeCreditBlock", () => {
  it("keeps a real shortfall and rounds its numbers", () => {
    expect(sanitizeCreditBlock({ ...block, required: 1000.4, available: 19.6 })).toEqual({
      required: 1000,
      available: 20,
      action: "your build",
      at: NOW - 60_000,
    })
  })

  it("drops anything that is not a shortfall or is missing a field", () => {
    expect(sanitizeCreditBlock(null)).toBe(null)
    expect(sanitizeCreditBlock("100000")).toBe(null)
    expect(sanitizeCreditBlock({ ...block, required: 420 })).toBe(null) // they can afford it
    expect(sanitizeCreditBlock({ ...block, available: 0 })).toEqual({ ...block, available: 0 })
    expect(sanitizeCreditBlock({ ...block, action: "   " })).toBe(null)
    expect(sanitizeCreditBlock({ ...block, at: "now" })).toBe(null)
  })

  it("preserves the action label without clipping it", () => {
    const cleaned = sanitizeCreditBlock({ ...block, action: "x".repeat(300) })
    expect(cleaned?.action.length).toBe(300)
  })
})

describe("freshCreditBlock", () => {
  it("only flags a block the founder is still inside the window of", () => {
    expect(freshCreditBlock({ creditBlock: block }, NOW)?.required).toBe(100_000)
    expect(freshCreditBlock({ creditBlock: { ...block, at: NOW - CREDIT_BLOCK_FRESH_MS - 1 } }, NOW)).toBe(null)
    expect(freshCreditBlock({}, NOW)).toBe(null)
    // The founder topped up in the meantime: the recorded gap no longer exists.
    expect(freshCreditBlock({ creditBlock: { ...block, available: 250_000 } }, NOW)).toBe(null)
  })
})

describe("the header round trip", () => {
  it("survives the wire and reaches the gate as a pipeline shortfall", () => {
    const header = encodeCreditBlockHeader(block)
    expect(header).not.toMatch(/[{}"]/) // percent-encoded: header-safe ASCII
    const parsed = parseCreditBlockHeader(header, NOW)
    expect(parsed).toMatchObject({
      code: "INSUFFICIENT_CREDITS",
      required: 100_000,
      available: 420,
      action: "your build",
      request: null,
      pipeline: true,
    })
  })

  it("ignores junk, a closed gap and a block that has gone stale", () => {
    expect(parseCreditBlockHeader(null, NOW)).toBe(null)
    expect(parseCreditBlockHeader("not json", NOW)).toBe(null)
    expect(parseCreditBlockHeader(encodeURIComponent("{}"), NOW)).toBe(null)
    expect(
      parseCreditBlockHeader(encodeURIComponent(JSON.stringify({ ...block, required: 10, available: 500 })), NOW),
    ).toBe(null)
    expect(
      parseCreditBlockHeader(
        encodeURIComponent(JSON.stringify({ ...block, at: NOW - CREDIT_BLOCK_FRESH_MS - 1 })),
        NOW,
      ),
    ).toBe(null)
  })
})
