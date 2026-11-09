import { describe, it, expect } from "vitest"
import {
  buildCollaborateContext,
  buildPlanBrief,
  buildSectionFocusBlock,
  parseDraftResponse,
} from "@/lib/analysis/cofounder"
import { PLAN_SECTIONS, clearSectionUpdate, isPlaceholderValue, relatedSections } from "@/lib/analysis/plan-sections"
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

describe("buildPlanBrief (deterministic compact context)", () => {
  it("renders one line per plan section, in order", () => {
    const brief = buildPlanBrief(makeSpec())
    const lines = brief.split("\n")
    expect(lines).toHaveLength(PLAN_SECTIONS.length)
    PLAN_SECTIONS.forEach((def, i) => {
      expect(lines[i]).toContain(def.label)
    })
  })

  it("marks missing sections as (not defined) and keeps populated values", () => {
    const spec = makeSpec({ vision: "Become the default tool for indie founders." })
    const brief = buildPlanBrief(spec)
    // The foundation is one combined section, so the vision ships with the
    // rest of the foundation rather than under its own legacy label.
    expect(brief).toContain("Become the default tool for indie founders.")
    expect(brief).toContain("(not defined)")
  })

  it("treats generator placeholders as not defined", () => {
    const spec = makeSpec({
      vision: "Not defined yet: who pays?",
      description: "Not defined yet: what is it?",
      purpose: "Not defined yet: why does it exist?",
    })
    expect(isPlaceholderValue("Not defined yet: who pays?")).toBe(true)
    const brief = buildPlanBrief(spec)
    const line = brief.split("\n").find((l) => l.includes("Vision, Purpose, Problem & Solution"))!
    expect(line.endsWith("(not defined)")).toBe(true)
  })

  it("previews long values with an ellipsis instead of shipping them whole", () => {
    const long = "x".repeat(400)
    const brief = buildPlanBrief(makeSpec({ vision: long }))
    const line = brief.split("\n").find((l) => l.includes("Vision, Purpose, Problem & Solution"))!
    expect(line.length).toBeLessThan(200)
    expect(line.endsWith("…")).toBe(true)
  })

  it("reflects accepted changes immediately (never stale)", () => {
    const before = buildPlanBrief(makeSpec())
    expect(before).toContain("- Target Customers: (not defined)")
    const after = buildPlanBrief(
      makeSpec({ vision: "Become the plan-first workspace founders keep open." }),
    )
    expect(after).toContain("plan-first workspace")
  })

  it("never throws on a bare-minimum spec", () => {
    const brief = buildPlanBrief(makeSpec())
    expect(brief.split("\n")).toHaveLength(PLAN_SECTIONS.length)
  })
})

