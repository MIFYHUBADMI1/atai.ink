/**
 * Launch Kit — slot definitions and brief assembly (pure).
 *
 * The kit is the "Market my app for me" pass on the Market page: one click
 * generates a complete launch package from the plan the founder already has.
 * This module contains NO network, DB, or environment access — the same
 * split as market-content.ts / market-service.ts — so the vocabulary is
 * unit-testable and shared between the server service and the UI.
 *
 * Every kit piece is a DRAFT saved to the content library. Nothing is
 * posted, sent, or scheduled anywhere; publishing stays entirely manual.
 */

import type {
  MarketChannel,
  MarketContentKind,
  MarketLength,
  MarketTone,
} from "./market-content"

export type LaunchKitId = "launch"

export interface LaunchKitSlot {
  /** Stable id — doubles as ContentItemDoc.kitSlot and the stream frame key. */
  slot: string
  /** Library title for the generated item. */
  title: string
  /** Short label shown in the UI. */
  label: string
  /** One line on what the piece is for. */
  description: string
  kind: MarketContentKind
  tone?: MarketTone
  channel?: MarketChannel
  length?: MarketLength
}

export const LAUNCH_KIT_SLOTS: LaunchKitSlot[] = [
  {
    slot: "announcement-x",
    title: "Launch announcement · X (Twitter)",
    label: "Launch post · X (Twitter)",
    description: "The announcement post, sized for the timeline.",
    kind: "social",
    tone: "confident",
    channel: "x",
    length: "short",
  },
  {
    slot: "announcement-linkedin",
    title: "Launch announcement · LinkedIn",
    label: "Launch post · LinkedIn",
    description: "The professional announcement, written for your network.",
    kind: "social",
    tone: "professional",
    channel: "linkedin",
    length: "medium",
  },
  {
    slot: "announcement-community",
    title: "Launch message · WhatsApp & groups",
    label: "Launch message · WhatsApp & communities",
    description: "A personal message you can paste into groups and chats.",
    kind: "social",
    tone: "warm",
    channel: "whatsapp",
    length: "short",
  },
  {
    slot: "product-hunt",
    title: "Product Hunt launch copy",
    label: "Product Hunt launch copy",
    description: "Tagline, description and maker comment for launch day.",
    kind: "copy",
    tone: "bold",
    length: "short",
  },
  {
    slot: "announcement-email",
    title: "Announcement email",
    label: "Announcement email",
    description: "Subject, preview and body for friends and early supporters.",
    kind: "email",
    tone: "warm",
    channel: "email",
    length: "medium",
  },
  {
    slot: "content-calendar",
    title: "14-day content calendar",
    label: "14-day content calendar",
    description: "What to post each day after launch — idea, channel, call to action.",
    kind: "timeline",
    tone: "professional",
    length: "long",
  },
  {
    slot: "seo-share",
    title: "Search & social share copy",
    label: "Search & share copy",
    description: "SEO title, meta description and Open Graph copy for the site.",
    kind: "copy",
    tone: "professional",
    channel: "landing_page",
    length: "short",
  },
]

const SLOT_COUNTS = new Set(LAUNCH_KIT_SLOTS.map((slot) => slot.slot))
if (SLOT_COUNTS.size !== LAUNCH_KIT_SLOTS.length) {
  throw new Error("LAUNCH_KIT_SLOTS contains duplicate slot ids")
}

export function launchKitSlotById(slotId: string): LaunchKitSlot | null {
  return LAUNCH_KIT_SLOTS.find((slot) => slot.slot === slotId) ?? null
}

/** What each slot asks the writer to produce. The studio's per-kind
 * instruction still applies on top; these briefs shape it per piece. */
