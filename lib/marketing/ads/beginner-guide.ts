/**
 * Beginner guide for the ads bench (pure).
 *
 * The bench's audience is a business owner who has never run marketing. This
 * module holds the scaffolding they read BEFORE generating anything: what a
 * channel is, where their customers plausibly already are, what to do in their
 * first week, and how their offer is prefilled from their own plan.
 *
 * NO network, DB or environment access, so the same words serve the server
 * render and the unit tests.
 *
 * Honesty rules this module keeps:
 *   - every recommendation says WHY, from the founder's own context (their
 *     saved strategy, their plan, whether they have a live site);
 *   - nothing here claims Atai will post, publish, run or place anything;
 *   - no channel is promised to work — the guide says where people may be,
 *     never what will succeed for this business.
 */

/** The places a small business can show up. */
export type GuideChannelId =
  | "facebook"
  | "instagram"
  | "whatsapp"
  | "google-business"
  | "email"
  | "tiktok"
  | "linkedin"
  | "blog"

export interface GuideChannel {
  id: GuideChannelId
  label: string
  /** What this place IS, for someone who has never advertised. */
  whatItIs: string
  /** What the founder posts here. */
  whatToPost: string
  /** Exactly where the draft gets pasted, step by step. */
  whereToPost: string
  /** Honest effort note — how much of the founder's time this takes. */
  effort: "low" | "medium" | "high"
  /** Free to show up in, or paid. */
  cost: "free" | "paid"
  /** Free-text words a founder might write in their saved strategy. */
  aliases: string[]
}

export const GUIDE_CHANNELS: GuideChannel[] = [
  {
    id: "facebook",
    label: "Facebook page",
    whatItIs:
      "A public page for your business, where people find you, message you and see what you post. Most small businesses start here.",
    whatToPost: "One post a week: what you made, a customer story, or an offer that ends soon.",
    whereToPost:
      "Facebook → your business page → Create post → paste the text → add one photo of the work → Publish.",
    effort: "low",
    cost: "free",
    aliases: ["facebook", "fb", "facebook page", "meta", "facebook ads"],
  },
  {
    id: "instagram",
    label: "Instagram",
    whatItIs:
      "A photo-and-video profile. Often the same people as Facebook — but there they judge you by your photos.",
    whatToPost: "Photos of the work, a short caption, and the occasional offer.",
    whereToPost: "Instagram → your profile → New post → paste the caption → choose the photo → Share.",
    effort: "medium",
    cost: "free",
    aliases: ["instagram", "ig", "instagram page", "instagram ads"],
  },
  {
    id: "whatsapp",
    label: "WhatsApp Business",
    whatItIs:
      "The chat app your customers already message you on, with a profile, a catalogue and an away message.",
    whatToPost: "Short updates and offers you send to people who already know you.",
    whereToPost:
      "WhatsApp Business → Business profile → fill in About and Catalogue → then share a status with the draft text.",
    effort: "low",
    cost: "free",
    aliases: ["whatsapp", "wa", "whatsapp business", "whatsapp status"],
  },
  {
    id: "google-business",
    label: "Google Business Profile",
    whatItIs:
      "The listing that appears when someone searches for your service on Google or Maps. Free, and it brings people who are already looking for you.",
    whatToPost: "Your services, opening hours, photos of the work, and a description of what you do.",
    whereToPost:
      "Google → your Business Profile → Business description, Services, Photos → publish the updates.",
    effort: "medium",
    cost: "free",
    aliases: [
      "google business",
      "google business profile",
      "gbp",
      "google listing",
      "maps",
      "local listing",
      "google my business",
    ],
  },
  {
    id: "email",
    label: "Email list",
    whatItIs:
      "A list of people who gave you their email address. You own it — no algorithm sits between you and them.",
    whatToPost: "Something worth telling them: an offer, a new service, a thank-you.",
    whereToPost: "Your email tool → new email → paste the subject line and body → send it to the list.",
    effort: "medium",
    cost: "free",
    aliases: ["email", "newsletter", "email list", "mailing list", "email campaign"],
  },
  {
    id: "tiktok",
    label: "TikTok",
    whatItIs:
      "Short video. It only pays off if you can film and post video several times a week — a monthly post there does very little.",
    whatToPost: "Short videos of the work in progress, the product, or a person doing the job.",
    whereToPost: "TikTok → + → Record or Upload → paste the text as the caption → Post.",
    effort: "high",
    cost: "free",
    aliases: ["tiktok", "reels", "tiktok ads", "shorts"],
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    whatItIs:
      "A professional network. Worth your time only if you sell to other businesses or to freelancers.",
    whatToPost: "How you work, what you are building, and results you can show.",
    whereToPost: "LinkedIn → Start a post → paste the text → Post.",
    effort: "medium",
    cost: "free",
    aliases: ["linkedin", "b2b", "linkedin page"],
  },
  {
    id: "blog",
    label: "Your own site",
    whatItIs:
      "A page on the site you built. Slow to pay off, but it keeps working and nobody can take it away.",
    whatToPost: "Answers to the questions your customers keep asking you.",
    whereToPost: "Your site → the page that fits the topic → publish. In Atai: Studio → Blog.",
    effort: "medium",
    cost: "free",
    aliases: ["blog", "seo", "website", "site", "landing page", "landing_page"],
  },
]

