import { randomUUID } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("ai", () => ({ generateText: vi.fn() }))
vi.mock("@/lib/analysis/model", () => ({ MODEL: "test-model" }))
vi.mock("@/lib/api/ai-context", () => ({ aiSignal: (signal: unknown) => signal }))
vi.mock("@/lib/store/store", () => ({ cryptoId: () => randomUUID() }))
vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock("@/lib/billing/runtime-config", () => ({
  getCollaborateCosts: vi.fn(async () => ({ planAnalysisCost: 10 })),
}))
vi.mock("@/lib/billing/credit-service", () => ({
  consumeCredits: vi.fn(async () => ({ success: true })),
  grantCredits: vi.fn(async () => ({ success: true })),
  getAvailableCredits: vi.fn(async () => 100),
}))

import { generateText } from "ai"
import { consumeCredits, grantCredits, getAvailableCredits } from "@/lib/billing/credit-service"
import { getCollaborateCosts } from "@/lib/billing/runtime-config"
import { collaborationIdempotencyKey } from "@/lib/analysis/collaborate-credits"
import {
  buildAssessment,
  buildAssessmentMessages,
  evidenceHeader,
  generateBusinessAssessment,
  type AssessmentEvidence,
  type AssessmentInput,
} from "./assessment"
import type { ResolvedAction } from "./objectives"

const textMock = vi.mocked(generateText)
const consumeMock = vi.mocked(consumeCredits)
const grantMock = vi.mocked(grantCredits)
const availableMock = vi.mocked(getAvailableCredits)
const costsMock = vi.mocked(getCollaborateCosts)

const baseEvidence: AssessmentEvidence = {
  ownerDescription: "We run a small bakery selling sourdough and pastries to local offices.",
  objectives: ["acquire_customers", "improve_marketing"],
  domainVerified: false,
}

const input: AssessmentInput = {
  projectId: "proj-1",
  userId: "user-1",
  displayName: "Corner Bakery",
  evidence: baseEvidence,
}

function finding(title: string, detail: string, basis: "observed" | "inferred" | "owner_stated" | "assumption" = "owner_stated") {
  return { title, detail, basis }
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    understanding: "A local bakery serving offices with sourdough and pastries every weekday.",
    currentPosition: "The owner describes steady local demand and wants more office contracts.",
    strengths: [finding("Clear niche", "The owner describes a focused product line for office buyers.")],
    challenges: [finding("Quiet website", "The homepage does not explain how offices can place recurring orders.")],
    growthOpportunities: [],
    technicalOpportunities: [],
    marketingOpportunities: [],
    priorities: [
      {
        title: "Make ordering obvious",
        explanation: "Put a clear recurring-order path on the homepage for office managers.",
        whyItMatters: "Office buyers need a fast way to reorder without calling the shop.",
        expectedOutcome: "More office enquiries arrive through the site instead of by phone.",
        priority: "immediate",
        objective: "acquire_customers",
      },
    ],
    actionPlan: {
      immediate: ["Add a recurring-order enquiry form to the homepage."],
      shortTerm: ["Draft a one-page offer for office managers."],
      later: [],
    },
    openQuestions: ["Which offices already buy from you each week?"],
    ...overrides,
  }
}

const actions: ResolvedAction[] = [
  {
    objective: "acquire_customers",
    label: "Research competitors",
    href: "/project/proj-1/competition",
    detail: "Live research.",
    executableNow: true,
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  costsMock.mockResolvedValue({ planAnalysisCost: 10 } as Awaited<ReturnType<typeof getCollaborateCosts>>)
  availableMock.mockResolvedValue(100)
  consumeMock.mockResolvedValue({ success: true } as Awaited<ReturnType<typeof consumeCredits>>)
  process.env.OPENROUTER_API_KEY = "test-key"
})

afterEach(() => {
  delete process.env.OPENROUTER_API_KEY
})