const SLOT_ASK: Record<string, string> = {
  "announcement-x":
    "Write the founder's launch announcement for X (Twitter). One scroll-stopping post: lead with what the app does in plain words, name the app, end with one clear call to action. At most two hashtags.",
  "announcement-linkedin":
    "Write the founder's launch announcement for LinkedIn. Three to five short paragraphs, professional but human: what the app does, who it helps and why now, then one call to action. No hashtag walls — three relevant tags at most.",
  "announcement-community":
    "Write a short, warm launch message the founder can paste into WhatsApp groups, family chats and community servers. Conversational, no marketing jargon, under 120 words, ending with the invitation to try it.",
  "product-hunt":
    "This is Product Hunt launch copy. Give the four options these exact labels: 1 'Tagline' — under 60 characters. 2 'Description' — two to three sentences. 3 'Maker comment' — a warm first comment from the founder on why they built it. 4 'Ask a friend' — one short line the founder can send to friends asking for support on launch day.",
  "announcement-email":
    "Write the announcement email the founder sends to friends, colleagues and early supporters: one subject line, one preview line, then a 150–250 word body that sounds like a person rather than a campaign, ending with one call to action.",
  "content-calendar":
    "Build the founder's 14-day post-launch content calendar. Keep the 'Day N — idea — channel — call to action' format. Weight the first three days toward announcement moments, then mix proof, tips and behind-the-scenes. Every call to action points at trying the app.",
  "seo-share":
    "Give the four options these exact labels: 1 'SEO title' — under 60 characters. 2 'Meta description' — under 155 characters, natural language, one call to action. 3 'Open Graph title'. 4 'Open Graph description + one visual idea for the share card'.",
}

/** Collapse whitespace and cap a value for prompt use. */
function snippet(value: string | undefined, max: number): string {
  const collapsed = (value ?? "").replace(/\s+/g, " ").trim()
  if (!collapsed) return ""
  return collapsed.length > max ? `${collapsed.slice(0, max - 1).trimEnd()}…` : collapsed
}

export interface LaunchKitContextInput {
  projectName: string
  description?: string
  idea?: string
  marketingPlan?: string
  targetUsers?: string[]
  siteUrl?: string
  goals?: {
    businessGoal?: string
    revenueTarget?: string
    destination?: string
  }
}

/** Total character budget for the assembled context. The per-slot ask plus
 * this must stay under the service's 2000-character brief limit, so the
 * marketing-plan slice flexes while the short, high-value facts always fit. */
const CONTEXT_BUDGET = 1200

/** The shared context every kit brief rides on — assembled from data the
 * platform already holds (the plan, the founder's goals, the live URL).
 * Nothing here is invented; absent facts are stated as absent. */
export function buildLaunchKitContext(input: LaunchKitContextInput): string {
  const name = snippet(input.projectName, 100) || "the app"
  const description = snippet(input.description, 180)
  const idea = snippet(input.idea, 200)
  const users = (input.targetUsers ?? [])
    .map((user) => snippet(user, 40))
    .filter(Boolean)
    .slice(0, 5)
  const goal = snippet(input.goals?.businessGoal, 160)
  const revenue = snippet(input.goals?.revenueTarget, 100)
  const destination = snippet(input.goals?.destination, 100)
  const urlLine = input.siteUrl
    ? `Live URL: ${snippet(input.siteUrl, 160)}`
    : "Live URL: none yet — write copy that works without a link and leave the link step to the founder."

  const fixed: string[] = [`App: ${name}`]
  if (description) fixed.push(`What it is: ${description}`)
  if (idea) fixed.push(`In the founder's words: ${idea}`)
  if (users.length > 0) fixed.push(`Target users: ${users.join("; ")}`)
  if (goal) fixed.push(`Business goal: ${goal}`)
  if (revenue) fixed.push(`Revenue target: ${revenue}`)
  if (destination) fixed.push(`Where the founder wants it to live: ${destination}`)
  fixed.push(urlLine)

  const fixedLength = fixed.join("\n").length + 1
  const planBudget = Math.max(200, CONTEXT_BUDGET - fixedLength)
  const plan = snippet(input.marketingPlan, planBudget)
  if (plan) fixed.splice(fixed.length - 1, 0, `Marketing plan from the founder's planning (positioning, value proposition, channels):\n${plan}`)

  return fixed.join("\n")
}

/** The brief sent for one slot: the ask, then the shared context. Capped well
 * under the service's 2000-character brief limit. */
export function launchKitBrief(slot: LaunchKitSlot, context: string): string {
  const ask = SLOT_ASK[slot.slot]
  if (!ask) throw new Error(`No launch-kit brief defined for slot ${slot.slot}`)
  return `${ask}\n\nContext you must draw from — do not invent facts that are not here:\n${context}`
}
