import { randomUUID } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("ai", () => ({ generateText: vi.fn() }))
vi.mock("@/lib/analysis/model", () => ({ MODEL: "test-model", MODEL_ID: "test-model" }))
vi.mock("@/lib/api/ai-context", () => ({ aiSignal: (signal: unknown) => signal }))
vi.mock("@/lib/store/store", () => ({ cryptoId: () => randomUUID() }))
vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock("@/lib/billing/runtime-config", () => ({
  getExistingBusinessCosts: vi.fn(async () => ({ readCost: 40, assessmentCost: 60 })),
}))
vi.mock("@/lib/billing/credit-service", () => ({
  consumeCredits: vi.fn(async () => ({ success: true })),
  grantCredits: vi.fn(async () => ({ success: true })),
  getAvailableCredits: vi.fn(async () => 100),
}))

import { generateText } from "ai"
import { consumeCredits, grantCredits, getAvailableCredits } from "@/lib/billing/credit-service"
import { getExistingBusinessCosts } from "@/lib/billing/runtime-config"
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
const costsMock = vi.mocked(getExistingBusinessCosts)

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
  costsMock.mockResolvedValue({ readCost: 40, assessmentCost: 60 } as Awaited<ReturnType<typeof getExistingBusinessCosts>>)
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
      ownerDescription: true,
      domainVerified: false,
    })
    const withSources = evidenceHeader({
      ...baseEvidence,
      website: { hostname: "bakery.example", pagesCrawled: 3, digest: "d" },
      domainVerified: true,
    })
    expect(withSources.websiteAnalysed).toBe(true)
    expect(withSources.pagesCrawled).toBe(3)
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
    expect(prompt).toContain("Domain ownership: NOT VERIFIED")
    expect(prompt).toContain("LIVE WEBSITE EVIDENCE: none.")
  })

  it("lists read sources with their real counts", () => {
    const { prompt } = buildAssessmentMessages({
      ...input,
      evidence: {
        ...baseEvidence,
        website: { hostname: "bakery.example", pagesCrawled: 4, digest: "site digest" },
        domainVerified: true,
      },
    })
    expect(prompt).toContain("READ (4 page(s) at bakery.example)")
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

  it("keeps a usable assessment when one field is weak", () => {
    const raw = JSON.stringify(validPayload({ understanding: "too short" }))
    const assessment = buildAssessment(raw, input, actions)
    // A 9-character summary is a reason to distrust that sentence, not a reason
    // to throw away every section the model did produce.
    expect(assessment.understanding).toBe("too short")
    expect(assessment.strengths.length).toBeGreaterThan(0)
  })

  it("drops only the unusable finding, not the whole assessment", () => {
    const payload = validPayload()
    payload.strengths = [
      { title: "Clear niche", detail: "The owner describes a focused product line for office buyers.", basis: "owner_stated" },
      { title: "x", detail: "short", basis: "owner_stated" },
    ]
    const assessment = buildAssessment(JSON.stringify(payload), input, actions)
    expect(assessment.strengths.map((item) => item.title)).toEqual(["Clear niche"])
  })

  it("accepts the key spellings models actually emit", () => {
    const payload = validPayload() as Record<string, unknown>
    payload.current_position = payload.currentPosition
    delete payload.currentPosition
    payload.growth_opportunities = [finding("Office lunch orders", "The site never mentions the office lunch trade it already serves.")]
    delete payload.growthOpportunities
    payload.actionPlan = {
      immediate: ["Add a recurring-order enquiry form."],
      short_term: ["Photograph the counter."],
      later: ["Open a second pickup window."],
    }
    const assessment = buildAssessment(JSON.stringify(payload), input, actions)
    expect(assessment.currentPosition).toContain("steady local demand")
    expect(assessment.growthOpportunities.length).toBe(1)
    expect(assessment.actionPlan.map((entry) => entry.horizon)).toEqual(["immediate", "short_term", "later"])
  })

  it("accepts an action plan shaped as a list of horizons", () => {
    const payload = validPayload()
    ;(payload as Record<string, unknown>).actionPlan = [
      { horizon: "now", items: ["Add a recurring-order enquiry form."] },
    ]
    const assessment = buildAssessment(JSON.stringify(payload), input, actions)
    expect(assessment.actionPlan).toEqual([{ horizon: "immediate", items: ["Add a recurring-order enquiry form."] }])
  })

  it("throws when there is genuinely nothing usable to ship", () => {
    const raw = JSON.stringify({
      understanding: "",
      currentPosition: "",
      strengths: [],
      challenges: [],
      priorities: [],
      openQuestions: [],
    })
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
  const expectedKey = collaborationIdempotencyKey("user-1", "proj-1", "existing-business-intake", "assessment", 60)

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

  it("charges the journey's assessment cost under the intake-specific idempotency key", async () => {
    textMock.mockResolvedValue({ text: JSON.stringify(validPayload()) } as Awaited<ReturnType<typeof generateText>>)
    const outcome = await generateBusinessAssessment(input, { actions })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.charged).toBe(true)
    expect(consumeMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      amount: 60,
      idempotencyKey: expectedKey,
    }))
    // The intake key must not collide with the plan-analysis charge key.
    expect(expectedKey).not.toBe(collaborationIdempotencyKey("user-1", "proj-1", "plan", "analysis", 10))
  })

  it("charges the write plus the founder's engine, and records both parts", async () => {
    textMock.mockResolvedValue({ text: JSON.stringify(validPayload()) } as Awaited<ReturnType<typeof generateText>>)
    const outcome = await generateBusinessAssessment(
      {
        ...input,
        engine: {
          tierId: "ember",
          tierName: "Ember",
          modelId: "vendor/ember-1",
          creditsPerMessage: 5,
          model: "ember-handle" as never,
        },
      },
      { actions },
    )
    expect(outcome.ok).toBe(true)
    expect(consumeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 65,
        metadata: expect.objectContaining({ baseCost: 60, engineCost: 5, engine: "ember" }),
      }),
    )
  })

  it("refunds the engine's share too, so a failed premium read costs nothing", async () => {
    textMock.mockRejectedValue(new Error("provider 502"))
    await generateBusinessAssessment(
      {
        ...input,
        engine: {
          tierId: "ember",
          tierName: "Ember",
          modelId: "vendor/ember-1",
          creditsPerMessage: 5,
          model: "ember-handle" as never,
        },
      },
      { actions },
    )
    expect(grantMock).toHaveBeenCalledWith(expect.objectContaining({ amount: 65 }))
  })

  it("refuses before charging when the balance cannot cover the engine too", async () => {
    availableMock.mockResolvedValueOnce(62)
    const outcome = await generateBusinessAssessment(
      {
        ...input,
        engine: {
          tierId: "ember",
          tierName: "Ember",
          modelId: "vendor/ember-1",
          creditsPerMessage: 5,
          model: "ember-handle" as never,
        },
      },
      { actions },
    )
    expect(outcome).toMatchObject({ ok: false, code: "INSUFFICIENT_CREDITS" })
    expect(consumeMock).not.toHaveBeenCalled()
  })

  it("bills a retry again instead of replaying the refunded charge", async () => {
    textMock.mockRejectedValue(new Error("provider 502"))
    await generateBusinessAssessment({ ...input, attemptId: "1000" }, { actions })
    await generateBusinessAssessment({ ...input, attemptId: "2000" }, { actions })
    const keys = consumeMock.mock.calls.map((call) => call[0].idempotencyKey)
    expect(keys).toHaveLength(2)
    expect(keys[0]).not.toBe(keys[1])
    // The refund of each attempt matches its own charge, never the other's.
    const refunds = grantMock.mock.calls.map((call) => call[0].idempotencyKey)
    expect(refunds).toEqual([`collab_refund_${keys[0]}`, `collab_refund_${keys[1]}`])
  })

  it("refunds the debit when the model call fails", async () => {
    textMock.mockRejectedValue(new Error("provider 502"))
    const outcome = await generateBusinessAssessment(input, { actions })
    expect(outcome).toMatchObject({ ok: false, code: "ASSESSMENT_FAILED" })
    expect(grantMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      amount: 60,
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

  it("asks once more when the first reply cannot be parsed, and charges only once", async () => {
    textMock.mockReset()
    textMock
      .mockResolvedValueOnce({ text: "Here you go:\nnot json" } as Awaited<ReturnType<typeof generateText>>)
      .mockResolvedValueOnce({ text: JSON.stringify(validPayload()) } as Awaited<ReturnType<typeof generateText>>)
    const outcome = await generateBusinessAssessment(input, { actions })
    expect(outcome.ok).toBe(true)
    expect(textMock).toHaveBeenCalledTimes(2)
    expect(consumeMock).toHaveBeenCalledTimes(1)
    expect(grantMock).not.toHaveBeenCalled()
  })

  it("does not ask twice when the provider itself failed", async () => {
    textMock.mockReset()
    textMock.mockRejectedValue(new Error("provider 502"))
    const outcome = await generateBusinessAssessment(input, { actions })
    expect(outcome).toMatchObject({ ok: false, code: "ASSESSMENT_FAILED" })
    expect(textMock).toHaveBeenCalledTimes(1)
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

  it("names the provider status in the reason, and keeps it out of the sentence", async () => {
    textMock.mockReset()
    textMock.mockRejectedValue(Object.assign(new Error("rate limited"), { statusCode: 429 }))
    const outcome = await generateBusinessAssessment(input, { actions })
    expect(outcome).toMatchObject({ ok: false, code: "ASSESSMENT_FAILED" })
    if (!outcome.ok) {
      expect(outcome.detail).toContain("HTTP 429")
      expect(outcome.detail).toContain("rate-limiting")
      expect(outcome.message).not.toContain("429")
    }
  })

  it("does not tell the founder to retry a request the provider will always reject", async () => {
    textMock.mockReset()
    textMock.mockRejectedValue(Object.assign(new Error("Payment Required"), { statusCode: 402 }))
    const outcome = await generateBusinessAssessment(input, { actions })
    if (!outcome.ok) {
      expect(outcome.detail).toContain("out of credit")
      expect(outcome.message).toContain("retrying the same engine will not help")
      expect(outcome.message).toContain("switching engines")
      expect(outcome.message).not.toContain("you can retry.")
    }
  })

  it("calls an aborted call a timeout instead of a generic failure", async () => {
    textMock.mockReset()
    textMock.mockRejectedValue(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }))
    const outcome = await generateBusinessAssessment(input, { actions })
    if (!outcome.ok) expect(outcome.detail).toMatch(/No reply from .* \(timeout\)/)
  })

  it("runs on the founder's engine, not the deployment default", async () => {
    textMock.mockReset()
    textMock.mockResolvedValue({ text: JSON.stringify(validPayload()) } as Awaited<ReturnType<typeof generateText>>)
    await generateBusinessAssessment(
      {
        ...input,
        engine: {
          tierId: "north",
          tierName: "North",
          modelId: "cohere/north-mini-code:free",
          model: "north-handle" as never,
        },
      },
      { actions },
    )
    expect(textMock.mock.calls[0][0]).toMatchObject({ model: "north-handle" })
  })

  it("names the engine that timed out, so the founder knows which one to change", async () => {
    textMock.mockReset()
    textMock.mockRejectedValue(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }))
    const outcome = await generateBusinessAssessment(
      {
        ...input,
        engine: {
          tierId: "north",
          tierName: "North",
          modelId: "cohere/north-mini-code:free",
          model: "north-handle" as never,
        },
      },
      { actions },
    )
    expect(outcome).toMatchObject({ ok: false, reason: "timeout" })
    if (!outcome.ok) expect(outcome.detail).toContain("cohere/north-mini-code:free")
  })

  it("calls a retired model id unavailable and points at switching engines", async () => {
    textMock.mockReset()
    textMock.mockRejectedValue(Object.assign(new Error("No such model"), { statusCode: 404 }))
    const outcome = await generateBusinessAssessment(input, { actions })
    expect(outcome).toMatchObject({ ok: false, reason: "model_unavailable" })
    if (!outcome.ok) expect(outcome.message).toContain("switching engines")
  })

  it("treats an unusable reply as an engine problem, not a silent retry", async () => {
    textMock.mockReset()
    textMock.mockResolvedValue({ text: "no json at all" } as Awaited<ReturnType<typeof generateText>>)
    const outcome = await generateBusinessAssessment(input, { actions })
    expect(outcome).toMatchObject({ ok: false, reason: "format" })
  })

  it("explains an unusable reply by naming the parse problem", async () => {
    textMock.mockReset()
    textMock.mockResolvedValue({ text: "not json at all" } as Awaited<ReturnType<typeof generateText>>)
    const outcome = await generateBusinessAssessment(input, { actions })
    if (!outcome.ok) expect(outcome.detail).toMatch(/JSON|json/)
  })

  it("asks for a smaller reply when the first one ran out of output budget", async () => {
    textMock.mockReset()
    textMock
      .mockResolvedValueOnce({ text: "{\"understanding\": \"A local bak", finishReason: "length" } as Awaited<ReturnType<typeof generateText>>)
      .mockResolvedValueOnce({ text: JSON.stringify(validPayload()), finishReason: "stop" } as Awaited<ReturnType<typeof generateText>>)
    const outcome = await generateBusinessAssessment(input, { actions })
    expect(outcome.ok).toBe(true)
    const secondPrompt = textMock.mock.calls[1][0].prompt as string
    expect(secondPrompt).toContain("CUT SHORT")
    expect(secondPrompt).not.toContain("WAS REJECTED")
  })

  it("skips billing entirely when the configured cost is zero", async () => {
    costsMock.mockResolvedValue({ readCost: 40, assessmentCost: 0 } as Awaited<ReturnType<typeof getExistingBusinessCosts>>)
    textMock.mockResolvedValue({ text: JSON.stringify(validPayload()) } as Awaited<ReturnType<typeof generateText>>)
    const outcome = await generateBusinessAssessment(input, { actions })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.charged).toBe(false)
    expect(consumeMock).not.toHaveBeenCalled()
    expect(availableMock).not.toHaveBeenCalled()
  })
})