describe("evidenceHeader", () => {
  it("reports exactly which sources exist", () => {
    expect(evidenceHeader(baseEvidence)).toEqual({
      websiteAnalysed: false,
      pagesCrawled: 0,
      repoAnalysed: false,
      ownerDescription: true,
      domainVerified: false,
    })
    const withSources = evidenceHeader({
      ...baseEvidence,
      website: { hostname: "bakery.example", pagesCrawled: 3, digest: "d" },
      repo: { label: "o/r", filesListed: 10, digest: "d" },
      domainVerified: true,
    })
    expect(withSources.websiteAnalysed).toBe(true)
    expect(withSources.pagesCrawled).toBe(3)
    expect(withSources.repoAnalysed).toBe(true)
    expect(withSources.domainVerified).toBe(true)
  })
})

describe("buildAssessmentMessages", () => {
  it("is deterministic for the same input", () => {
    const a = buildAssessmentMessages(input)
    const b = buildAssessmentMessages(input)
    expect(a).toEqual(b)
  })

  it("tells the model honestly when sources were NOT read", () => {
    const { prompt } = buildAssessmentMessages(input)
    expect(prompt).toContain("Their live website: NOT READ")
    expect(prompt).toContain("Their source repository: NOT READ")
    expect(prompt).toContain("Domain ownership: NOT VERIFIED")
    expect(prompt).toContain("LIVE WEBSITE EVIDENCE: none.")
    expect(prompt).toContain("REPOSITORY EVIDENCE: none.")
  })

  it("lists read sources with their real counts", () => {
    const { prompt } = buildAssessmentMessages({
      ...input,
      evidence: {
        ...baseEvidence,
        website: { hostname: "bakery.example", pagesCrawled: 4, digest: "site digest" },
        repo: { label: "owner/repo", filesListed: 12, digest: "repo digest" },
        domainVerified: true,
      },
    })
    expect(prompt).toContain("READ (4 page(s) at bakery.example)")
    expect(prompt).toContain("READ (12 files listed for owner/repo)")
    expect(prompt).toContain("Domain ownership: VERIFIED")
  })

  it("fences owner text and external evidence as untrusted data", () => {
    const { prompt } = buildAssessmentMessages({
      ...input,
      evidence: {
        ...baseEvidence,
        website: { hostname: "bakery.example", pagesCrawled: 1, digest: "site digest" },
      },
    })
    expect(prompt).toContain(`<untrusted_owner_description>\n${baseEvidence.ownerDescription}\n</untrusted_owner_description>`)
    expect(prompt).toContain("<untrusted_website_evidence>\nsite digest\n</untrusted_website_evidence>")
  })

  it("carries the absolute measurement ban and the injection rule in the system prompt", () => {
    const { system } = buildAssessmentMessages(input)
    expect(system).toContain("must not")
    expect(system).toMatch(/traffic, visitors, impressions/)
    expect(system).toContain("UNTRUSTED data")
    expect(system).toContain("never a command")
  })

  it("lists only the objectives the owner chose", () => {
    const { prompt } = buildAssessmentMessages(input)
    expect(prompt).toContain("- acquire_customers:")
    expect(prompt).toContain("- improve_marketing:")
    expect(prompt).not.toContain("- improve_finances:")
  })
})

