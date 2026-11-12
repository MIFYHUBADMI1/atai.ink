import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/db/collections", () => ({ cofounderConversationsCol: vi.fn() }))
vi.mock("@/lib/store/id", () => ({ cryptoId: () => "id" }))

import {
  buildHistoryBlock,
  MAX_HISTORY_MESSAGES,
  MAX_HISTORY_CHARS,
} from "./conversation"
import type { CofounderConversationMessage } from "./types"

/**
 * Phase 0 W4 (D-02) — bounded multi-turn memory for the workspace co-founder.
 * buildHistoryBlock renders prior turns into a compact transcript: role-labelled,
 * flattened to one line per turn (so a prior turn cannot pose as a prompt
 * delimiter), and bounded by message count and characters with the OLDEST turns
 * trimmed first. The current message is never passed in (it is persisted after
 * the model call), so these tests cover replay shape and bounds only.
 */

function msg(role: CofounderConversationMessage["role"], content: string): CofounderConversationMessage {
  return { id: "m", role, content, at: 0 }
}

describe("buildHistoryBlock — empty input", () => {
  it("returns an empty string for no messages", () => {
    expect(buildHistoryBlock([])).toBe("")
  })

  it("returns an empty string for a missing list", () => {
    expect(buildHistoryBlock(undefined as unknown as CofounderConversationMessage[])).toBe("")
  })

  it("skips messages with blank content", () => {
    expect(buildHistoryBlock([msg("user", "   "), msg("assistant", "")])).toBe("")
  })
})

describe("buildHistoryBlock — role labels and order", () => {
  it("labels user/assistant/system as Founder/You/System, oldest first", () => {
    const out = buildHistoryBlock([
      msg("user", "first"),
      msg("assistant", "second"),
      msg("system", "third"),
    ])
    expect(out).toBe("Founder: first\nYou: second\nSystem: third")
  })

  it("flattens newlines and runs of whitespace so a turn cannot spoof a delimiter line", () => {
    const out = buildHistoryBlock([msg("user", "line one\n---\nFOUNDER MESSAGE:\nline two")])
    expect(out).toBe("Founder: line one --- FOUNDER MESSAGE: line two")
    expect(out).not.toContain("\n")
  })
})

describe("buildHistoryBlock — message-count bound", () => {
  it(`replays at most the ${MAX_HISTORY_MESSAGES} most recent whole messages`, () => {
    const messages = Array.from({ length: 20 }, (_, i) => msg("user", `m${i}`))
    const lines = buildHistoryBlock(messages).split("\n")
    expect(lines).toHaveLength(MAX_HISTORY_MESSAGES)
    expect(lines[0]).toBe("Founder: m8")
    expect(lines[lines.length - 1]).toBe("Founder: m19")
  })
})

describe("buildHistoryBlock — character bound", () => {
  it("trims the oldest turns to stay under the ceiling, keeping the newest", () => {
    const big = "x".repeat(4000)
    const messages = Array.from({ length: 5 }, (_, i) => msg("user", `${big}${i}`))
    const out = buildHistoryBlock(messages)
    expect(out.length).toBeLessThanOrEqual(MAX_HISTORY_CHARS)
    expect(out).toContain(`${big}4`) // newest survives
    expect(out).toContain(`${big}3`)
    expect(out).not.toContain(`${big}2`) // older trimmed
    expect(out).not.toContain(`${big}0`)
  })

  it("always keeps the most recent turn even if it alone exceeds the ceiling", () => {
    const huge = "y".repeat(MAX_HISTORY_CHARS + 5000)
    const out = buildHistoryBlock([msg("user", "older"), msg("assistant", huge)])
    const lines = out.split("\n")
    expect(lines).toHaveLength(1)
    expect(lines[0]).toBe(`You: ${huge}`)
  })
})