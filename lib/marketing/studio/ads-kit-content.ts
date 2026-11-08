/**
 * Ads Bench — slot definitions and brief assembly (pure).
 *
 * The /ads surface: the founder describes the offer once, and each ad-relevant
 * piece is drafted through the studio's generation pipeline. Copy slots ride
 * the same context builder discipline as the launch kit — only facts the
 * platform holds (the plan, the offer the founder typed, the live URL), never
 * invented claims. Image slots compose a visual brief for ai.image.
 *
 * This module contains NO network, DB, or environment access.
 *
 * Every piece is a DRAFT saved to the content library. Nothing is published,
 * uploaded, or run on any ad platform; Atai does not place or manage ads.
 */

import type { MarketChannel, MarketContentKind, MarketTone } from "./market-content"

export type AdsKitId = "ads"

export interface AdsKitSlot {
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
  aspectRatio?: "1:1" | "4:5" | "9:16"
}

export const ADS_KIT_SLOTS: AdsKitSlot[] = [
  {
    slot: "facebook-copy",
    title: "Facebook ad copy",
    label: "Facebook ad",
    description: "Primary text and headline options for Facebook.",
    kind: "copy",
    tone: "friendly",
    channel: "facebook",
  },
  {
    slot: "instagram-copy",
    title: "Instagram ad copy",
    label: "Instagram ad",
    description: "Caption-first copy for Instagram placements.",
    kind: "copy",
    tone: "bold",
    channel: "instagram",
  },
  {
    slot: "tiktok-copy",
    title: "TikTok ad copy",
    label: "TikTok ad",
    description: "Short, native-sounding copy for TikTok.",
    kind: "copy",
    tone: "playful",
    channel: "tiktok",
  },
  {
    slot: "image-square",
    title: "Ad creative · square",
    label: "Creative · square",
    description: "A 1:1 visual for feed placements.",
    kind: "image",
    aspectRatio: "1:1",
  },
  {
    slot: "image-story",
    title: "Ad creative · story",
    label: "Creative · story",
    description: "A 9:16 visual for stories and reels placements.",
    kind: "image",
    aspectRatio: "9:16",
  },
]

const SLOT_COUNTS = new Set(ADS_KIT_SLOTS.map((slot) => slot.slot))
if (SLOT_COUNTS.size !== ADS_KIT_SLOTS.length) {
  throw new Error("ADS_KIT_SLOTS contains duplicate slot ids")
}

export function adsKitSlotById(slotId: string): AdsKitSlot | null {
  return ADS_KIT_SLOTS.find((slot) => slot.slot === slotId) ?? null
}

/** What each copy slot asks the writer to produce. The studio's per-kind
 * instruction still applies on top; these briefs shape it per placement. */
const ADS_SLOT_ASK: Record<string, string> = {
  "facebook-copy":
    "Write Facebook ad copy for this offer. Give four options; each option has a short label, one line of primary text, and a headline under 40 characters. Each option ends with one clear call to action.",
  "instagram-copy":
    "Write Instagram ad copy for this offer. Give four options; each option has a short label, a caption-style first line that stops the scroll, one to two lines of body, and a call to action. Keep each option tight.",
  "tiktok-copy":
    "Write TikTok ad copy for this offer. Give four options; each option has a short label, an opening hook line that sounds native to TikTok (not like an ad), one supporting line, and a call to action. No hashtag walls — two tags at most.",
}

/** The ask for the image creative slots — composed into a visual brief. */
const ADS_IMAGE_ASK: Record<string, string> = {
  "image-square":
    "A feed-placement ad creative: the product or service presented as the clear hero, with room around the focal point. Lifestyle-adjacent, true to the brand, no text overlays.",
  "image-story":
    "A story/reels-placement ad creative: vertical composition with the product or service as the hero and a strong focal point in the middle third. No text overlays.",
}

/** Collapse whitespace and cap a value for prompt use. */
function snippet(value: string | undefined, max: number): string {
  const collapsed = (value ?? "").replace(/\s+/g, " ").trim()
  if (!collapsed) return ""
  return collapsed.length > max ? `${collapsed.slice(0, max - 1).trimEnd()}…` : collapsed
}

