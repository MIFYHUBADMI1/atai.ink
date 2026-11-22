import { beforeEach, describe, expect, it, vi } from "vitest"
import type { BusinessDomainDoc } from "@/lib/types/business-intake"
import { CLAIM_REMINDER_WINDOW_MS, sendClaimNotices } from "./claim-notices"

type Doc = Record<string, unknown>
const col = vi.hoisted(() => ({ docs: [] as Doc[] }))

vi.mock("@/lib/db/collections", () => ({
  businessDomainsCol: vi.fn(async () => ({
    find: (filter: Doc) => {
      let rows = col.docs.filter((doc) => matches(doc, filter))
      const chain = {
        sort(spec: Doc) {
          const [key, direction] = Object.entries(spec)[0]
          rows = [...rows].sort((a, b) => {
            const left = (a[key] as number | undefined) ?? 0
            const right = (b[key] as number | undefined) ?? 0
            return direction === 1 ? left - right : right - left
          })
          return chain
        },
        limit(count: number) {
          rows = rows.slice(0, count)
          return chain
        },
        toArray: async () => rows,
      }
      return chain
    },
    updateOne: async (filter: Doc, update: Doc) => {
      const doc = col.docs.find((d) => matches(d, filter))
      if (doc && update.$set) Object.assign(doc, update.$set)
      return { matchedCount: doc ? 1 : 0 }
    },
  })),
  usersCol: vi.fn(),
}))

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (cond && typeof cond === "object") {
      const c = cond as Record<string, unknown>
      return Object.entries(c).every(([op, operand]) => {
        if (op === "$exists") return operand ? doc[key] !== undefined : doc[key] === undefined
        if (typeof doc[key] !== "number") return false
        if (op === "$gt") return (doc[key] as number) > (operand as number)
        if (op === "$lte") return (doc[key] as number) <= (operand as number)
        return false
      })
    }
    return doc[key] === cond
  })
}

const NOW = 1_700_000_000_000
const HOUR = 3_600_000

function claim(overrides: Partial<BusinessDomainDoc> = {}): BusinessDomainDoc {
  return {
    id: "d1",
    projectId: "p1",
    userId: "u1",
    hostname: "bakery.example",
    canonicalHostname: "bakery.example",
    registrableDomain: "bakery.example",
    submittedUrl: "https://bakery.example",
    status: "pending",
    claimExpiresAt: NOW + 10 * HOUR,
    createdAt: NOW - 60 * HOUR,
    updatedAt: NOW - HOUR,
    ...overrides,
  }
}

const owner = vi.fn(async () => ({ email: "founder@example.com", name: "Amina" }))

beforeEach(() => {
  col.docs = []
  owner.mockClear()
})

describe("sendClaimNotices", () => {
  it("warns the owner once before the reservation closes", async () => {
    col.docs = [claim()]
    const send = vi.fn(async () => undefined)

    const first = await sendClaimNotices({ now: NOW, send, lookupOwner: owner, appUrl: "https://atai.ink" })
    const second = await sendClaimNotices({ now: NOW + HOUR, send, lookupOwner: owner, appUrl: "https://atai.ink" })

    expect(first.remindersSent).toBe(1)
    expect(second.remindersSent).toBe(0)
    expect(send).toHaveBeenCalledTimes(1)
    const message = send.mock.calls[0][0] as { to: string; subject: string; text: string }
    expect(message.to).toBe("founder@example.com")
    expect(message.subject).toContain("bakery.example")
    expect(message.text).toContain("https://atai.ink/project/p1/business")
  })

  it("ignores claims outside the window, verified ones and released ones", async () => {
    col.docs = [
      claim({ id: "far", claimExpiresAt: NOW + CLAIM_REMINDER_WINDOW_MS + HOUR }),
      claim({ id: "verified", verifiedAt: NOW - HOUR, claimExpiresAt: undefined }),
      claim({ id: "released", releasedAt: NOW - HOUR }),
    ]
    const send = vi.fn(async () => undefined)

    const report = await sendClaimNotices({ now: NOW, send, lookupOwner: owner, appUrl: "https://atai.ink" })

    expect(report.remindersSent).toBe(0)
    expect(send).not.toHaveBeenCalled()
  })

  it("tells the owner when the window actually closed", async () => {
    col.docs = [claim({ status: "revoked", releasedAt: NOW - HOUR, expiredUnverified: true, claimExpiresAt: undefined })]
    const send = vi.fn(async () => undefined)

    const report = await sendClaimNotices({ now: NOW, send, lookupOwner: owner, appUrl: "https://atai.ink" })

    expect(report.releasesSent).toBe(1)
    const message = send.mock.calls[0][0] as { text: string }
    expect(message.text.toLowerCase()).toContain("reconnect")
  })

  it("never emails about a release the founder performed themselves", async () => {
    col.docs = [claim({ status: "revoked", releasedAt: NOW - HOUR, claimExpiresAt: undefined })]
    const send = vi.fn(async () => undefined)

    const report = await sendClaimNotices({ now: NOW, send, lookupOwner: owner, appUrl: "https://atai.ink" })

    expect(report.releasesSent).toBe(0)
    expect(send).not.toHaveBeenCalled()
  })

  it("retries after a delivery failure instead of marking it sent", async () => {
    col.docs = [claim()]
    const send = vi.fn(async () => {
      throw new Error("smtp down")
    })

    const report = await sendClaimNotices({ now: NOW, send, lookupOwner: owner, appUrl: "https://atai.ink" })

    expect(report.remindersSent).toBe(0)
    expect(report.failures).toHaveLength(1)
    expect(col.docs[0].claimReminderSentAt).toBeUndefined()
  })

  it("stops retrying when there is no deliverable address", async () => {
    col.docs = [claim()]
    const send = vi.fn(async () => undefined)
    const noAddress = vi.fn(async () => null)

    const report = await sendClaimNotices({ now: NOW, send, lookupOwner: noAddress, appUrl: "https://atai.ink" })

    expect(report.remindersSent).toBe(0)
    expect(send).not.toHaveBeenCalled()
    expect(col.docs[0].claimReminderSentAt).toBe(NOW)
  })
})
