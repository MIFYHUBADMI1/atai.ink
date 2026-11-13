/**
 * Ads Bench — slot definitions and brief assembly (pure).
 *
 * The /ads surface: the founder describes the offer once, and each piece is
 * drafted through the studio's generation pipeline. The bench covers both
 * halves of making a business visible — free posts the founder publishes
 * themselves (first post, business bio, message to existing customers, a
 * two-week content plan) and paid ad pieces (platform copy, image
 * creatives). Each slot carries the plain-language "where to post it" and
 * "what good looks like" notes a first-time founder needs.
 *
 * Copy slots ride the same context builder discipline as the launch kit —
 * only facts the platform holds (the plan, the offer the founder typed, the
 * live URL), never invented claims. Image slots compose a visual brief for
 * ai.image.
 *
 * This module contains NO network, DB, or environment access.
 *
 * Every piece is a DRAFT saved to the content library. Nothing is published,
 * uploaded, or run on any ad platform; Atai does not place or manage ads.
 */

import type { MarketChannel, MarketContentKind, MarketTone } from "./market-content"
import type { GuideChannelId } from "@/lib/marketing/ads/beginner-guide"
import type { OwnerGoals } from "@/lib/marketing/growth-overview"

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
  /** Which group the piece sits in on the bench: free posts, or paid ads. */
  group: "posts" | "ads"
  /** Exactly where the founder pastes this draft — step by step, for a first-timer. */
  whereToPost: string
  /** What a good version of this looks like, so the founder can judge the draft. */
  whatGoodLooksLike: string
  /** The places this piece makes sense on. Empty means "anywhere you already are". */
  channelIds: GuideChannelId[]
}

export const ADS_KIT_SLOTS: AdsKitSlot[] = [
  {
    slot: "first-post",
    title: "Your first post",
    label: "First post",
    description: "One post you can publish today on your business page.",
    kind: "social",
    tone: "friendly",
    channel: "facebook",
    group: "posts",
    whereToPost:
      "Facebook → your business page → Create post → paste the text → add one photo of the work → Publish. The same text works as an Instagram caption.",
    whatGoodLooksLike:
      "It says what you sell, who it is for, and one clear thing to do next. Nothing you would be embarrassed to show a customer.",
    channelIds: ["facebook", "instagram"],
  },
  {
    slot: "business-profile",
    title: "Business profile description",
    label: "Business bio",
    description: "The short ‘about us’ text for a business page or a Google listing.",
    kind: "copy",
    tone: "professional",
    group: "posts",
    whereToPost:
      "Facebook → Settings → Page info → Description. Google → your Business Profile → Business description. Instagram → Edit profile → Bio.",
    whatGoodLooksLike:
      "Two or three plain sentences: what you do, who you do it for, how to reach you. No jargon and no mission statement.",
    channelIds: ["google-business", "facebook", "instagram"],
  },
  {
    slot: "customer-message",
    title: "Message to customers you already have",
    label: "Message customers",
    description: "A short message for people who already know you.",
    kind: "email",
    tone: "warm",
    group: "posts",
    whereToPost:
      "Your email tool → new email → the subject and preview lines are already written → paste the body → send to the list. On WhatsApp, send the body on its own.",
    whatGoodLooksLike:
      "It names what is new for them rather than listing everything you sell, and it asks for one specific next step.",
    channelIds: ["whatsapp", "email"],
  },
  {
    slot: "content-plan",
    title: "Two weeks of posts",
    label: "Two-week plan",
    description: "What to post each week for the next fortnight.",
    kind: "timeline",
    group: "posts",
    whereToPost:
      "Use it as your content calendar: each line is a day, an idea, a place to post it and what it should get the reader to do. Write up the days you can manage on the day you post. Atai does not schedule or publish anything for you.",
    whatGoodLooksLike:
      "Fourteen days you can pick from. Each line is a topic you could actually post, not a slogan.",
    channelIds: [],
  },
  {
    slot: "facebook-copy",
    title: "Facebook ad copy",
    label: "Facebook ad",
    description: "Primary text and headline options for Facebook.",
    kind: "copy",
    tone: "friendly",
    channel: "facebook",
    group: "ads",
    whereToPost:
      "Facebook Ads Manager → Create ad → Ad creative → Upload image, paste the primary text and headline. You need a Meta Ads account and a budget to run it.",
    whatGoodLooksLike:
      "One clear offer, a headline you can read in a second, and a call to action that says exactly what to do next.",
    channelIds: ["facebook"],
  },
  {
    slot: "instagram-copy",
    title: "Instagram ad copy",
    label: "Instagram ad",
    description: "Caption-first copy for Instagram placements.",
    kind: "copy",
    tone: "bold",
    channel: "instagram",
    group: "ads",
    whereToPost:
      "Meta Ads Manager → Create ad → Ad creative → paste the caption, upload the image or video. Budget and account are yours.",
    whatGoodLooksLike:
      "The first line earns the second line. Short, concrete, no wall of adjectives.",
    channelIds: ["instagram"],
  },
  {
    slot: "tiktok-copy",
    title: "TikTok ad copy",
    label: "TikTok ad",
    description: "Short, native-sounding copy for TikTok.",
    kind: "copy",
    tone: "playful",
    channel: "tiktok",
    group: "ads",
    whereToPost:
      "TikTok Ads Manager → Create ad → Upload video → paste the text as the ad text. Budget and account are yours.",
    whatGoodLooksLike:
      "It reads like a person talking, not like an advert. Two tags at most.",
    channelIds: ["tiktok"],
  },
  {
    slot: "image-square",
    title: "Ad creative · square",
    label: "Creative · square",
    description: "A 1:1 visual for feed placements.",
    kind: "image",
    aspectRatio: "1:1",
    group: "ads",
    whereToPost:
      "Meta Ads Manager → Ad creative → Upload image → use it as the square feed placement. Download it from here first.",
    whatGoodLooksLike:
      "One subject, centred, with space around it. It has to read at thumbnail size.",
    channelIds: ["facebook", "instagram"],
  },
  {
    slot: "image-story",
    title: "Ad creative · story",
    label: "Creative · story",
    description: "A 9:16 visual for stories and reels placements.",
    kind: "image",
    aspectRatio: "9:16",
    group: "ads",
    whereToPost:
      "Meta Ads Manager → Stories placement → Upload image, or Instagram → New story → Add photo → paste the copy on top.",
    whatGoodLooksLike:
      "The subject sits in the middle third, because the top and bottom get covered by the app's interface.",
    channelIds: ["instagram", "tiktok"],
  },
]