describe("buildSectionFocusBlock", () => {
  it("ships the full untruncated value for the focus section", () => {
    const long = "y".repeat(500)
    const spec = makeSpec({ vision: long })
    const block = buildSectionFocusBlock("vision", spec)
    expect(block).toContain(long)
  })

  it("labels undefined focus sections as not defined yet", () => {
    const spec = makeSpec({ description: "", purpose: "" })
    const block = buildSectionFocusBlock("vision", spec)
    expect(block).toContain("FOCUS SECTION: Vision")
    expect(block).toContain("(not defined yet)")
  })

  it("lists related sections from the dependency map", () => {
    const block = buildSectionFocusBlock("targetUsers", makeSpec({ targetUsers: ["Independent restaurants"] }))
    expect(block).toContain("Sections commonly affected")
    expect(block).toContain("Value Proposition")
  })

  it("returns an empty string for an unknown section", () => {
    expect(buildSectionFocusBlock("not-a-section", makeSpec())).toBe("")
  })

  it("ships the full content of related sections, not just their names", () => {
    const spec = makeSpec({
      pricingStructure: "Free, Pro at $19/mo, Team at $49/mo — monthly and annual.",
      revenueModel: "Recurring subscription revenue with an annual discount.",
      businessModel: "Self-serve B2B subscription.",
    })
    const block = buildSectionFocusBlock("pricingTiers", spec)
    expect(block).toContain("RELATED SECTIONS")
    expect(block).toContain("Recurring subscription revenue with an annual discount.")
    expect(block).toContain("Self-serve B2B subscription.")
    expect(block).toContain("Never contradict")
  })

  it("omits the related block when nothing in the cluster is defined", () => {
    const block = buildSectionFocusBlock("pricingTiers", makeSpec({ pricingStructure: "Tiers TBD" }))
    expect(block).not.toContain("RELATED SECTIONS")
    expect(block).toContain("Sections commonly affected by this one (still undefined")
  })

  it("never echoes the focus section's own value as a related section", () => {
    const spec = makeSpec({
      pricingStructure: "PRO-PRICING-MARKER",
      revenueModel: "REVENUE-MARKER",
    })
    const block = buildSectionFocusBlock("pricingTiers", spec)
    expect(block.split("PRO-PRICING-MARKER").length - 1).toBe(1)
    expect(block).toContain("REVENUE-MARKER")
  })

  it("caps a very long related section instead of crowding out the cluster", () => {
    const spec = makeSpec({
      pricingStructure: "focus value",
      businessModel: `HEAD-MARKER ${"a".repeat(3000)} TAIL-MARKER`,
    })
    const block = buildSectionFocusBlock("pricingTiers", spec)
    expect(block).toContain("HEAD-MARKER")
    expect(block).not.toContain("TAIL-MARKER")
    expect(block.length).toBeLessThan(6000)
  })

  it("grounds the SEO & Search section in the rest of the plan via related sections", () => {
    const spec = makeSpec({
      targetUsers: ["Independent barbershops"],
      valueProposition: "Booking page live in five minutes.",
      marketPositioning: "Simpler and cheaper than salon software.",
    })
    const block = buildSectionFocusBlock("seo", spec)
    expect(block).toContain("FOCUS SECTION: SEO & Search")
    // The related-section hints are what make the draft derive keywords and
    // audience from the plan instead of generic SEO advice.
    expect(block).toContain("Target Customers")
    expect(block).toContain("Value Proposition")
    expect(block).toContain("Market Positioning")
  })
})

describe("relatedSections (clusters ship whole)", () => {
  const MONEY = ["pricingTiers", "pricingTiersDetail", "revenueModel", "businessModel"]

  it("never shows a partial money story, from any member of the cluster", () => {
    for (const id of [...MONEY, "targetUsers", "features", "runtimeIntegrations"]) {
      const related = relatedSections(id).map((d) => d.id)
      for (const member of MONEY) {
        if (member === id) continue
        expect(related, `${id} should pull in ${member}`).toContain(member)
      }
    }
  })

  it("never includes the section itself and only returns real sections", () => {
    for (const def of PLAN_SECTIONS) {
      const related = relatedSections(def.id)
      expect(related.some((r) => r.id === def.id)).toBe(false)
      expect(related.every((r) => PLAN_SECTIONS.includes(r))).toBe(true)
    }
  })

  it("names the cluster the section belongs to", () => {
    const block = buildSectionFocusBlock("revenueModel", makeSpec({ revenueModel: "Subscription MRR." }))
    expect(block).toContain("Money & offer cluster")
  })
})

describe("pricing consistency detection (code, not opinion)", () => {
  const specWith = (structure: string, detail: string) =>
    makeSpec({ pricingStructure: structure, pricingTiers: detail })

  it("flags the same tier priced differently in the two pricing sections", () => {
    const block = buildSectionFocusBlock(
      "businessModel",
      specWith("Free (1 chair), Pro $19/mo, Team $49/mo", "Free / Pro $25 / Team $60"),
    )
    expect(block).toContain("PRICING CONFLICT DETECTED")
    expect(block).toContain("pro tier costs $19 in Pricing Structure but $25 in Pricing Tiers")
    expect(block).toContain("team tier costs $49 in Pricing Structure but $60 in Pricing Tiers")
    expect(block).toContain("propose the reconciliation for BOTH pricing sections")
  })

  it("stays quiet when the two sections agree", () => {
    const block = buildSectionFocusBlock(
      "pricingTiers",
      specWith("Pro $19/mo, Team $49/mo", "Pro $19 per month; Team $49 per month"),
    )
    expect(block).not.toContain("PRICING CONFLICT DETECTED")
    expect(block).toContain("currently agree")
  })

  it("normalises annual figures to a monthly comparison", () => {
    const block = buildSectionFocusBlock("pricingTiers", specWith("Pro $19/mo", "Pro $228/year"))
    expect(block).not.toContain("PRICING CONFLICT DETECTED")
  })

  it("ignores numbers that are not prices", () => {
    const block = buildSectionFocusBlock(
      "pricingTiers",
      specWith("Pro $19/mo, 10 seats included", "Pro $19/mo, 25% referral discount"),
    )
    expect(block).not.toContain("PRICING CONFLICT DETECTED")
  })

  it("declares which pricing field the build consumes, and never fires with no pricing content", () => {
    const block = buildSectionFocusBlock("pricingTiers", specWith("Pro $19/mo", ""))
    expect(block).toContain("PRICING AUTHORITY")
    expect(block).toContain('section id "pricingTiers"')
    expect(buildSectionFocusBlock("seo", makeSpec())).not.toContain("PRICING AUTHORITY")
  })
})

