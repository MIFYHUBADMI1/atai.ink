import { describe, it, expect } from "vitest"
import {
  PLAN_SECTIONS,
  getPlanSection,
  sectionStatus,
  computePlanHealth,
  validatePlanSectionValue,
  clampPlanSectionValue,
  MAX_PLAN_SECTION_LENGTH,
  applySectionUpdate,
  clearSectionUpdate,
  isPlaceholderValue,
  readValuePropositionText,
  readMarketPositioningText,
} from "@/lib/analysis/plan-sections"
import { parseChatProposal, parseAnalysisResponse, buildProposal } from "@/lib/analysis/cofounder"
import { ApplicationSpecificationSchema, type ApplicationSpecification } from "@/lib/types/specification"

function makeSpec(overrides: Partial<ApplicationSpecification> = {}): ApplicationSpecification {
  return ApplicationSpecificationSchema.parse({
    applicationType: "saas",
    title: "Test App",
    description: "A test application for founders.",
    purpose: "Test the collaborate workspace.",
    ...overrides,
  })
}

describe("plan sections", () => {
  it("maps every section to a real spec field and never throws", () => {
    const spec = makeSpec()
    for (const def of PLAN_SECTIONS) {
      expect(typeof def.read(spec)).toBe("string")
      expect(def.label.length).toBeGreaterThan(0)
      expect(def.group.length).toBeGreaterThan(0)
    }
  })

  it("marks empty fields as missing and populated fields as complete", () => {
    const spec = makeSpec({ vision: "Become the default tool for indie founders." })
    expect(sectionStatus(getPlanSection("vision")!, spec)).toBe("complete")
    expect(sectionStatus(getPlanSection("businessModel")!, spec)).toBe("missing")
  })

  it("does not treat generic Runtime & Integrations copy as complete", () => {
    const generic = makeSpec({
      runtimeIntegrations: "Data Storage: persists user accounts.\nThird-party API Integration: stock quotes.",
    })
    expect(sectionStatus(getPlanSection("runtimeIntegrations")!, generic)).toBe("needs_work")

    const grounded = makeSpec({
      runtimeIntegrations:
        "Uses @atai-group/sdk with ATAI_API_KEY at /api/runtime/v1. ai.text (atai.ai.chat) answers workspace questions.",
    })
    expect(sectionStatus(getPlanSection("runtimeIntegrations")!, grounded)).toBe("complete")
  })

  it("treats generator placeholders as missing", () => {
    expect(isPlaceholderValue("Not defined yet: who pays?")).toBe(true)
    expect(isPlaceholderValue("A real vision statement")).toBe(false)
  })

  it("computes a deterministic, explainable health percentage", () => {
    const spec = makeSpec()
    const health = computePlanHealth(spec)
    const complete = health.sections.filter((s) => s.status === "complete").length
    expect(health.percent).toBe(Math.round((complete / PLAN_SECTIONS.length) * 100))
    expect(health.missing.length).toBe(PLAN_SECTIONS.length - complete)
  })

  it("combines legacy marketing, launch and growth into one Marketing Plan section", () => {
    const legacy = makeSpec({
      marketingPlan: "Publish the benchmark.",
      launchPlan: "Pilot with three studios.",
      growthPlan: "Expand into agencies.",
    })
    const section = getPlanSection("marketingPlan")!
    expect(section.read(legacy)).toContain("Publish the benchmark.")
    expect(section.read(legacy)).toContain("Pilot with three studios.")
    expect(section.read(legacy)).toContain("Expand into agencies.")
    expect(getPlanSection("launchPlan")).toBeUndefined()
    expect(getPlanSection("growthPlan")).toBeUndefined()

    // A single legacy part reads as itself, without artificial headings.
    const onlyGrowth = makeSpec({ growthPlan: "Grow through referrals." })
    expect(section.read(onlyGrowth)).toBe("Grow through referrals.")
  })

  it("writes combined marketing updates to one field and retires legacy copies", () => {
    const legacy = makeSpec({
      marketingPlan: "Old marketing.",
      launchPlan: "Old launch.",
      growthPlan: "Old growth.",
    })
    const combined = "## Marketing\nNew plan\n\n## Launch\nNew launch\n\n## Growth\nNew growth"
    const next = applySectionUpdate(legacy, "marketingPlan", combined)
    expect(next.marketingPlan).toBe(combined)
    expect(next.launchPlan).toBe("")
    expect(next.growthPlan).toBe("")
    expect(sectionStatus(getPlanSection("marketingPlan")!, next)).toBe("complete")

    const cleared = clearSectionUpdate(next, "marketingPlan")
    expect(cleared.marketingPlan).toBe("")
    expect(cleared.launchPlan).toBe("")
    expect(cleared.growthPlan).toBe("")
    expect(sectionStatus(getPlanSection("marketingPlan")!, cleared)).toBe("missing")
  })

  it("combines legacy value proposition and positioning into the one go-to-market section", () => {
    const legacy = makeSpec({
      valueProposition: "Set up in five minutes, no front desk needed.",
      marketPositioning: "Priced below salon software, simpler than generic calendars.",
      marketingPlan: "Publish the benchmark.",
    })
    const section = getPlanSection("marketingPlan")!
    expect(section.read(legacy)).toContain("Set up in five minutes")
    expect(section.read(legacy)).toContain("Priced below salon software")
    expect(section.read(legacy)).toContain("Publish the benchmark.")
    expect(getPlanSection("valueProposition")).toBeUndefined()
    expect(getPlanSection("marketPositioning")).toBeUndefined()
  })

  it("writes combined go-to-market updates to one field and retires every legacy copy", () => {
    const legacy = makeSpec({
      valueProposition: "Old promise.",
      marketPositioning: "Old position.",
      marketingPlan: "Old marketing.",
      launchPlan: "Old launch.",
      growthPlan: "Old growth.",
    })
    const combined = "## Value Proposition\nNew promise\n\n## Market Positioning\nNew position\n\n## Marketing Plan\nNew plan"
    const next = applySectionUpdate(legacy, "marketingPlan", combined)
    expect(next.marketingPlan).toBe(combined)
    expect(next.valueProposition).toBe("")
    expect(next.marketPositioning).toBe("")
    expect(next.launchPlan).toBe("")
    expect(next.growthPlan).toBe("")
    expect(sectionStatus(getPlanSection("marketingPlan")!, next)).toBe("complete")

    const cleared = clearSectionUpdate(next, "marketingPlan")
    expect(cleared.marketingPlan).toBe("")
    expect(cleared.valueProposition).toBe("")
    expect(cleared.marketPositioning).toBe("")
    expect(sectionStatus(getPlanSection("marketingPlan")!, cleared)).toBe("missing")
  })

  it("exposes the value proposition and positioning parts for downstream surfaces", () => {
    const legacy = makeSpec({
      valueProposition: "Legacy promise.",
      marketPositioning: "Legacy position.",
    })
    expect(readValuePropositionText(legacy)).toBe("Legacy promise.")
    expect(readMarketPositioningText(legacy)).toBe("Legacy position.")

    const combined = makeSpec({
      marketingPlan:
        "## Value Proposition\nA booking page live in five minutes.\n\n## Market Positioning\nSimpler than generic calendars.\n\n## Marketing Plan\nLaunch with three pilot studios.",
    })
    expect(readValuePropositionText(combined)).toBe("A booking page live in five minutes.")
    expect(readMarketPositioningText(combined)).toBe("Simpler than generic calendars.")
  })

  it("validates proposed section values", () => {
    expect(validatePlanSectionValue("vision", "A clear vision").ok).toBe(true)
    expect(validatePlanSectionValue("unknown_section", "x").ok).toBe(false)
    expect(validatePlanSectionValue("vision", "").ok).toBe(false)
    expect(validatePlanSectionValue("vision", 42).ok).toBe(false)
    expect(validatePlanSectionValue("vision", "x".repeat(9000)).ok).toBe(false)
  })

  it("applies section updates immutably", () => {
    const spec = makeSpec({ vision: "Old vision" })
    const next = applySectionUpdate(spec, "vision", "New vision")
    expect(next.vision).toBe("New vision")
    expect(spec.vision).toBe("Old vision")

    const users = applySectionUpdate(spec, "targetUsers", "Restaurants, Cafes")
    expect(users.targetUsers).toEqual(["Restaurants", "Cafes"])
  })

  it("combines legacy brand, visual-system, type, theme and responsive fields into one Design Direction", () => {
    const legacy = makeSpec({
      designDirection: "Quiet dense tables.",
      brandIdentity: "Deep teal with a calm amber accent.",
      appearance: "Dense light theme, dark follows the OS.",
      typography: "Inter for body, Space Grotesk for headings.",
      themePreferences: "Dark-first with a user toggle.",
      responsiveRequirements: "Tables stay usable on phones.",
    })
    const section = getPlanSection("designDirection")!
    for (const part of [
      "Quiet dense tables.",
      "Deep teal with a calm amber accent.",
      "Dense light theme, dark follows the OS.",
      "Inter for body, Space Grotesk for headings.",
      "Dark-first with a user toggle.",
      "Tables stay usable on phones.",
    ]) {
      expect(section.read(legacy)).toContain(part)
    }
    expect(getPlanSection("brandIdentity")).toBeUndefined()
    expect(getPlanSection("appearance")).toBeUndefined()
    expect(getPlanSection("typography")).toBeUndefined()
    expect(getPlanSection("themePreferences")).toBeUndefined()
    expect(getPlanSection("responsive")).toBeUndefined()

    // A single legacy part reads as itself, without artificial headings.
    const onlyBrand = makeSpec({ brandIdentity: "Deep teal." })
    expect(section.read(onlyBrand)).toBe("Deep teal.")
  })

  it("writes combined design updates to one field and retires legacy copies", () => {
    const legacy = makeSpec({
      designDirection: "Old direction.",
      brandIdentity: "Old brand.",
      appearance: "Old visual system.",
      typography: "Old type.",
      themePreferences: "Old theme.",
      responsiveRequirements: "Old responsive.",
    })
    const combined = "## Brand Identity\nNew brand\n\n## Typography\nNew type"
    const next = applySectionUpdate(legacy, "designDirection", combined)
    expect(next.designDirection).toBe(combined)
    expect(next.brandIdentity).toBe("")
    expect(next.appearance).toBe("")
    expect(next.typography).toBe("")
    expect(next.themePreferences).toBe("")
    expect(next.responsiveRequirements).toBe("")
    expect(sectionStatus(getPlanSection("designDirection")!, next)).toBe("complete")

    const cleared = clearSectionUpdate(next, "designDirection")
    expect(cleared.designDirection).toBe("")
    expect(sectionStatus(getPlanSection("designDirection")!, cleared)).toBe("missing")
  })

  it("persists pricing into the field its section reads", () => {
    // Pricing & Tiers is backed by pricingStructure (the field the build reads).
    const pricing = applySectionUpdate(makeSpec(), "pricingTiers", "Free · Pro $29/mo · Enterprise custom")
    expect(pricing.pricingStructure).toBe("Free · Pro $29/mo · Enterprise custom")
    expect(sectionStatus(getPlanSection("pricingTiers")!, pricing)).toBe("complete")

    const filled = makeSpec({ pricingStructure: "Pro $29/mo" })
    expect(clearSectionUpdate(filled, "pricingTiers").pricingStructure).toBe("")
    expect(sectionStatus(getPlanSection("pricingTiers")!, clearSectionUpdate(filled, "pricingTiers"))).toBe("missing")
  })

  it("writes manual feature, flow and data edits into their structured catalogs", () => {
    const spec = makeSpec({
      suggestedFeatures: [{ key: "auth", label: "Auth", description: "Sign in", enabled: true }],
      coreFlows: [{ name: "Onboarding", description: "First run" }],
      dataEntities: [{ name: "User", description: "Account", fields: ["email"] }],
    })

    const features = applySectionUpdate(spec, "features", "Auth, Billing", { mode: "manual" })
    expect(getPlanSection("features")!.read(features)).toBe("Auth, Billing")
    expect(features.suggestedFeatures.find((f) => f.label === "Auth")?.description).toBe("Sign in")
    expect(features.suggestedFeatures.find((f) => f.label === "Billing")?.key).toBe("billing")

    // Removing a feature disables it instead of discarding its description.
    const trimmed = applySectionUpdate(features, "features", "Billing", { mode: "manual" })
    expect(trimmed.suggestedFeatures.find((f) => f.label === "Auth")?.enabled).toBe(false)
    expect(getPlanSection("features")!.read(trimmed)).toBe("Billing")

    const flows = applySectionUpdate(spec, "flows", "Onboarding, Checkout", { mode: "manual" })
    expect(getPlanSection("flows")!.read(flows)).toBe("Onboarding, Checkout")
    expect(flows.coreFlows.find((f) => f.name === "Onboarding")?.description).toBe("First run")

    const data = applySectionUpdate(spec, "data", "User, Invoice", { mode: "manual" })
    expect(getPlanSection("data")!.read(data)).toBe("User, Invoice")
    expect(data.dataEntities.find((e) => e.name === "User")?.fields).toEqual(["email"])
  })

  it("keeps AI proposals for list sections as build instructions", () => {
    const spec = makeSpec({
      suggestedFeatures: [{ key: "auth", label: "Auth", description: undefined, enabled: true }],
    })
    const next = applySectionUpdate(spec, "features", "### Audit log\n\n**User Story**: track changes", {
      mode: "proposal",
    })
    expect(next.suggestedFeatures).toEqual(spec.suggestedFeatures)
    expect(next.additionalInstructions).toContain("Key features: ### Audit log")
  })
})

