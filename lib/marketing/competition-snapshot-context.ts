/**
 * Competition snapshot — dedicated prompt assembly (pure).
 *
 * The competition snapshot previously rode the studio's generic "brief" kind,
 * whose template instructions fought the snapshot's own required sections and
 * whose 2,000-character brief cap silently cut the plan context. This module
 * gives Competition its own authoritative system + user messages and its own
 * context budget, so the studio template is never injected and nothing is
 * dropped without saying so.
 *
 * NO network, DB, or environment access — same split as market-content.ts,
 * so the assembly is unit-testable (see competition-snapshot-context.test.ts).
 */

function clean(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim()
}

export const COMPETITION_SNAPSHOT_TITLE = "Competitor snapshot (AI draft)"

/** The ask. Its length is part of the prompt budget math — measure, don't guess. */
export const COMPETITION_SNAPSHOT_ASK =
  "Draft the competitor-landscape snapshot for this product, written ONLY from the context provided.\n" +
  'Cover each point under its own short markdown heading, in this order:\n' +
  '1 "Positioning" — what the plan says sets this product apart, restated clearly.\n' +
  '2 "Who it serves" — the target customers, as the plan describes them.\n' +
  '3 "Value proposition" — the promise to customers, restated.\n' +
  '4 "Likely competitor categories" — the kinds of alternatives these users probably use today. ' +
  "Describe types; name a real company ONLY if it appears in the context.\n" +
  '5 "Competitor references" — companies from the context worth examining further, or one line ' +
  "saying none appear in the plan.\n" +
  '6 "Differentiation opportunities" — where this product could stand apart, phrased as hypotheses.\n' +
  '7 "What the plan does not establish" — the claims that would need real market evidence.\n' +
  '8 "Questions to investigate next" — two or three concrete questions about the competitive space.\n' +
  "Never invent market sizes, prices, rankings, reviews, funding, statistics, or facts about real " +
  "companies that are not in the context. Every statement that is an inference rather than something " +
  "the plan says must be plainly worded as an inference."

export const COMPETITION_SNAPSHOT_SYSTEM =
  "You are the competitive-intelligence analyst inside a founder's product workspace. " +
  "You draft competitor-landscape snapshots strictly from the founder's own planning context. " +
  "Never invent market sizes, prices, rankings, reviews, testimonials, funding, statistics, or " +
  "facts about real companies that are not present in the context. " +
  "If a concrete fact is not provided, write around it or state it as an explicit hypothesis instead of fabricating it. " +
  "Do not mention that you are an AI. Return only the requested deliverable — no preamble, no markdown fences."

// Application budget for BOTH messages; model-specific token limits remain provider-enforced.
export const COMPETITION_PROMPT_BUDGET = 12_000

const CONTEXT_HEADER = "Context you must draw from — do not invent facts that are not here:"

export interface CompetitionSnapshotContextInput {
  projectName: string
  description?: string
  idea?: string
  /** The founder's combined marketing plan (positioning, value proposition, channels). */
  marketingPlan?: string
  targetUsers?: string[]
  siteUrl?: string
  goals?: { businessGoal?: string; revenueTarget?: string; destination?: string }
}

export const PLAN_OMITTED_MARKER =
  "[Middle of this context omitted from the prompt to fit the request budget; do not infer missing details. The ending resumes below.]"

export function clipPlanForPrompt(plan: string | undefined, budget: number): string {
  const normalized = clean(plan ?? "")
  if (normalized.length <= budget) return normalized
  if (budget < PLAN_OMITTED_MARKER.length + 4) throw new Error("Insufficient context budget for omission disclosure")
  const room = budget - PLAN_OMITTED_MARKER.length - 4
  const headRoom = Math.ceil(room * 0.65)
  const tailRoom = room - headRoom
  const head = normalized.slice(0, headRoom)
  const headBreak = Math.max(head.lastIndexOf("\n"), head.lastIndexOf(". "))
  const tail = tailRoom > 0 ? normalized.slice(-tailRoom) : ""
  const tailBreak = tail.indexOf("\n")
  return [
    (headBreak > headRoom * 0.5 ? head.slice(0, headBreak + 1) : head).trimEnd(),
    PLAN_OMITTED_MARKER,
    (tailBreak >= 0 && tailBreak < tailRoom * 0.5 ? tail.slice(tailBreak + 1) : tail).trimStart(),
  ].join("\n\n")
}

function fixedLine(label: string, value: string | undefined, max: number): string {
  const cleaned = clipPlanForPrompt(value, max)
  return cleaned ? `${label}: ${cleaned}` : ""
}

export function buildCompetitionSnapshotMessages(input: CompetitionSnapshotContextInput): {
  system: string
  prompt: string
} {
  const users = (input.targetUsers ?? []).map((user) => clean(user)).filter(Boolean)

  const fixed: string[] = [
    fixedLine("App", input.projectName, 200),
    fixedLine("What it is", input.description, 600),
    fixedLine("In the founder's words", input.idea, 800),
    fixedLine("Target users", users.join("; "), 1200),
    fixedLine("Business goal", input.goals?.businessGoal, 300),
    fixedLine("Revenue target", input.goals?.revenueTarget, 150),
    fixedLine("Where the founder wants it to live", input.goals?.destination, 150),
  ].filter(Boolean)

  const fixedBlock = fixed.join("\n")
  const planLabel =
    "Marketing plan from the founder's planning (positioning, value proposition, channels):"
  const siteUrl = clean(input.siteUrl ?? "")
  const urlLine = siteUrl.length > 2048
    ? "Live URL: omitted because it exceeds 2048 characters; no shortened URL was substituted."
    : siteUrl
      ? `Live URL: ${siteUrl}`
      : "Live URL: none yet — leave link-specific steps to the founder."

  const nonPlanLength =
    COMPETITION_SNAPSHOT_SYSTEM.length +
    COMPETITION_SNAPSHOT_ASK.length +
    CONTEXT_HEADER.length +
    fixedBlock.length +
    planLabel.length +
    urlLine.length +
    9

  const planBudget = COMPETITION_PROMPT_BUDGET - nonPlanLength
  const plan = clipPlanForPrompt(input.marketingPlan, planBudget)

  const planBlock = plan
    ? `${planLabel}\n${plan}`
    : "Marketing plan: none written yet — draft from the facts above and mark everything else as unknown or hypothesis."

  const prompt = [COMPETITION_SNAPSHOT_ASK, CONTEXT_HEADER, fixedBlock, planBlock, urlLine]
    .filter(Boolean)
    .join("\n\n")

  return { system: COMPETITION_SNAPSHOT_SYSTEM, prompt }
}
