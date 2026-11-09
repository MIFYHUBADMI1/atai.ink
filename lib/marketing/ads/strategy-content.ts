/**
 * Advertising strategy — pure vocabulary, bounds and brief assembly.
 *
 * The strategy document is the FOUNDER'S own input. The AI recommendation is a
 * studio-generated draft that reads the plan and this strategy and proposes
 * practical next moves; it is stored in the content library and never merged
 * back into the strategy document.
 *
 * This module contains NO network, DB, or environment access.
 */

/** Field bounds (chars / list lengths) — shared by the API schema and the UI. */
export const AD_STRATEGY_BOUNDS = {
  positioning: 500,
  icp: 400,
  geographies: 300,
  listItems: 6,
  listItem: 120,
  budgetNote: 300,
  brandVoice: 200,
  usps: 500,
} as const

export const ADS_STRATEGY_SLOT = "strategy-recommendations"

/** Collapse whitespace and cap a value for prompt use. */
function snippet(value: string | undefined, max: number): string {
  const collapsed = (value ?? "").replace(/\s+/g, " ").trim()
  if (!collapsed) return ""
  return collapsed.length > max ? `${collapsed.slice(0, max - 1).trimEnd()}…` : collapsed
}

function listLine(label: string, items: string[] | undefined, perItem: number = AD_STRATEGY_BOUNDS.listItem): string {
  const cleaned = (items ?? []).map((item) => snippet(item, perItem)).filter(Boolean)
  return cleaned.length > 0 ? `${label}: ${cleaned.join("; ")}` : ""
}

export interface StrategyBriefInput {
  projectName: string
  /** What the app does, from the stored specification. */
  description?: string
  /** The plan's marketing/positioning prose. */
  positioningFromPlan?: string
  targetUsers?: string[]
  siteUrl?: string
  ownerGoals?: { businessGoal?: string; destination?: string } | null
  /** The founder's saved strategy fields. */
  strategy?: {
    positioning?: string
    icp?: string
    geographies?: string
    objectives?: string[]
    channels?: string[]
    budgetNote?: string
    priorities?: string[]
    brandVoice?: string
    usps?: string
  } | null
}

const RECOMMENDATION_ASK =
  "Write advertising strategy recommendations for this business. Give 4–6 concrete recommendations. For each one: a short bold label, what to do, and one sentence on why it matters for THIS business — grounded only in the facts below. Cover whichever of these apply: awareness, traffic acquisition, lead generation, conversion, retention, revenue growth, or a launch. Do not invent budget numbers, follower counts, or performance results. End with a 3-item 'start here first' list."

const CONTEXT_HEADER = "Context you must draw from — do not invent facts that are not here:"

/** The studio service's hard cap — briefs that exceed it get sliced mid-text. */
const SERVICE_BRIEF_CAP = 2000

const ESSENTIAL_LINES = (input: StrategyBriefInput): string[] => {
  const name = snippet(input.projectName, 100) || "the business"
  const urlLine = input.siteUrl
    ? `Live URL: ${snippet(input.siteUrl, 160)}`
    : "Live URL: none yet — recommendations must work without a link."
  return [`Business: ${name}`, urlLine]
}

/**
 * The studio service hard-slices briefs at 2000 chars, so the assembled brief
 * is guaranteed to fit that cap exactly: context lines are kept whole (never
 * sliced) in priority order — founder goal, then founder strategy fields,
 * then plan prose — and a line that no longer fits is dropped entirely, never
 * truncated mid-text.
 */
export function buildStrategyBrief(input: StrategyBriefInput): string {
  const essential = ESSENTIAL_LINES(input)
  const wrapper = `${RECOMMENDATION_ASK}\n\n${CONTEXT_HEADER}\n`
  const essentialBlock = essential.join("\n")

  const goalParts = [input.ownerGoals?.businessGoal, input.ownerGoals?.destination]
    .map((part) => snippet(part, 110))
    .filter(Boolean)
  const goalLine = goalParts.length > 0 ? `Founder's goal: ${goalParts.join(" — aiming for: ")}` : ""

  const s = input.strategy ?? {}
  const strategyLines = [
    listLine("Founder's advertising objectives", s.objectives),
    listLine("Preferred channels", s.channels),
    snippet(s.icp, 280) ? `Ideal customer: ${snippet(s.icp, 280)}` : "",
    snippet(s.positioning, 280) ? `Positioning (founder): ${snippet(s.positioning, 280)}` : "",
    listLine("Priorities", s.priorities),
    snippet(s.usps, 280) ? `Selling points to emphasize: ${snippet(s.usps, 280)}` : "",
    snippet(s.geographies, 160) ? `Target geographies: ${snippet(s.geographies, 160)}` : "",
    snippet(s.brandVoice, 120) ? `Brand voice: ${snippet(s.brandVoice, 120)}` : "",
    snippet(s.budgetNote, 160) ? `Budget note (intent, not a spend record): ${snippet(s.budgetNote, 160)}` : "",
  ].filter(Boolean)

  const planLines = [
    snippet(input.positioningFromPlan, 400) ? `Positioning from the plan: ${snippet(input.positioningFromPlan, 400)}` : "",
    snippet(input.description, 180) ? `What it is: ${snippet(input.description, 180)}` : "",
    listLine("Target users", input.targetUsers, 40),
  ].filter(Boolean)

  // Each kept line costs its length + 1 (the joining newline), so sum(costs) ≤
  // budget ⇒ body = essentialBlock + sum(costs) ⇒ wrapper + body ≤ the cap.
  let budget = SERVICE_BRIEF_CAP - wrapper.length - essentialBlock.length
  const kept: string[] = []
  for (const line of [goalLine, ...strategyLines, ...planLines].filter(Boolean)) {
    const cost = line.length + 1
    if (cost <= budget) {
      kept.push(line)
      budget -= cost
    }
  }

  return `${wrapper}${[...essential, ...kept].join("\n")}`
}
