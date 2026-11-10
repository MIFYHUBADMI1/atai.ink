import { describe, expect, it } from "vitest"
import {
  COMPETITION_PROMPT_BUDGET,
  COMPETITION_SNAPSHOT_ASK,
  COMPETITION_SNAPSHOT_SYSTEM,
  PLAN_OMITTED_MARKER,
  buildCompetitionSnapshotMessages,
  clipPlanForPrompt,
} from "./competition-snapshot-context"

/** A realistic combined marketing plan: ~650 words with markdown headings. */
const LONG_PLAN = [
  "## Value proposition",
  "",
  "Ledgerly gives independent bookkeepers a client portal that automates monthly",
  "reconciliation, document collection, and deadline reminders without replacing",
  "their existing accounting software. Bookkeepers keep their tools; Ledgerly",
  "removes the status-chasing work between them and their clients.",
  "",
  "Every reconciliation request, missing receipt, and sign-off lives in one",
  "branded portal instead of a tangle of email threads and spreadsheet",
  "attachments. Firms that adopt it report fewer late month-ends within the",
  "first two cycles, and the portal doubles as a professional surface clients",
  "actually enjoy logging into — which makes the bookkeeper look bigger and",
  "more established than a solo practice usually appears.",
  "",
  "## Market positioning",
  "",
  "Ledgerly is positioned as the coordination layer between bookkeepers and the",
  "accounting platforms they already use, not as another ledger. Unlike client",
  "portals bundled into accounting suites, Ledgerly works across QuickBooks,",
  "Xero, and Sage at once, which matters for bookkeepers with mixed-client",
  "stacks. The promise is calm: fewer chasing emails, fewer missed deadlines,",
  "and a professional portal the bookkeeper can brand as their own.",
  "",
  "The brand voice is plain-spoken and reassuring — a colleague who has done",
  "the job, not a software vendor. Marketing never leads with features; it",
  "leads with the Friday-afternoon feeling of not knowing which clients have",
  "not sent documents yet, and closes with the portal that ends that feeling.",
  "",
  "## Who we serve",
  "",
  "Primary audience: independent bookkeepers with 5 to 30 small-business",
  "clients, typically certified but working alone or with one assistant.",
  "Secondary audience: two-to-five-person accounting firms that handle mixed",
  "stacks across QuickBooks and Xero and lack an operations person to run",
  "chasing. Both audiences already pay for the accounting tools; Ledgerly",
  "sells the hours back that those tools quietly cost them.",
  "",
  "## Marketing",
  "",
  "Primary channel is content: a weekly teardown of real bookkeeping workflows",
  "published as an article and a short video, plus a free deadline-audit tool",
  "that scores a firm's month-end process and emails a two-page report.",
  "Partnerships with bookkeeping associations supply credibility; the launch",
  "plan is a beta cohort of 20 firms recruited from two association forums.",
  "",
  "Search targets long-tail problems first — late documents, chasing emails,",
  "month-end checklists — because the head terms are owned by the accounting",
  "suites. Every article ends with the free audit tool, and every audit report",
  "ends with an invitation to the beta cohort, so the loop from stranger to",
  "beta user never leaves the funnel.",
  "",
  "## Launch",
  "",
  "Launch in waves of 10 firms, onboard each personally, and publish one case",
  "study per wave with before-and-after cycle times. Pricing starts at a",
  "founder rate of 29 dollars per firm per month, grandfathered for life, to",
  "reward early adoption. The beta cohort gets direct input into the deadline",
  "reminder schedule and the document checklist defaults, and each wave ends",
  "with a recorded walkthrough the next wave watches before onboarding, so",
  "support questions shrink while the launch keeps moving.",
  "",
  "## Growth",
  "",
  "Growth comes from the case-study library, association newsletter swaps, and",
  "a referral credit: one free month for both parties when a referred firm",
  "subscribes. The metric that matters is firms completing their first full",
  "month-end cycle inside Ledgerly, because that single event predicts renewal",
  "almost perfectly in early conversations. Quarterly benchmark reports, built",
  "anonymously from the aggregate cycle-time data across all firms on the",
  "platform, become the second durable moat after the deadline engine itself,",
  "and they give the newsletter swaps something genuinely exclusive to offer.",
  "",
  "Retention work concentrates on the second month: the portal should surface",
  "everything a firm needs before they realise they need it — the W-9 requests,",
  "the year-end checklist, the reconciliation sign-offs — so the second month",
  "feels easier than the first, not the opposite. Expansion follows naturally",
  "when firms add the payroll deadline pack in month three.",
].join("\n")

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