/** What the founder reads before they touch anything. */
export const BENCH_STEPS: { title: string; detail: string }[] = [
  {
    title: "Say what you are promoting",
    detail:
      "One sentence is enough — the offer, the product, the sale. We fill it in from your own plan or strategy when we can; change it if you are promoting something else today.",
  },
  {
    title: "Choose where people should find you",
    detail:
      "We suggest the places your customers plausibly already are, and explain each one. Pick any of them, or pick your own.",
  },
  {
    title: "Copy it and post it yourself",
    detail:
      "Atai writes the words and the visuals. You paste them into the app. We never post, publish, buy or place anything for you.",
  },
]

export interface GuideContext {
  /** The founder has a live site — posts need somewhere to send people. */
  hasLiveSite: boolean
  /** The founder saved an advertising strategy on the Strategy tab. */
  hasSavedStrategy: boolean
  /** Free-text channels from that saved strategy. */
  strategyChannels: string[]
  /** The founder's own ideal-customer description (saved strategy). */
  icp: string
  /** Target users from the project plan. */
  targetUsers: string[]
  /** The plan's market positioning. */
  positioning: string
  /** The founder's stated business goal. */
  businessGoal: string
}

export interface ChannelRecommendation {
  channel: GuideChannel
  /** Why this place was suggested, in the founder's own terms. */
  why: string
  source: "your-strategy" | "starter"
}

/** Map a free-text strategy channel ("Facebook page", "IG", "GBP") to a guide channel. */
export function matchChannel(text: string): GuideChannel | null {
  const cleaned = text.toLowerCase().replace(/[^a-z\s]/g, " ").trim()
  if (!cleaned) return null
  const words = new Set(cleaned.split(/\s+/))
  for (const channel of GUIDE_CHANNELS) {
    // Aliases match whole words only — "pigeon" must not match "ig".
    if (channel.aliases.some((alias) => alias.split(/\s+/).every((word) => words.has(word)))) {
      return channel
    }
  }
  return null
}

/** The places a business with no marketing experience usually starts. */
const STARTER_ORDER: GuideChannelId[] = ["facebook", "google-business", "whatsapp", "email"]

/**
 * Which places to show up in, for THIS business.
 *
 * The founder's saved strategy leads (they already decided). Then a small
 * number of free, low-effort starters, each with a reason that is honest
 * about when it does NOT apply. Nothing here is a prediction of success.
 */
export function recommendChannels(ctx: GuideContext): ChannelRecommendation[] {
  const picked: ChannelRecommendation[] = []
  const seen = new Set<GuideChannelId>()

  if (ctx.hasSavedStrategy) {
    for (const raw of ctx.strategyChannels) {
      const channel = matchChannel(raw)
      if (!channel || seen.has(channel.id)) continue
      seen.add(channel.id)
      picked.push({
        channel,
        why: `You chose ${channel.label} in your advertising strategy.`,
        source: "your-strategy",
      })
    }
  }

  for (const id of STARTER_ORDER) {
    if (picked.length >= 3) break
    if (seen.has(id)) continue
    const channel = GUIDE_CHANNELS.find((entry) => entry.id === id)
    if (!channel) continue
    seen.add(id)
    picked.push({ channel, why: starterReason(id, ctx), source: "starter" })
  }

  return picked
}

function starterReason(id: GuideChannelId, ctx: GuideContext): string {
  switch (id) {
    case "facebook":
      return "Free, and it is usually the first place a new customer looks for a business like yours."
    case "google-business":
      return ctx.hasLiveSite
        ? "Free, and it is how people find a business when they search for what you do."
        : "Free, and it is how people find a business when they search for what you do. Publish your site first — the listing points at it."
    case "whatsapp":
      return "Free, and it is where customers already message you. Keep your hours, catalogue and replies in one place."
    case "email":
      return "You own this list — no algorithm sits between you and your customers. Best once you have customers to write to."
    default:
      return "Free, and it puts you where your customers already look."
  }
}

