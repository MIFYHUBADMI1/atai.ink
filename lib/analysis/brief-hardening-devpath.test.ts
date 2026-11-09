import { describe, expect, it } from "vitest"
import { buildInitialBuildPrompt } from "./prompt-builder"
import type { ApplicationSpecification } from "@/lib/types/specification"

/**
 * DevPath-style regression fixture: one realistic founder plan that contains
 * every hazard the root-cause audit confirmed — a named external gateway, a
 * promise the runtime cannot keep, undecided placeholder content, an admin
 * console the model tends to forget, and the founder's own words that used to
 * die before the brief. Guards that ALL the fix #1–#6 protections land
 * together on a single real-shaped plan, not just in isolation.
 */
const FOUNDER_IDEA =
  "An online academy where independent instructors sell video courses. Buyers check out with Stripe and get refunds within 14 days."

const DEV_PATH_SPEC: ApplicationSpecification = {
  applicationType: "marketplace",
  title: "Course Academy",
  description: "A marketplace where instructors sell video courses to learners.",
  purpose: "Let anyone earn from what they know.",
  vision: "Become the default storefront for independent course creators.",
  businessModel: "Commission on each course sale.",
  revenueModel: "Two tiers plus per-sale commission.",
  pricingTiers:
    "Free — 1 course, 10% commission.\nPro — 29 EUR/month, unlimited courses, 5% commission. Checkout with Stripe.",
  pricingStructure: "Not defined yet: does annual billing get a discount?",
  runtimeIntegrations:
    "Automatic refunds within 14 days of purchase. Email receipts after every sale.",
  marketingPlan:
    "Position as the simplest storefront for creators; launch via creator newsletters and Product Hunt.",
  designDirection: "Warm, editorial look with generous whitespace; default light theme.",
  targetUsers: ["Independent instructors", "Self-paced learners"],
  userRoles: ["Learner", "Instructor", "Administrator"],
  coreFlows: [
    { name: "Browse and buy", description: "Learner pays with Stripe and gets instant access." },
    { name: "Publish a course", description: "Instructor uploads lessons and sets a price." },
  ],
  suggestedFeatures: [
    { key: "auth", label: "Authentication", description: "Sign in for learners and instructors", enabled: true },
    { key: "database", label: "Database", description: "Store courses and enrollments", enabled: true },
    { key: "payments", label: "Payments", description: "Checkout and billing", enabled: true },
    { key: "admin", label: "Admin panel", description: "Owner console", enabled: true },
  ],
  dataEntities: [
    { name: "Course", fields: ["title", "price"], description: "A sellable curriculum." },
    { name: "Enrollment", fields: ["buyer", "course"], description: "A purchased seat." },
  ],
  authenticationRequirements: "Email and password plus Google sign-in.",
  backendRequirements: ["Enrollment records survive payment webhooks."],
  integrations: [],
  additionalInstructions: "Keep onboarding under three steps.",
  complexity: "complex",
}

describe("hardened build brief — DevPath regression (fixes #1–#6 together)", () => {
  const prompt = buildInitialBuildPrompt(DEV_PATH_SPEC, undefined, undefined, FOUNDER_IDEA)

  it("carries the founder's original words as authoritative intent", () => {
    expect(prompt).toContain("THE FOUNDER'S ORIGINAL WORDS (AUTHORITATIVE INTENT)")
    expect(prompt).toContain("<founder_idea>")
    expect(prompt).toContain(FOUNDER_IDEA)
    // …before the stack rules, so everything downstream reads the intent first.
    expect(prompt.indexOf("<founder_idea>")).toBeLessThan(prompt.indexOf("REQUIRED TECH STACK"))
  })

  it("mandates the admin console as headline product, tailored to this plan", () => {
    expect(prompt).toContain("ADMIN & OWNER CONSOLE (MANDATORY — FIRST-CLASS SECTION)")
    expect(prompt.indexOf("ADMIN & OWNER CONSOLE")).toBeLessThan(
      prompt.indexOf("ATAI RUNTIME — CORE INFRASTRUCTURE"),
    )
    expect(prompt).toContain("ADMIN_EMAIL")
    expect(prompt).toContain("setup screen")
    // Tailored to the plan's own roles, records and money.
    expect(prompt).toContain("Administrator")
    expect(prompt).toContain("Enrollment")
    expect(prompt).toContain("Sales and money")
    expect(prompt).toContain("The build is NOT complete until the owner can sign in at /admin")
  })

  it("resolves the Stripe collision to one authority, keeping both texts visible", () => {
    expect(prompt).toContain("PAYMENTS ARE RUNTIME-ONLY")
    expect(prompt).toContain("CONTRADICTIONS RESOLVED — ONE AUTHORITY EACH")
    // Every Stripe mention in the plan is covered, none deleted.
    expect(prompt).toContain("Checkout with Stripe.")
    expect(prompt).toContain("Learner pays with Stripe and gets instant access.")
    expect(prompt).toContain("Move this money flow through atai.payments")
    // One authority: the resolution defers to the mandate above it.
    expect(prompt.indexOf("ATAI RUNTIME — CORE INFRASTRUCTURE")).toBeLessThan(
      prompt.indexOf("CONTRADICTIONS RESOLVED"),
    )
  })

  it("reclassifies the refund promise with the capability reality check", () => {
    expect(prompt).toContain("CAPABILITY REALITY CHECK")
    expect(prompt).toContain("Automatic refunds within 14 days of purchase.")
    expect(prompt).toContain("never invent an SDK refund call")
  })

  it("turns undecided plan content into open questions, not requirements", () => {
    expect(prompt).toContain("OPEN QUESTIONS — UNANSWERED, NOT REQUIREMENTS")
    expect(prompt).toContain("Not defined yet: does annual billing get a discount?")
    // Decided pricing still reads as mandatory; only the placeholder section is reclassified.
    expect(prompt).toContain("Pricing plans this product must present and enforce")
  })

  it("keeps the whole plan in the brief — nothing summarised or dropped", () => {
    for (const needle of [
      "Become the default storefront for independent course creators.",
      "Position as the simplest storefront for creators",
      "Warm, editorial look with generous whitespace",
      "Keep onboarding under three steps.",
      "Enrollment records survive payment webhooks.",
      "Email and password plus Google sign-in.",
    ]) {
      expect(prompt).toContain(needle)
    }
  })
})
