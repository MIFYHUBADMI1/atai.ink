import { describe, it, expect, vi } from "vitest"

vi.mock("server-only", () => ({}))

vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn().mockResolvedValue({ id: "u1" }),
  requireAdmin: vi.fn().mockResolvedValue({ id: "admin1" }),
}))

import { POST as createTopUp } from "./top-up/route"
import { POST as verifyTopUp } from "./top-up/[id]/verify/route"
import { POST as uploadEvidence } from "./top-up/[id]/evidence/route"
import { POST as adminTopUpAction } from "./admin/top-ups/[id]/route"

// Phase 1 — legacy Mobile Money gateway removal.
// None of these routes may initiate a top-up, verify a payment, or grant
// credits. Dodo Payments is the sole supported gateway.

describe("legacy mobile-money routes cannot initiate payments or grant credits", () => {
  it("POST /api/billing/top-up (create) is deprecated with 410", async () => {
    const res = await createTopUp()
    expect(res.status).toBe(410)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe("DEPRECATED")
    // Response must not leak any legacy payment instructions.
    const text = JSON.stringify(body)
    expect(text).not.toMatch(/MTN|Airtel|UGX/i)
  })

  it("POST /api/billing/top-up/[id]/verify is deprecated with 410", async () => {
    const res = await verifyTopUp()
    expect(res.status).toBe(410)
    const body = await res.json()
    expect(body.error.code).toBe("DEPRECATED")
    expect(JSON.stringify(body)).not.toMatch(/MTN|Airtel|UGX/i)
  })

  it("POST /api/billing/top-up/[id]/evidence is deprecated with 410", async () => {
    const res = await uploadEvidence()
    expect(res.status).toBe(410)
    const body = await res.json()
    expect(body.error.code).toBe("DEPRECATED")
  })

  it("POST /api/billing/admin/top-ups/[id] (approve/reject) is deprecated with 410", async () => {
    const req = new Request("http://localhost/api/billing/admin/top-ups/t1", {
      method: "POST",
      body: JSON.stringify({ action: "approve" }),
      headers: { "content-type": "application/json" },
    })
    const res = await adminTopUpAction(req, { params: Promise.resolve({ id: "t1" }) })
    expect(res.status).toBe(410)
    const body = await res.json()
    expect(body.error.code).toBe("DEPRECATED")
  })
})