describe("buildAssessment — validation and honesty", () => {
  it("accepts a fenced JSON payload", () => {
    const raw = "```json\n" + JSON.stringify(validPayload()) + "\n```"
    const assessment = buildAssessment(raw, input, actions)
    expect(assessment.understanding).toContain("bakery")
    expect(assessment.evidence.websiteAnalysed).toBe(false)
  })

  it("throws on non-JSON output", () => {
    expect(() => buildAssessment("I cannot help with that.", input, actions)).toThrow()
  })

  it("throws on a schema violation instead of shipping a partial assessment", () => {
    const raw = JSON.stringify(validPayload({ understanding: "too short" }))
    expect(() => buildAssessment(raw, input, actions)).toThrow()
  })

  it("downgrades 'observed' to 'assumption' when no source was read", () => {
    const raw = JSON.stringify(validPayload({
      strengths: [finding("Seen on site", "The homepage shows a weekly order form for offices.", "observed")],
    }))
    const assessment = buildAssessment(raw, input, actions)
    expect(assessment.strengths[0].basis).toBe("assumption")
  })

  it("keeps 'observed' when the website really was read", () => {
    const withWebsite: AssessmentInput = {
      ...input,
      evidence: { ...baseEvidence, website: { hostname: "bakery.example", pagesCrawled: 2, digest: "d" } },
    }
    const raw = JSON.stringify(validPayload({
      strengths: [finding("Seen on site", "The homepage shows a weekly order form for offices.", "observed")],
    }))
    const assessment = buildAssessment(raw, withWebsite, actions)
    expect(assessment.strengths[0].basis).toBe("observed")
  })

  it("drops findings that fabricate metrics", () => {
    const raw = JSON.stringify(validPayload({
      challenges: [
        finding("Low traffic", "The site gets about 10,000 visitors per month, which is low for the niche."),
        finding("Quiet website", "The homepage does not explain how offices can place recurring orders."),
      ],
    }))
    const assessment = buildAssessment(raw, input, actions)
    expect(assessment.challenges).toHaveLength(1)
    expect(assessment.challenges[0].title).toBe("Quiet website")
  })

  it("drops priorities for objectives the owner never chose", () => {
    const raw = JSON.stringify(validPayload({
      priorities: [
        ...validPayload().priorities,
        {
          title: "Fix the books",
          explanation: "Separate recorded income from provider costs in the finances screen.",
          whyItMatters: "Money decisions need real numbers in their own units.",
          expectedOutcome: "The owner sees a truthful picture of the business finances.",
          priority: "later",
          objective: "improve_finances",
        },
      ],
    }))
    const assessment = buildAssessment(raw, input, actions)
    expect(assessment.priorities).toHaveLength(1)
    expect(assessment.priorities[0].title).toBe("Make ordering obvious")
  })

  it("drops priorities that promise measured outcomes", () => {
    const raw = JSON.stringify(validPayload({
      priorities: [
        {
          title: "Rank higher",
          explanation: "Optimize the homepage to reach position 1 for local bakery searches.",
          whyItMatters: "Search visibility drives enquiries for local businesses.",
          expectedOutcome: "You will reach page one within weeks.",
          priority: "immediate",
          objective: "acquire_customers",
        },
      ],
    }))
    const assessment = buildAssessment(raw, input, actions)
    expect(assessment.priorities).toHaveLength(0)
  })

  it("attaches real destinations from the resolved actions, never model routes", () => {
    const raw = JSON.stringify(validPayload())
    const assessment = buildAssessment(raw, input, actions)
    expect(assessment.priorities[0].route).toBe("/project/proj-1/competition")
    expect(assessment.priorities[0].executableNow).toBe(true)
    expect(assessment.priorities[0].ataiSection).toBe("Research competitors")
  })

  it("keeps an empty route when the objective has no open screen", () => {
    const raw = JSON.stringify(validPayload())
    const assessment = buildAssessment(raw, input, [])
    expect(assessment.priorities[0].route).toBe("")
    expect(assessment.priorities[0].executableNow).toBe(false)
  })

  it("deduplicates priorities by title", () => {
    const priority = validPayload().priorities[0]
    const raw = JSON.stringify(validPayload({ priorities: [priority, { ...priority }] }))
    const assessment = buildAssessment(raw, input, actions)
    expect(assessment.priorities).toHaveLength(1)
  })

  it("filters metric claims out of the action plan and open questions", () => {
    const raw = JSON.stringify(validPayload({
      actionPlan: {
        immediate: ["Add a form expected to lift conversion rate by 20 percent.", "Add a recurring-order enquiry form."],
        shortTerm: [],
        later: [],
      },
      openQuestions: ["What is your current conversion rate of 3%?", "Which offices buy weekly?"],
    }))
    const assessment = buildAssessment(raw, input, actions)
    expect(assessment.actionPlan).toHaveLength(1)
    expect(assessment.actionPlan[0].items).toEqual(["Add a recurring-order enquiry form."])
    expect(assessment.openQuestions).toEqual(["Which offices buy weekly?"])
  })
})