describe("parseDraftResponse", () => {
  it("parses a clean JSON object", () => {
    expect(parseDraftResponse('{"value": "Drafted vision."}')).toEqual({ value: "Drafted vision." })
  })

  it("parses JSON wrapped in markdown fences", () => {
    expect(parseDraftResponse('```json\n{"value": "Fenced draft."}\n```')).toEqual({
      value: "Fenced draft.",
    })
  })

  it("extracts a JSON object embedded in surrounding prose", () => {
    expect(parseDraftResponse('Sure! {"value": "Embedded."} Hope it helps.')).toEqual({
      value: "Embedded.",
    })
  })

  it("tolerates a bare-text reply without JSON", () => {
    expect(parseDraftResponse("A perfectly serviceable draft paragraph.")).toEqual({
      value: "A perfectly serviceable draft paragraph.",
    })
  })

  it("recovers the text of a draft the provider ran out of tokens on", () => {
    const cut = '{"value": "### Onboarding\\n\\n1. Connect the site\\n2. Pick the pages to keep'
    expect(parseDraftResponse(cut)).toEqual({
      value: "### Onboarding\n\n1. Connect the site\n2. Pick the pages to keep",
    })
  })

  it("returns null for empty, empty-value, or malformed responses", () => {
    expect(parseDraftResponse("")).toBeNull()
    expect(parseDraftResponse('{"value": ""}')).toBeNull()
    expect(parseDraftResponse('{"value": 42}')).toBeNull()
    expect(parseDraftResponse("{}")).toBeNull()
    expect(parseDraftResponse("<system-error>blocked</system-error>")).toBeNull()
  })
})

describe("clearSectionUpdate (undo path)", () => {
  it("resets a business section to empty and leaves others untouched", () => {
    const spec = makeSpec({ vision: "A vision.", growthPlan: "A plan." })
    const cleared = clearSectionUpdate(spec, "vision")
    expect(cleared.vision).toBe("")
    expect(cleared.growthPlan).toBe("A plan.")
    expect(spec.vision).toBe("A vision.") // original untouched
  })

  it("resets targetUsers to an empty list", () => {
    const spec = makeSpec({ targetUsers: ["Restaurants"] })
    const cleared = clearSectionUpdate(spec, "targetUsers")
    expect(cleared.targetUsers).toEqual([])
  })

  it("maps overview to description and never throws on unknown ids", () => {
    const spec = makeSpec({ description: "Desc." })
    expect(clearSectionUpdate(spec, "overview").description).toBe("")
    expect(clearSectionUpdate(spec, "features")).toBe(spec)
  })
})

describe("buildCollaborateContext focus", () => {
  it("puts the selected section last so chat history cannot steal the topic", () => {
    const ctx = buildCollaborateContext({
      spec: makeSpec({
        runtimeIntegrations: "AI assistant and checkout via Atai.",
        targetUsers: ["Independent clinics"],
      }),
      decisions: [],
      conversation: [
        { id: "1", role: "user", content: "Who is this for?", at: 1 },
        { id: "2", role: "assistant", content: "Independent clinics.", at: 2 },
      ],
      activeSection: "runtimeIntegrations",
    })
    expect(ctx).toContain("CURRENT TASK:")
    expect(ctx).toContain("Runtime & Integrations")
    expect(ctx).toContain("runtimeIntegrations")
    expect(ctx.indexOf("CURRENT TASK:")).toBeGreaterThan(ctx.indexOf("RECENT COLLABORATION"))
    expect(ctx.indexOf("CURRENT TASK:")).toBeGreaterThan(ctx.indexOf("Independent clinics"))
  })
})