export interface AdsKitContextInput {
  projectName: string
  /** Required — what the founder is advertising (the offer, promotion, or goal). */
  offer: string
  audience?: string
  description?: string
  positioning?: string
  targetUsers?: string[]
  siteUrl?: string
}

/** Total character budget for the assembled context. The per-slot ask plus
 * this must stay under the service's 2000-character brief limit. */
const CONTEXT_BUDGET = 1100

const AUDIENCE_PREFIX = "Intended audience: "

/** The shared context every ads brief rides on. The offer is the founder's own
 * words and always survives; plan facts back it up. Nothing is invented. When
 * the whole context would overflow the budget, the backing facts give way in a
 * fixed order (user list first, founder-typed audience last, shrinking rather
 * than dropped) — the app name, the offer and the URL line always survive. */
export function buildAdsKitContext(input: AdsKitContextInput): string {
  const name = snippet(input.projectName, 100) || "the app"
  const offer = snippet(input.offer, 600)
  const urlLine = input.siteUrl
    ? `Live URL: ${snippet(input.siteUrl, 160)}`
    : "Live URL: none yet — write copy that works without a link and leave the link step to the founder."

  const essential = [`App: ${name}`, `What is being advertised (the founder's own words): ${offer}`, urlLine]
  const essentialLength = essential.join("\n").length + 1

  const audienceBody = snippet(input.audience, 300)
  const users = (input.targetUsers ?? [])
    .map((user) => snippet(user, 40))
    .filter(Boolean)
    .slice(0, 5)
  const descriptionBody = snippet(input.description, 180)
  const positioningBody = snippet(input.positioning, 400)

  // In KEEP priority — the loop drops from the end when space runs out.
  const backing: Array<{ key: "audience" | "description" | "positioning" | "users"; text: string }> = [
    audienceBody ? { key: "audience", text: `${AUDIENCE_PREFIX}${audienceBody}` } : null,
    descriptionBody ? { key: "description", text: `What it is: ${descriptionBody}` } : null,
    positioningBody ? { key: "positioning", text: `Positioning from the plan: ${positioningBody}` } : null,
    users.length > 0 ? { key: "users", text: `Target users: ${users.join("; ")}` } : null,
  ].filter((entry): entry is { key: "audience" | "description" | "positioning" | "users"; text: string } => entry !== null)

  let budget = CONTEXT_BUDGET - essentialLength
  const kept: string[] = []
  for (const entry of backing) {
    const cost = entry.text.length + 1
    if (cost <= budget) {
      kept.push(entry.text)
      budget -= cost
    } else if (entry.key === "audience") {
      // The founder's own audience is worth keeping even when tight —
      // shrink it instead of dropping it.
      const shrunk = snippet(input.audience, Math.max(60, budget - AUDIENCE_PREFIX.length - 1))
      if (shrunk) {
        kept.push(`${AUDIENCE_PREFIX}${shrunk}`)
        budget -= shrunk.length + AUDIENCE_PREFIX.length + 1
      }
    }
    // Anything else that does not fit is dropped, in the fixed order above.
  }

  return [essential[0], ...kept, essential[1], essential[2]].join("\n")
}

/** The brief sent for one slot. Copy slots get the ask + the context with an
 * anti-fabrication footer; image slots get a visual ask + a context line —
 * the copy-oriented footer would read as instructions inside the image prompt. */
export function adsKitBrief(slot: AdsKitSlot, context: string): string {
  if (slot.kind === "image") {
    const ask = ADS_IMAGE_ASK[slot.slot]
    if (!ask) throw new Error(`No ads bench brief defined for slot ${slot.slot}`)
    return `${ask}\n\nProduct and audience context: ${context}`
  }
  const ask = ADS_SLOT_ASK[slot.slot]
  if (!ask) throw new Error(`No ads bench brief defined for slot ${slot.slot}`)
  return `${ask}\n\nContext you must draw from — do not invent facts that are not here:\n${context}`
}
