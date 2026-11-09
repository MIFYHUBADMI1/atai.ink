import { describe, it, expect } from "vitest"
import * as fc from "fast-check"

import { scopedIntentKey, dayEpoch } from "./operation-identity"

/**
 * Atai Finance — Phase 3 Workstream C: stable operation identities.
 *
 * A ledger idempotency key has TWO duties that pull in opposite directions:
 * it must be STABLE across retries of one logical operation, and it must be
 * UNIQUE per (user, operation, project, intent) because the ledger's
 * idempotency index is global. These tests pin both properties, plus the
 * validation boundary that keeps a client-supplied string from ever becoming
 * authorization for someone else's charge.
 */

const BASE = { userId: "8f2c41e8-a7b6-4d0e-9c3f-8a2b7d5e1c60", operation: "seo_audit", projectId: "prj_9f2c41e8a7b6" }

/** An opaque-id arbitrary over a legal charset (`~` is deliberately absent:
 * it is the scope↔intent delimiter and no component may contain it). */
function opaqueComponent(alphabet: string, minLength: number, maxLength: number) {
  return fc
    .array(fc.constantFrom(...alphabet.split("")), { minLength, maxLength })
    .map((chars) => chars.join(""))
}

describe("scopedIntentKey — stable across retries", () => {
  it("the same intent from the same caller always produces the same key", () => {
    const a = scopedIntentKey("b3d1e0a2-1111-2222-3333-444455556666", BASE)
    const b = scopedIntentKey("b3d1e0a2-1111-2222-3333-444455556666", BASE)
    expect(a).toBeDefined()
    expect(a).toBe(b)
  })

  it("surrounding whitespace is part of the transport, not the identity", () => {
    expect(scopedIntentKey("  abc123def  ", BASE)).toBe(scopedIntentKey("abc123def", BASE))
  })

  it("the key embeds the operation so an operator can read provenance", () => {
    expect(scopedIntentKey("abcdef123", BASE)).toContain("seo_audit")
  })

  it("is bounded and secret-free (opaque ids only)", () => {
    const key = scopedIntentKey("x".repeat(128), BASE)
    expect(key).toBeDefined()
    expect(key!.length).toBeLessThan(400)
    expect(key).not.toMatch(/[/?#&=\s]/)
  })
})

describe("scopedIntentKey — a client string is never authorization", () => {
  it("rejects anything that is not a bounded opaque id", () => {
    const rejected: unknown[] = [
      undefined,
      null,
      42,
      {},
      [],
      "",
      "   ",
      "short", // < 6 chars
      "x".repeat(129), // > MAX_INTENT_LENGTH
      "has space",
      "path/../traversal",
      "emoji🙂",
      "line\nbreak",
      // the scope↔intent delimiter: allowing it would let a client forge its
      // own scope boundary.
      " forged~delimiter",
      "a~b~c~d~e~f",
    ]
    for (const raw of rejected) {
      expect(scopedIntentKey(raw, BASE), `must reject ${JSON.stringify(raw)}`).toBeUndefined()
    }
  })

  it("accepts the id shapes real clients actually send", () => {
    const accepted = [
      "b3d1e0a2-1111-2222-3333-444455556666", // crypto.randomUUID()
      "rtreq_9f2c41e8a7b64d0e9c3f8a2b7d5e1c60", // this product's correlation ids
      "start.pending:prj_1",
      "req-2026-10-25.1",
      "ABCDEF_0123456789:.-",
    ]
    for (const raw of accepted) {
      expect(scopedIntentKey(raw, BASE), `must accept ${raw}`).toBeDefined()
    }
  })

  it("refuses to build an ambiguous key when a SERVER scope component is unsafe", () => {
    // Defense in depth: today these are UUIDs / `prj_…` literals, but an id
    // format that grew the delimiter (or an empty id) must never silently
    // produce a shareable ledger key.
    expect(scopedIntentKey("abcdef123", { ...BASE, userId: "" })).toBeUndefined()
    expect(scopedIntentKey("abcdef123", { ...BASE, userId: "u~s~er" })).toBeUndefined()
    expect(scopedIntentKey("abcdef123", { ...BASE, userId: "spaced user" })).toBeUndefined()
    expect(scopedIntentKey("abcdef123", { ...BASE, operation: "" })).toBeUndefined()
    expect(scopedIntentKey("abcdef123", { ...BASE, operation: "seo audit" })).toBeUndefined()
    expect(scopedIntentKey("abcdef123", { ...BASE, projectId: "prj~1" })).toBeUndefined()
  })

  it("never truncates an identity into another one", () => {
    // A `slice(0, 64)`-style bound would alias these two accounts onto one
    // prefix — and the second caller's charge would be "already applied".
    const prefix = "a".repeat(64)
    const alice = scopedIntentKey("intent1", { ...BASE, userId: `${prefix}_ALICE` })
    const bob = scopedIntentKey("intent1", { ...BASE, userId: `${prefix}_BOBBY` })
    expect(alice).toBeDefined()
    expect(bob).toBeDefined()
    expect(alice).not.toBe(bob)
  })

  it("a client cannot shift the scope boundary with underscores", () => {
    // Pre-hardening, `user="u_x" + intent="k"` and `user="u" + intent="x_k"`
    // folded to the same string when `_` was both separator and legal intent
    // character. The dedicated `~` delimiter makes that impossible.
    const left = scopedIntentKey("k1234567", { ...BASE, userId: "u_x" })
    const right = scopedIntentKey("x_k1234567", { ...BASE, userId: "u" })
    expect(left).toBeDefined()
    expect(right).toBeDefined()
    expect(left).not.toBe(right)
    // Exactly one delimiter per key: the split is unique by construction.
    expect(left!.split("~")).toHaveLength(2)
    expect(right!.split("~")).toHaveLength(2)
  })
})

describe("scopedIntentKey — isolation across identities and operations", () => {
  const intent = "c0ffee00-dead-beef-0000-000000000001"

  it("different users never share a key for the same intent", () => {
    expect(scopedIntentKey(intent, { ...BASE, userId: "userAAAA" })).not.toBe(
      scopedIntentKey(intent, { ...BASE, userId: "userBBBB" }),
    )
  })

  it("different operations never share a key for the same intent", () => {
    const keys = [
      scopedIntentKey(intent, { ...BASE, operation: "seo_audit" }),
      scopedIntentKey(intent, { ...BASE, operation: "resources_playbook" }),
      scopedIntentKey(intent, { ...BASE, operation: "studio_refine" }),
      scopedIntentKey(intent, { ...BASE, operation: "generate_visual" }),
      scopedIntentKey(intent, { ...BASE, operation: "infrastructure_upgrade" }),
    ]
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("different projects never share a key for the same intent", () => {
    expect(scopedIntentKey(intent, { ...BASE, projectId: "prj_one" })).not.toBe(
      scopedIntentKey(intent, { ...BASE, projectId: "prj_two" }),
    )
  })

  it("account-level operations (no project) are namespaced apart from project ones", () => {
    const account = scopedIntentKey(intent, { userId: BASE.userId, operation: "welcome_claim" })
    const project = scopedIntentKey(intent, BASE)
    expect(account).toBeDefined()
    expect(project).toBeDefined()
    expect(account).not.toBe(project)
  })

  it("property: distinct (operation, project, user, intent) tuples never collide", async () => {
    const component = opaqueComponent("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-", 6, 40)
    const tuple = fc.record({
      operation: component,
      projectId: fc.option(component, { nil: undefined }),
      userId: component,
      intent: component,
    })
    await fc.assert(
      fc.property(tuple, tuple, (a, b) => {
        const keyA = scopedIntentKey(a.intent, a)
        const keyB = scopedIntentKey(b.intent, b)
        if (keyA === undefined || keyB === undefined) return true
        // Equal ledger keys may only describe equal identities.
        if (keyA !== keyB) return true
        return (
          a.operation === b.operation &&
          a.userId === b.userId &&
          a.projectId === b.projectId &&
          a.intent === b.intent
        )
      }),
      { numRuns: 2000 },
    )
  })

  it("property: the same identity is idempotent, whatever the intent", async () => {
    const component = opaqueComponent("abcdefghijklmnopqrstuvwxyz0123456789-_.", 6, 100)
    await fc.assert(
      fc.property(component, component, component, (userId, projectId, intent) => {
        const first = scopedIntentKey(intent, { userId, operation: "seo_audit", projectId })
        const second = scopedIntentKey(intent, { userId, operation: "seo_audit", projectId })
        return first === second
      }),
      { numRuns: 500 },
    )
  })
})

describe("dayEpoch — the same-day double-click key", () => {
  it("buckets by whole UTC days since the epoch", () => {
    expect(dayEpoch(0)).toBe(0)
    expect(dayEpoch(86_400_000 - 1)).toBe(0)
    expect(dayEpoch(86_400_000)).toBe(1)
    expect(dayEpoch(1_732_147_200_000)).toBe(20_048)
  })

  it("is monotonic and never negative for real timestamps", () => {
    let previous = dayEpoch(0)
    for (const ms of [1, 1_000, 86_399_999, 86_400_000, 200_000_000_000]) {
      const current = dayEpoch(ms)
      expect(current).toBeGreaterThanOrEqual(previous)
      previous = current
    }
  })

  it("two purchases seconds apart share one key; a next-day purchase does not", () => {
    const morning = dayEpoch(1_732_147_200_000)
    const momentsLater = dayEpoch(1_732_147_200_000 + 1_500)
    const nextDay = dayEpoch(1_732_147_200_000 + 86_400_000)
    expect(morning).toBe(momentsLater)
    expect(nextDay).not.toBe(morning)
  })

  it("defaults to the current day", () => {
    expect(dayEpoch()).toBe(Math.floor(Date.now() / 86_400_000))
  })
})
