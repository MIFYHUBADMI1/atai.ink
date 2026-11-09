import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const { insertOne, updateOne, crawlMock, recMock } = vi.hoisted(() => ({
  insertOne: vi.fn(),
  updateOne: vi.fn(),
  crawlMock: vi.fn(),
  recMock: vi.fn(),
}))

vi.mock("./crawl", () => ({
  isFirecrawlConfigured: () => true,
  crawlUrlToEvidence: crawlMock,
}))

vi.mock("./recommendations", () => ({
  isSeoRecommendationConfigured: () => true,
  generateSeoRecommendations: recMock,
}))

vi.mock("@/lib/db/collections", () => ({
  seoAuditsCol: async () => ({ insertOne, updateOne }),
}))

vi.mock("@/lib/store/store", () => ({
  cryptoId: () => "testid",
}))

import { markSeoAuditRefund, runSeoAudit, seoSafeFailureMessage } from "./service"
import { AppError } from "@/lib/errors"
import type { WebsiteEvidence } from "@/lib/integrations/firecrawl/types"

/**
 * Failure semantics are the point of these tests:
 *  - a crawl failure is persisted as a failed audit with a safe error and no
 *    net charge, then rethrown so the caller refunds;
 *  - an AI recommendation failure never discards the deterministic audit.
 */

function evidenceFixture(overrides: Partial<WebsiteEvidence> = {}): WebsiteEvidence {
  return {
    sourceUrl: "https://acme.example.com",
    title: "Acme — build faster",
    description: "Acme helps teams ship internal tools.",
    pages: [
      {
        url: "https://acme.example.com",
        title: "Acme — build faster",
        description: "Acme helps teams ship internal tools.",
        headings: ["Build faster"],
        links: ["https://acme.example.com/pricing"],
        images: [],
        markdown: "Welcome to Acme.",
      },
    ],
    navigation: [],
    assets: [],
    screenshots: [],
    metadata: {},
    usage: { pagesCrawled: 1, creditsEstimated: 1, cached: false },
    collectedAt: 1,
    ...overrides,
  }
}

/** Evidence with one observed failure (no meta description) so the AI step is reached. */
function failingEvidence(): WebsiteEvidence {
  const e = evidenceFixture()
  e.description = ""
  e.pages[0].description = ""
  return e
}

function insertedDoc() {
  return insertOne.mock.calls[0][0] as Record<string, unknown>
}

describe("runSeoAudit failure handling", () => {
  beforeEach(() => {
    insertOne.mockReset()
    updateOne.mockReset()
    crawlMock.mockReset()
    recMock.mockReset()
  })

  it("persists a failed audit with a safe error and a pending refund, then rethrows", async () => {
    crawlMock.mockRejectedValue(new AppError("FIRECRAWL_UNAVAILABLE"))
    const onFailedAuditPersisted = vi.fn()

    await expect(
      runSeoAudit({
        userId: "u1",
        projectId: "p1",
        url: "https://acme.example.com",
        creditsCharged: 15,
        onFailedAuditPersisted,
      }),
    ).rejects.toMatchObject({ code: "FIRECRAWL_UNAVAILABLE" })

    expect(insertOne).toHaveBeenCalledTimes(1)
    const doc = insertedDoc()
    expect(doc.status).toBe("failed")
    expect(doc.error).toBe("Atai couldn't reach your website to inspect it.")
    // The amount that was actually charged is kept, and the reversal starts
    // as pending until the caller confirms it.
    expect(doc.creditsCharged).toBe(15)
    expect(doc.refund).toEqual({ status: "pending", amount: 15 })
    expect(doc.findings).toEqual([])
    expect(doc.projectId).toBe("p1")
    expect(doc.userId).toBe("u1")
    // No fabricated score on a failed crawl.
    expect(doc.auditScore).toBeUndefined()
    // The caller is told the row exists so it can stamp the refund outcome.
    expect(onFailedAuditPersisted).toHaveBeenCalledWith("seo_testid")
  })

  it("marks a free failed audit as not charged", async () => {
    crawlMock.mockRejectedValue(new AppError("FIRECRAWL_UNAVAILABLE"))

    await expect(
      runSeoAudit({ userId: "u1", projectId: "p1", url: "https://acme.example.com" }),
    ).rejects.toMatchObject({ code: "FIRECRAWL_UNAVAILABLE" })

    expect(insertedDoc().refund).toEqual({ status: "not_charged" })
  })

  it("records the confirmed refund on the stored failed audit, project-scoped", async () => {
    await markSeoAuditRefund("p1", "seo_testid", "refunded", 15)

    expect(updateOne).toHaveBeenCalledWith(
      { projectId: "p1", id: "seo_testid" },
      { $set: { refund: { status: "refunded", at: expect.any(Number), amount: 15 } } },
    )
  })

  it("uses the generic message for an unrecognised failure", () => {
    expect(seoSafeFailureMessage("SOMETHING_NEW")).toBe("The audit didn't finish. Please try again.")
    expect(seoSafeFailureMessage(undefined)).toBe("The audit didn't finish. Please try again.")
    expect(seoSafeFailureMessage("VALIDATION")).toBe("That website address can't be audited.")
  })

  it("keeps the completed audit when AI recommendations fail", async () => {
    crawlMock.mockResolvedValue({ evidence: failingEvidence(), fromCache: false })
    recMock.mockRejectedValue(new AppError("AI_UNAVAILABLE"))

    const outcome = await runSeoAudit({
      userId: "u1",
      projectId: "p1",
      url: "https://acme.example.com",
      creditsCharged: 15,
      projectName: "Acme",
    })

    expect(outcome.status).toBe("completed")
    expect(outcome.recommendations).toEqual([])
    expect(outcome.recommendationsMeta).toEqual({ status: "unavailable" })
    expect(outcome.auditScore.value).not.toBeNull()

    const doc = insertedDoc()
    expect(doc.status).toBe("completed")
    expect(doc.recommendationsMeta).toEqual({ status: "unavailable" })
    expect(doc.recommendations).toBeUndefined()
  })

  it("persists grounded recommendations when generation succeeds", async () => {
    crawlMock.mockResolvedValue({ evidence: failingEvidence(), fromCache: false })
    recMock.mockResolvedValue({
      model: "test-model",
      recommendations: [
        {
          title: "Add a meta description",
          whyItMatters: "Search results show a snippet for each page.",
          action: "Write a one-sentence description of the page.",
          findingIds: ["meta_description"],
          priority: "high",
          requiresDeveloper: false,
          origin: "ai_generated_from_observed_findings",
        },
      ],
    })

    const outcome = await runSeoAudit({
      userId: "u1",
      projectId: "p1",
      url: "https://acme.example.com",
      projectName: "Acme",
    })

    expect(outcome.recommendations).toHaveLength(1)
    expect(outcome.recommendationsMeta.status).toBe("generated")
    expect(outcome.recommendationsMeta.model).toBe("test-model")
    expect((insertedDoc().recommendations as unknown[]).length).toBe(1)
  })

  it("skips the model entirely when no check failed", async () => {
    crawlMock.mockResolvedValue({ evidence: evidenceFixture(), fromCache: true })

    const outcome = await runSeoAudit({ userId: "u1", projectId: "p1", url: "https://acme.example.com" })

    expect(recMock).not.toHaveBeenCalled()
    expect(outcome.recommendationsMeta).toEqual({ status: "no_findings" })
    // Provenance is recorded on the stored document.
    expect(insertedDoc().fromCache).toBe(true)
  })
})