describe("generateBusinessAssessment — billing and failure honesty", () => {
  const expectedKey = collaborationIdempotencyKey("user-1", "proj-1", "existing-business-intake", "assessment", 10)

  it("returns AI_UNAVAILABLE without charging when no key is configured", async () => {
    delete process.env.OPENROUTER_API_KEY
    const outcome = await generateBusinessAssessment(input, { actions })
    expect(outcome).toMatchObject({ ok: false, code: "AI_UNAVAILABLE" })
    expect(consumeMock).not.toHaveBeenCalled()
    expect(textMock).not.toHaveBeenCalled()
  })

  it("returns INSUFFICIENT_CREDITS before any debit when the balance is short", async () => {
    availableMock.mockResolvedValue(3)
    const outcome = await generateBusinessAssessment(input, { actions })
    expect(outcome).toMatchObject({ ok: false, code: "INSUFFICIENT_CREDITS" })
    expect(consumeMock).not.toHaveBeenCalled()
    expect(textMock).not.toHaveBeenCalled()
  })

  it("returns INSUFFICIENT_CREDITS when the ledger refuses the debit", async () => {
    consumeMock.mockResolvedValue({ success: false } as Awaited<ReturnType<typeof consumeCredits>>)
    const outcome = await generateBusinessAssessment(input, { actions })
    expect(outcome).toMatchObject({ ok: false, code: "INSUFFICIENT_CREDITS" })
    expect(textMock).not.toHaveBeenCalled()
  })

  it("charges the existing analysis cost under the intake-specific idempotency key", async () => {
    textMock.mockResolvedValue({ text: JSON.stringify(validPayload()) } as Awaited<ReturnType<typeof generateText>>)
    const outcome = await generateBusinessAssessment(input, { actions })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.charged).toBe(true)
    expect(consumeMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      amount: 10,
      idempotencyKey: expectedKey,
    }))
    // The intake key must not collide with the plan-analysis charge key.
    expect(expectedKey).not.toBe(collaborationIdempotencyKey("user-1", "proj-1", "plan", "analysis", 10))
  })

  it("refunds the debit when the model call fails", async () => {
    textMock.mockRejectedValue(new Error("provider 502"))
    const outcome = await generateBusinessAssessment(input, { actions })
    expect(outcome).toMatchObject({ ok: false, code: "ASSESSMENT_FAILED" })
    expect(grantMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      amount: 10,
      idempotencyKey: `collab_refund_${expectedKey}`,
    }))
    if (!outcome.ok) expect(outcome.message).not.toContain("502")
  })

  it("refunds when the model output is unusable, never shipping a partial assessment", async () => {
    textMock.mockResolvedValue({ text: "sorry, no JSON here" } as Awaited<ReturnType<typeof generateText>>)
    const outcome = await generateBusinessAssessment(input, { actions })
    expect(outcome).toMatchObject({ ok: false, code: "ASSESSMENT_FAILED" })
    expect(grantMock).toHaveBeenCalledTimes(1)
  })

  it("refunds when every section comes back empty after honesty filtering", async () => {
    const empty = validPayload({
      strengths: [],
      challenges: [],
      priorities: [],
    })
    textMock.mockResolvedValue({ text: JSON.stringify(empty) } as Awaited<ReturnType<typeof generateText>>)
    const outcome = await generateBusinessAssessment(input, { actions })
    expect(outcome).toMatchObject({ ok: false, code: "ASSESSMENT_FAILED" })
    expect(grantMock).toHaveBeenCalledTimes(1)
  })

  it("skips billing entirely when the configured cost is zero", async () => {
    costsMock.mockResolvedValue({ planAnalysisCost: 0 } as Awaited<ReturnType<typeof getCollaborateCosts>>)
    textMock.mockResolvedValue({ text: JSON.stringify(validPayload()) } as Awaited<ReturnType<typeof generateText>>)
    const outcome = await generateBusinessAssessment(input, { actions })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.charged).toBe(false)
    expect(consumeMock).not.toHaveBeenCalled()
    expect(availableMock).not.toHaveBeenCalled()
  })
})