describe("competition snapshot prompt assembly", () => {
  const base = {
    projectName: "Ledgerly",
    description: "A client portal for independent bookkeepers.",
    idea: "Stop chasing clients for receipts.",
    marketingPlan: LONG_PLAN,
    targetUsers: ["Independent bookkeepers", "Small accounting firms"],
    siteUrl: "https://ledgerly.example",
    goals: { businessGoal: "50 paying firms", revenueTarget: "$1.5k MRR" },
  }

  it("uses a competition-dedicated system prompt with no studio brief template", () => {
    const { system, prompt } = buildCompetitionSnapshotMessages(base)
    expect(system).toBe(COMPETITION_SNAPSHOT_SYSTEM)
    // The generic studio "brief" template must not leak into either message.
    expect(system).not.toContain("marketing strategy brief")
    expect(prompt).not.toContain("marketing strategy brief")
    expect(prompt).not.toContain("Write a concise marketing strategy brief")
    expect(prompt).not.toContain("Put anything not supplied under Assumptions")
  })

  it("requires the eight competitive-intelligence sections", () => {
    const { prompt } = buildCompetitionSnapshotMessages(base)
    for (const section of [
      "Positioning",
      "Who it serves",
      "Value proposition",
      "Likely competitor categories",
      "Competitor references",
      "Differentiation opportunities",
      "What the plan does not establish",
      "Questions to investigate next",
    ]) {
      expect(prompt).toContain(section)
    }
  })

  it("preserves a 600+ word plan end to end — tail, headings, and URL survive", () => {
    expect(wordCount(LONG_PLAN)).toBeGreaterThanOrEqual(600)
    const { prompt } = buildCompetitionSnapshotMessages(base)

    // The very end of the plan is present (no silent tail truncation).
    expect(prompt).toContain("firms completing their first full")
    expect(prompt).toContain("the payroll deadline pack in month three.")
    // Headings survive as markdown, not flattened into one line.
    expect(prompt).toContain("## Market positioning")
    expect(prompt).toContain("## Growth")
    // Fixed facts and the live URL are retained.
    expect(prompt).toContain("App: Ledgerly")
    expect(prompt).toContain("Live URL: https://ledgerly.example")
    expect(prompt).toContain("Independent bookkeepers")
    // The assembled prompt stays inside the declared budget.
    expect(prompt.length + COMPETITION_SNAPSHOT_SYSTEM.length).toBeLessThanOrEqual(COMPETITION_PROMPT_BUDGET)
  })

  it("discloses omissions instead of silently cutting an oversized plan", () => {
    const hugePlan = `${LONG_PLAN}\n\n${"Additional market detail. ".repeat(1500)}`
    const { prompt } = buildCompetitionSnapshotMessages({ ...base, marketingPlan: hugePlan })

    expect(prompt).toContain(PLAN_OMITTED_MARKER)
    // The disclosure explains the text was NOT received, not ignored.
    expect(PLAN_OMITTED_MARKER).toContain("omitted from the prompt")
    // The beginning of the plan still made it in.
    expect(prompt).toContain("## Value proposition")
    expect(prompt.length + COMPETITION_SNAPSHOT_SYSTEM.length).toBeLessThanOrEqual(COMPETITION_PROMPT_BUDGET)
  })

  it("keeps the plan meaningful when fixed facts are large (plan floor holds)", () => {
    const { prompt } = buildCompetitionSnapshotMessages({
      ...base,
      description: "D".repeat(600),
      idea: "I".repeat(800),
    })
    expect(prompt).toContain("## Market positioning")
    expect(prompt).toContain("firms completing their first full")
    expect(prompt.length + COMPETITION_SNAPSHOT_SYSTEM.length).toBeLessThanOrEqual(COMPETITION_PROMPT_BUDGET)
  })

  it("states absence honestly when there is no plan yet", () => {
    const { prompt } = buildCompetitionSnapshotMessages({ projectName: "Solo", marketingPlan: "" })
    expect(prompt).toContain("Marketing plan: none written yet")
    expect(prompt).toContain("Live URL: none yet")
  })

  it("discloses oversized fixed fields, preserves the plan tail, and budgets both messages", () => {
    const { system, prompt } = buildCompetitionSnapshotMessages({
      projectName: "Name".repeat(100), description: "Description ".repeat(100),
      idea: "Idea ".repeat(400), targetUsers: Array.from({ length: 100 }, (_, i) => `Audience ${i}`),
      marketingPlan: `## Positioning\n${"Detail. ".repeat(3000)}\n## Final audience\nCommunity bookkeepers.`,
      siteUrl: `https://ledgerly.example/${"p".repeat(1900)}`,
      goals: { businessGoal: "Grow ".repeat(100), revenueTarget: "Revenue ".repeat(100), destination: "Store ".repeat(100) },
    })
    expect(system.length + prompt.length).toBeLessThanOrEqual(COMPETITION_PROMPT_BUDGET)
    expect(prompt).toContain(PLAN_OMITTED_MARKER)
    expect(prompt).toContain("## Final audience\nCommunity bookkeepers.")
    expect(prompt).toContain("Live URL: https://ledgerly.example/")
    expect(prompt).toContain("Audience 99")
  })

  it("does not silently clip plans beyond the former 200k intermediate cap", () => {
    expect(clipPlanForPrompt(`${"A".repeat(210_000)}\nEND OF PLAN`, 1000)).toContain("END OF PLAN")
    expect(() => clipPlanForPrompt("long context", 3)).toThrow("omission disclosure")
  })

  it("clipPlanForPrompt preserves short plans verbatim and normalizes only control characters", () => {
    const plan = "## Market positioning\nCalm, cross-ledger, branded.\n## Growth\nReferrals."
    expect(clipPlanForPrompt(plan, 500)).toBe(plan)
    expect(clipPlanForPrompt(undefined, 500)).toBe("")
    expect(clipPlanForPrompt("", 500)).toBe("")
  })
})