const SLOT_COUNTS = new Set(ADS_KIT_SLOTS.map((slot) => slot.slot))
if (SLOT_COUNTS.size !== ADS_KIT_SLOTS.length) {
  throw new Error("ADS_KIT_SLOTS contains duplicate slot ids")
}

export function adsKitSlotById(slotId: string): AdsKitSlot | null {
  return ADS_KIT_SLOTS.find((slot) => slot.slot === slotId) ?? null
}

/**
 * The pieces a first-timer should draft FIRST: the free posts that make the
 * business visible at all. Paid ad pieces and image creatives are never
 * pre-selected — they need an ad account, a budget, and more credits.
 */
export function defaultBenchSlots(recommended: GuideChannelId[]): string[] {
  const slots = ["first-post", "business-profile", "content-plan"]
  if (recommended.includes("email") || recommended.includes("whatsapp")) slots.push("customer-message")
  return slots.filter((slot) => ADS_KIT_SLOTS.some((entry) => entry.slot === slot))
}

/** What each copy slot asks the writer to produce. The studio's per-kind
 * instruction still applies on top; these briefs shape it per placement. */
const ADS_SLOT_ASK: Record<string, string> = {
  "first-post":
    "Write the founder's FIRST post about this business — the one they can publish today on their business page. Give one post in plain language: what the business does, who it helps, and one clear thing to do next. Keep it under 40 words. No emoji walls, no hashtag walls, no exclamation marks, no buzzwords.",
  "business-profile":
    "Write the 'about us' text for this business — the short description used on a business page, a Google listing or a profile bio. Give four options to choose from. Each option is two or three plain sentences: what the business does, who it is for, and how to reach it. No mission statement, no jargon, and no claim the context does not support.",
  "customer-message":
    "Write one message for customers who already know this business — something they can send today. Keep it warm and personal, not a newsletter: one offer, one clear action, a plain sign-off, and under 60 words in the body.",
  "content-plan":
    "Plan the next 14 days of content for this business. The owner can realistically post about twice a week, so make every line a post they could publish with little editing, in plain language. Do not repeat the same idea twice and do not use hashtag walls.",
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
  /** The founder's onboarding goals — steer the copy toward where they want the business to go. */
  ownerGoals?: OwnerGoals | null
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

  const goalParts = [input.ownerGoals?.businessGoal, input.ownerGoals?.destination]
    .map((part) => snippet(part, 90))
    .filter(Boolean)
  const goalBody = goalParts.length > 0 ? goalParts.join(" — aiming for: ") : ""

  // In KEEP priority — the loop drops from the end when space runs out.
  const backing: Array<{ key: "audience" | "description" | "goal" | "positioning" | "users"; text: string }> = [
    audienceBody ? { key: "audience", text: `${AUDIENCE_PREFIX}${audienceBody}` } : null,
    descriptionBody ? { key: "description", text: `What it is: ${descriptionBody}` } : null,
    goalBody ? { key: "goal", text: `Founder's goal: ${goalBody}` } : null,
    positioningBody ? { key: "positioning", text: `Positioning from the plan: ${positioningBody}` } : null,
    users.length > 0 ? { key: "users", text: `Target users: ${users.join("; ")}` } : null,
  ].filter(
    (entry): entry is { key: "audience" | "description" | "goal" | "positioning" | "users"; text: string } =>
      entry !== null,
  )

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
