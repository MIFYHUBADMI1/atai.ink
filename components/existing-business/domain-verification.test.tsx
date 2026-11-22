import { describe, expect, it, vi } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { DomainView } from "@/lib/domain/service"
import { DomainVerification, methodFor } from "./domain-verification"

vi.mock("@/lib/client/api", () => ({ jsonFetcher: vi.fn(), postJson: vi.fn(), patchJson: vi.fn(), deleteJson: vi.fn() }))

const MINUTE = 60_000

function domain(overrides: Partial<DomainView> = {}): DomainView {
  return {
    id: "dom-1",
    hostname: "bakery.example",
    registrableDomain: "bakery.example",
    submittedUrl: "https://bakery.example",
    status: "verified",
    method: "meta_tag",
    token: "token-1",
    metaSnippet: '<meta name="atai-site-verification" content="token-1" />',
    fileName: null,
    tokenExpiresAt: Date.now() + 24 * 60 * MINUTE,
    attempts: 2,
    lastAttemptAt: Date.now() - 5 * MINUTE,
    lastCheckedAt: Date.now() - 5 * MINUTE,
    verifiedAt: Date.now() - 3 * 24 * 60 * MINUTE,
    verifiedMethod: "meta_tag",
    needsAttention: false,
    lastFailure: null,
    history: [],
    createdAt: Date.now() - 4 * 24 * 60 * MINUTE,
    updatedAt: Date.now() - 5 * MINUTE,
    ...overrides,
  }
}

function render(records: DomainView[]): string {
  return renderToStaticMarkup(
    createElement(DomainVerification, { projectId: "proj-1", initialDomains: records }),
  )
}

describe("DomainVerification — when the last check happened", () => {
  it("says how long ago the domain was checked", () => {
    expect(render([domain()])).toContain("Last checked 5 min ago")
  })

  it("says so plainly when no check has run yet", () => {
    const html = render([domain({ status: "pending", lastCheckedAt: null, verifiedAt: null, verifiedMethod: null })])
    expect(html).toContain("Not checked yet")
  })

  it("shows the failing re-check with its time and its reason", () => {
    const html = render([
      domain({
        needsAttention: true,
        lastFailure: {
          code: "TAG_NOT_FOUND",
          message: "We fetched https://bakery.example and could not find the verification meta tag.",
          at: Date.now() - 5 * MINUTE,
        },
      }),
    ])
    expect(html).toContain("The re-check 5 min ago could not find your tag or file")
    expect(html).toContain("could not find the verification meta tag")
    // A verified domain stays verified, so the founder is not told it is gone.
    expect(html).toContain("Your domain stays verified for now")
  })

  it("shows a failed check on a domain that never verified, with its time", () => {
    const html = render([
      domain({
        status: "failed",
        verifiedAt: null,
        verifiedMethod: null,
        lastFailure: { code: "FETCH_FAILED", message: "The page did not respond.", at: Date.now() - 5 * MINUTE },
      }),
    ])
    expect(html).toContain("The page did not respond.")
    expect(html).toContain("Checked 5 min ago")
  })
})

describe("DomainVerification — choosing how to check", () => {
  it("follows the founder's click without waiting for the server", () => {
    const pending = domain({ status: "pending", method: "meta_tag", verifiedAt: null, verifiedMethod: null })
    // The stored value is the starting point…
    expect(methodFor(pending, {})).toBe("meta_tag")
    // …and one click decides, in either direction, with no round-trip in between.
    expect(methodFor(pending, { "dom-1": "html_file" })).toBe("html_file")
    expect(methodFor({ ...pending, method: "html_file" }, { "dom-1": "meta_tag" })).toBe("meta_tag")
  })

  it("treats a challenge with no stored method as the meta tag", () => {
    expect(methodFor({ id: "dom-1", method: null }, {})).toBe("meta_tag")
  })

  it("offers the switch and the steps on every pending card", () => {
    const html = render([
      domain({
        status: "pending",
        method: "meta_tag",
        verifiedAt: null,
        verifiedMethod: null,
        fileName: "atai-verify-Ab3dEf9hIj2k.txt",
      }),
    ])
    expect(html).toContain("Check with:")
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain("Steps to follow")
    // One control per choice: the duplicate radios belong to a new challenge only.
    expect(html).not.toContain("How do you want to verify?")
  })

  it("names the exact file address the check will open, short and clickable", () => {
    const html = render([
      domain({
        status: "pending",
        method: "html_file",
        verifiedAt: null,
        verifiedMethod: null,
        fileName: "atai-verify-Ab3dEf9hIj2k.txt",
      }),
    ])
    expect(html).toContain("https://bakery.example/atai-verify-Ab3dEf9hIj2k.txt")
    expect(html).toContain("public/")
  })

  it("shows the method radios only when there is nothing to switch yet", () => {
    const html = render([domain({ status: "revoked", verifiedAt: null, verifiedMethod: null })])
    expect(html).toContain("How do you want to verify?")
  })
})