/** The places that are NOT recommended right now, with the honest reason. */
export function skippedChannels(ctx: GuideContext): { channel: GuideChannel; why: string }[] {
  const recommended = new Set(recommendChannels(ctx).map((entry) => entry.channel.id))
  const out: { channel: GuideChannel; why: string }[] = []
  for (const channel of GUIDE_CHANNELS) {
    if (recommended.has(channel.id)) continue
    if (channel.id === "tiktok") {
      out.push({
        channel,
        why: "Only worth it if you can post video several times a week. One video a month does very little.",
      })
      continue
    }
    if (channel.id === "linkedin") {
      out.push({
        channel,
        why: "Worth your time only if you sell to other businesses or freelancers.",
      })
      continue
    }
    if (channel.id === "blog") {
      out.push({
        channel,
        why: ctx.hasLiveSite
          ? "Slow to pay off, but it keeps working and nobody can take it away."
          : "Publish your site first — a blog post needs a site to live on.",
      })
      continue
    }
    out.push({ channel, why: "Free to add whenever you want it." })
  }
  return out
}

export interface FirstAction {
  id: string
  title: string
  detail: string
  kind: "do" | "ask"
}

/**
 * What to actually do in the first week. Deliberately small: a beginner
 * abandons a plan with twelve steps, and completes one with three.
 */
export function firstActions(ctx: GuideContext): FirstAction[] {
  const actions: FirstAction[] = []

  if (!ctx.hasLiveSite) {
    actions.push({
      id: "site",
      title: "Publish your site before you post anything",
      detail:
        "Every post needs somewhere to send people. Publish the site you built, then put its address in your page profile.",
      kind: "do",
    })
  } else {
    actions.push({
      id: "link",
      title: "Put your link where people will see it",
      detail:
        "Add your site address to your page profile and your WhatsApp profile so every post has a way to reach you.",
      kind: "do",
    })
  }

  actions.push({
    id: "page",
    title: "Create or claim your business page",
    detail:
      "One page, one place people can find you. Use the exact name of your business and a real photo of the work — a stock logo looks like a placeholder.",
    kind: "do",
  })

  actions.push({
    id: "post",
    title: "Post once this week",
    detail:
      "One post a week is enough to start. Say what you made, who it is for, and one clear thing to do next.",
    kind: "do",
  })

  actions.push({
    id: "ask",
    title: "Tell five people who already know you",
    detail:
      "Ask five customers, friends or neighbours to try it and tell you what confused them. That conversation is worth more than any ad.",
    kind: "ask",
  })

  return actions
}

export interface BenchPrefill {
  offer: string
  audience: string
  /** The offer came from the founder's own plan or strategy — say so, don't hide it. */
  offerFilled: boolean
  /** The audience came from the founder's own words — say so. */
  audienceFilled: boolean
}

/** Where a prefilled value came from. The founder is told, never shown a
 * filled field with no explanation. */
export type BenchInputSource = "last-time" | "your-own-words" | "your-plan" | "none"

/** A recommended place to show up, flattened for the bench UI. */
export interface BenchChannelView {
  id: GuideChannelId
  label: string
  whatItIs: string
  whatToPost: string
  whereToPost: string
  effort: "low" | "medium" | "high"
  cost: "free" | "paid"
  why: string
  source: "your-strategy" | "starter"
}

/** A place that is not recommended right now, and why. */
export interface BenchOtherChannelView {
  id: GuideChannelId
  label: string
  why: string
}

/** Everything the bench shows before the founder generates anything. */
export interface BenchGuide {
  steps: { title: string; detail: string }[]
  channels: BenchChannelView[]
  others: BenchOtherChannelView[]
  firstActions: FirstAction[]
  inputs: {
    offer: string
    audience: string
    offerSource: BenchInputSource
    audienceSource: BenchInputSource
  }
  /** The pieces a beginner should draft first. */
  defaultSlots: string[]
}

/** The first sentence of a piece of text, clipped for a one-line field. */
function firstSentence(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim()
  if (!collapsed) return ""
  const stop = collapsed.search(/[.!?](\s|$)/)
  const sentence = stop > 0 ? collapsed.slice(0, stop + 1) : collapsed
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence
}

/**
 * The offer and audience, prefilled from what Atai already knows about this
 * business. The founder's own words win over the plan's, and the plan is only
 * ever a draft — never presented as the founder's decision.
 */
export function buildPrefill(ctx: GuideContext): BenchPrefill {
  const offer = firstSentence(ctx.positioning, 300)
  const audience = ctx.icp.trim() || (ctx.targetUsers ?? []).filter(Boolean).join(", ").trim()

  return {
    offer,
    audience: audience.length > 300 ? `${audience.slice(0, 299).trimEnd()}…` : audience,
    offerFilled: offer.length > 0,
    audienceFilled: audience.length > 0,
  }
}