describe("chat proposal parsing", () => {
  it("extracts a valid <plan-update> block and strips it from the reply", () => {
    const reply = 'Here is my take.\n\n<plan-update>{"section":"vision","proposedValue":"New vision text","reason":"Sharper focus"}</plan-update>'
    const { cleanReply, proposal } = parseChatProposal(reply)
    expect(cleanReply).toBe("Here is my take.")
    expect(proposal).toEqual({ section: "vision", proposedValue: "New vision text", reason: "Sharper focus" })
  })

  it("returns null for replies without a proposal block", () => {
    const { cleanReply, proposal } = parseChatProposal("Just a normal answer.")
    expect(proposal).toBeNull()
    expect(cleanReply).toBe("Just a normal answer.")
  })

  it("rejects proposals for unknown sections and malformed JSON", () => {
    const bad = '<plan-update>{"section":"not_a_section","proposedValue":"x"}</plan-update>'
    expect(parseChatProposal(bad).proposal).toBeNull()
    const broken = "<plan-update>{not json}</plan-update>"
    expect(parseChatProposal(broken).proposal).toBeNull()
  })

  it("hides an unterminated proposal block when the reply is cut off", () => {
    const cut = 'My take on your design direction:\n\n<plan-update>{"section":"designDirection","proposedValue":"Bold, calm'
    const { cleanReply, proposal } = parseChatProposal(cut)
    expect(cleanReply).toBe("My take on your design direction:")
    expect(proposal?.proposedValue).toBe("Bold, calm")
  })

  it("keeps a truncated proposal so the founder still gets a card to add", () => {
    // Exactly what the provider sends when a long draft hits the token limit.
    const cut =
      "Here is the features section.\n\n<plan-update> {\"section\": \"features\", \"proposedValue\": \"### Issue Tracking\\n\\n**User Story**: create issues\\n\\n### Projects "
    const { cleanReply, proposal } = parseChatProposal(cut)
    expect(cleanReply).toBe("Here is the features section.")
    expect(cleanReply).not.toContain("plan-update")
    expect(proposal?.section).toBe("features")
    expect(proposal?.proposedValue.startsWith("### Issue Tracking")).toBe(true)
    expect(proposal?.proposedValue).toContain("\n\n**User Story**")
    expect(proposal?.reason).toBe("Drafted by the co-founder.")
  })

  it("drops a truncated block that names no usable section", () => {
    const cut = 'Answer.\n\n<plan-update>{"section":"not_a_section","proposedValue":"whatever'
    const { cleanReply, proposal } = parseChatProposal(cut)
    expect(cleanReply).toBe("Answer.")
    expect(proposal).toBeNull()
  })

  it("decodes escaped characters in a truncated draft", () => {
    const cut = 'x\n\n<plan-update>{"section":"vision","proposedValue":"line one\\n\\u003ctab\\u003e trailing'
    expect(parseChatProposal(cut).proposal?.proposedValue).toBe("line one\n<tab> trailing")
  })

  it("keeps prose that follows a completed proposal block", () => {
    const reply = 'Before.\n<plan-update>{"section":"vision","proposedValue":"V","reason":"R"}</plan-update>\nAfter.'
    const { cleanReply } = parseChatProposal(reply)
    expect(cleanReply).toBe("Before.\n\nAfter.")
  })

  it("stamps the real current value when building a proposal", () => {
    const spec = makeSpec({ vision: "Existing vision" })
    const p = buildProposal(spec, { section: "vision", proposedValue: "Better", reason: "Why" }, "chat")
    // The vision section is one combined foundation block, so its current
    // value is the composed text — still read from the spec, never the AI.
    expect(p.currentValue).toContain("Existing vision")
    expect(p.proposedValue).toBe("Better")
    expect(p.source).toBe("chat")
    expect(p.id.length).toBeGreaterThan(0)
  })
})

