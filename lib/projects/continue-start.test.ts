import { describe, expect, it } from "vitest"

/**
 * The pending-start → create payload contract: attached files ride EVERY mode
 * into `attachments`, so no composer path silently drops founder files.
 */

import { buildCreatePayload } from "./continue-start"
import type { PendingStart } from "@/lib/auth/client-intent"

const files = [
  { name: "brief.pdf", content: "data:application/pdf;base64,AAAA", size: 3 },
  { name: "pricing.csv", content: "data:text/csv;base64,BBBB", size: 4 },
]

const base: PendingStart = {
  prompt: "Build my tutoring business",
  title: "TutorMatch",
  href: "/start",
  mode: "idea",
  idempotencyKey: "key-1",
}

describe("buildCreatePayload attachments", () => {
  it("carries attachments in the scratch payload", () => {
    const payload = buildCreatePayload({ ...base, mode: "idea", files })
    expect(payload).toMatchObject({ mode: "scratch", attachments: files })
  })

  it("carries attachments in the website payload", () => {
    const payload = buildCreatePayload({ ...base, mode: "website", prompt: "https://example.com plan a business", files })
    expect(payload).toMatchObject({ mode: "website", attachments: files })
  })

  it("carries attachments in the github payload", () => {
    const payload = buildCreatePayload({ ...base, mode: "github", prompt: "https://github.com/owner/repo add billing", files })
    expect(payload).toMatchObject({ mode: "github", githubRepoOwner: "owner", githubRepoName: "repo", attachments: files })
  })

  it("omits attachments when the pending start has none", () => {
    const payload = buildCreatePayload(base)
    expect(payload.attachments).toBeUndefined()
  })
})