describe("analysis response parsing", () => {
  const validAnalysis = JSON.stringify({
    summary: "The plan has gaps.",
    findings: [
      { section: "revenueModel", severity: "gap", title: "No revenue model", currentState: "(not defined yet)", why: "Money matters", recommendation: "Define pricing" },
      { section: "made_up_section", severity: "gap", title: "Should be dropped" },
      { section: "vision", severity: "nope", title: "Bad severity, dropped" },
    ],
    proposals: [
      { section: "revenueModel", proposedValue: "Subscription at $10/mo", reason: "Simple entry" },
      { section: "bogus", proposedValue: "Dropped" },
    ],
    nextBestAction: { section: "revenueModel", title: "Define revenue", why: "First" },
  })

  it("keeps valid findings/proposals and drops ones referencing unknown sections", () => {
    const spec = makeSpec()
    const analysis = parseAnalysisResponse(validAnalysis, spec)
    expect(analysis).not.toBeNull()
    expect(analysis!.findings).toHaveLength(1)
    expect(analysis!.findings[0].section).toBe("revenueModel")
    expect(analysis!.proposals).toHaveLength(1)
    expect(analysis!.nextBestAction?.title).toBe("Define revenue")
    expect(analysis!.healthPercent).toBe(computePlanHealth(spec).percent)
  })

  it("tolerates markdown fences around the JSON", () => {
    const wrapped = "```json\n" + validAnalysis + "\n```"
    expect(parseAnalysisResponse(wrapped, makeSpec())).not.toBeNull()
  })

  it("ignores commentary the model appends after the object", () => {
    const noisy = validAnalysis + '\n\nLet me know if you want more detail. {"note":"extra"}'
    const analysis = parseAnalysisResponse(noisy, makeSpec())
    expect(analysis).not.toBeNull()
    expect(analysis!.findings).toHaveLength(1)
  })

  it("skips a JSON example the model echoed in its reasoning", () => {
    const text =
      'I will return { "summary": "...", "findings": [] } as requested.\n\n' + validAnalysis
    const analysis = parseAnalysisResponse(text, makeSpec())
    expect(analysis).not.toBeNull()
    expect(analysis!.summary).toBe("The plan has gaps.")
    expect(analysis!.findings).toHaveLength(1)
  })

  it("recovers a reply cut off by the output limit", () => {
    const truncated =
      '{"summary":"The plan needs work.","findings":[{"section":"revenueModel","severity":"gap","title":"No revenue model","currentState":"(not defined yet)","why":"Money matters","recommendation":"Define pricing"},{"section":"vision","severity":"weakness","title":"Vision is va'
    const analysis = parseAnalysisResponse(truncated, makeSpec())
    expect(analysis).not.toBeNull()
    expect(analysis!.summary).toContain("The plan needs work.")
    expect(analysis!.summary).toContain("cut off at the model's output limit")
    // The complete finding survives; the half-written tail is kept for review
    // (same rule as partial chat proposals) with a visible truncation notice.
    expect(analysis!.findings).toHaveLength(2)
    expect(analysis!.findings[0].section).toBe("revenueModel")
    expect(analysis!.findings[0].title).toBe("No revenue model")
  })

  it("recovers JSON with raw newlines inside string values", () => {
    const multiline =
      '{"summary":"Line one.\nLine two.","findings":[{"section":"vision","severity":"gap","title":"No vision",\n"currentState":"(not defined yet)","why":"Direction matters","recommendation":"Write it"}],"proposals":[]}'
    const analysis = parseAnalysisResponse(multiline, makeSpec())
    expect(analysis).not.toBeNull()
    expect(analysis!.summary).toBe("Line one.\nLine two.")
    expect(analysis!.findings).toHaveLength(1)
  })

  it("recovers JSON with trailing commas", () => {
    const sloppy =
      '{"summary":"Fine.","findings":[{"section":"revenueModel","severity":"gap","title":"T","currentState":"C","why":"W","recommendation":"R"},],"proposals":[],}'
    const analysis = parseAnalysisResponse(sloppy, makeSpec())
    expect(analysis).not.toBeNull()
    expect(analysis!.findings).toHaveLength(1)
  })

  it("recovers a multiline proposal cut off by the output limit", () => {
    const text = `{"summary":"Solid start.","findings":[{"section":"vision","severity":"gap","title":"No vision","currentState":"(not defined yet)","why":"Direction matters","recommendation":"Write it"}],"proposals":[{"section":"marketingPlan","proposedValue":"## Positioning
Local barbershops that book online.

## Channels
1. Instagram
2. Neighbourhood flyers
3. Referrals

## Launch
Start with ten shops, measure bookings, then expand.","reason":"The current plan is a single sentence`
    const analysis = parseAnalysisResponse(text, makeSpec())
    expect(analysis).not.toBeNull()
    expect(analysis!.summary).toContain("Solid start.")
    expect(analysis!.findings).toHaveLength(1)
    // The proposal began but never finished — it is salvaged for review, and
    // the summary says the reply was cut off.
    expect(analysis!.proposals).toHaveLength(1)
    expect(analysis!.proposals[0].proposedValue).toContain("## Positioning")
    expect(analysis!.summary).toContain("cut off at the model's output limit")
  })

  it("shows the review as a summary when the model answered in prose", () => {
    const prose = "Your plan is solid in places but thin on pricing and success metrics. ".repeat(6)
    const analysis = parseAnalysisResponse(prose, makeSpec())
    expect(analysis).not.toBeNull()
    expect(analysis!.summary).toContain("thin on pricing and success metrics")
    expect(analysis!.findings).toHaveLength(0)
  })

  it("returns null for unparseable output", () => {
    expect(parseAnalysisResponse("The model rambled instead of answering.", makeSpec())).toBeNull()
  })
})

describe("section length cap", () => {
  const longDraft = ("pricing tier description. ".repeat(600)).trim()

  it("trims an over-long value down to what the plan accepts", () => {
    const clamped = clampPlanSectionValue(longDraft)
    expect(clamped.length).toBeLessThanOrEqual(MAX_PLAN_SECTION_LENGTH)
    expect(clamped).toBe(longDraft.slice(0, clamped.length))
    expect(validatePlanSectionValue("pricingTiers", clamped).ok).toBe(true)
  })

  it("leaves ordinary section text untouched", () => {
    expect(clampPlanSectionValue("  a short answer  ")).toBe("a short answer")
  })

  it("never offers a proposal the accept PATCH would reject for length", () => {
    const reply = `Here you go.\n\n<plan-update>${JSON.stringify({
      section: "pricingTiers",
      proposedValue: longDraft,
      reason: "Sharper tiers",
    })}</plan-update>`
    const { proposal } = parseChatProposal(reply)
    expect(proposal).not.toBeNull()
    const stored = buildProposal(makeSpec(), proposal!, "chat")
    expect(validatePlanSectionValue(stored.section, stored.proposedValue).ok).toBe(true)
  })
})
