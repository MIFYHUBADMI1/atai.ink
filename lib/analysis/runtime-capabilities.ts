/**
 * Atai Runtime capability vocabulary for the Collaborate workspace.
 *
 * Single source of truth for what the FINISHED application can consume from
 * Atai: the Runtime API capabilities and the @atai-group/sdk namespaces that wrap
 * them. The co-founder AI uses this block to ground integration advice in
 * what actually exists (spec section 50 — never invent capabilities), and to
 * keep the plan's Runtime & Integrations section aligned with the runtime
 * contract in `runtime/contracts/router.ts`.
 *
 * Kept as plain strings/constants — no server-only imports — so tests and
 * future client tooling can consume it too. Mirror of CAPABILITY_OPERATIONS;
 * descriptions are product language, not provider names (provider neutrality
 * is a runtime invariant — generated apps never learn which provider runs).
 */

export interface RuntimeCapabilitySummary {
  /** Capability ID on the wire (`capability` field of the Runtime request). */
  readonly capability: string
  /** SDK namespace on the Atai client (e.g. `atai.ai`). */
  readonly sdk: string
  /** Provider-neutral operations the capability exposes. */
  readonly operations: readonly string[]
  /** One-line, founder-friendly description of what it's for. */
  readonly description: string
  /** Founder-facing examples of features this capability powers. */
  readonly examples: readonly string[]
}

export const RUNTIME_CAPABILITY_SUMMARIES: readonly RuntimeCapabilitySummary[] = [
  {
    capability: "ai.text",
    sdk: "atai.ai",
    operations: ["chat", "completion", "embed"],
    description: "AI text generation — the app can think, write, and answer.",
    examples: ["support assistants", "content generation", "summarization", "smart replies"],
  },
  {
    capability: "ai.speak",
    sdk: "atai.voice",
    operations: ["synthesize"],
    description: "Text-to-speech — turn text into natural audio.",
    examples: ["voiceovers", "audio articles", "spoken notifications"],
  },
  {
    capability: "search.web",
    sdk: "atai.search",
    operations: ["web"],
    description: "Web search — query the open web for fresh results.",
    examples: ["research tools", "news feeds", "price checks"],
  },
  {
    capability: "web.scrape",
    sdk: "atai.web",
    operations: ["scrape"],
    description: "Scrape a public URL into clean markdown content.",
    examples: ["link previews", "article import", "catalog syncing"],
  },
  {
    capability: "email",
    sdk: "atai.email",
    operations: ["send"],
    description: "Transactional email — send messages to users.",
    examples: ["welcome emails", "receipts", "password resets", "digests"],
  },
  {
    capability: "notifications",
    sdk: "atai.notifications",
    operations: ["send"],
    description: "Realtime notifications — broadcast live updates to subscribed app clients.",
    examples: ["new-order alerts", "activity nudges", "announcements"],
  },
  {
    capability: "maps",
    sdk: "atai.maps",
    operations: ["geocode", "reverseGeocode"],
    description: "Geocoding — addresses to coordinates and back.",
    examples: ["location search", "delivery zones", "store locators"],
  },
  {
    capability: "calendar",
    sdk: "atai.calendar",
    operations: ["listBookings", "createBooking"],
    description: "Scheduling — list and create calendar bookings.",
    examples: ["appointment booking", "availability views", "reminders"],
  },
  {
    capability: "vectors",
    sdk: "atai.vectors",
    operations: ["upsert", "search", "delete"],
    description: "Vector storage — semantic search over embeddings.",
    examples: ["semantic search", "recommendations", "RAG knowledge bases"],
  },
  {
    capability: "db",
    sdk: "atai.db",
    operations: ["query", "create", "edit", "delete"],
    description: "The application's runtime database — records in, records out.",
    examples: ["saved user data", "order history", "app content"],
  },
  {
    capability: "payments",
    sdk: "atai.payments",
    operations: ["createCheckout", "createSubscription", "listPayments", "listPayouts"],
    description: "Checkout sessions, recurring subscriptions, and the read-only payment/payout feed.",
    examples: ["one-time purchases", "order checkout", "paid upgrades", "subscription plans", "payment feeds"],
  },
  {
    capability: "health",
    sdk: "atai.health",
    operations: ["check"],
    description: "Connectivity check — verify the runtime credential works.",
    examples: ["startup self-check", "status pages"],
  },
]

/**
 * Compact context block appended to every co-founder request (chat, analyze,
 * auto-complete). Deliberately terse — it ships on every AI call — but
 * complete enough that the AI never invents a capability Atai doesn't have.
 */
export const RUNTIME_AWARENESS_BLOCK = `ATAI RUNTIME CAPABILITIES (what the finished application can use):
Every application built from this plan talks to Atai through the official @atai-group/sdk with a project-scoped runtime API key (ATAI_API_KEY) that Atai provisions automatically — no provider accounts or provider keys are ever needed. Capabilities the plan names are wired into the generated app and billed as part of its runtime usage:
${RUNTIME_CAPABILITY_SUMMARIES.map((c) => `- ${c.capability} (${c.sdk}.${c.operations[0]}) — ${c.description} e.g. ${c.examples.slice(0, 2).join(", ")}.`).join("\n")}
End-user sign-in inside the generated app is handled by its built-in auth (Totalum SDK), not a runtime capability.
When the founder describes a feature that needs one of these capabilities, ground it in this exact vocabulary and reflect it in the "Runtime & Integrations" plan section — name the capabilities, what each is used for, and keep it in business language.

THE ROUTING RULE — STATE IT EVERY TIME A CAPABILITY COMES UP:
Whenever anything you write or review touches payments, checkout, subscriptions or transactions, AI text, speech, web search, page scraping, email, realtime notifications, maps or geocoding, bookings, or semantic search, you must name the Atai capability that serves it AND state the route out loud: @atai-group/sdk with the project's ATAI_API_KEY. Never leave such a line silent about where it runs — write it as "checkout via atai.payments (@atai-group/sdk, ATAI_API_KEY), no external gateway", not "checkout". Naming an external provider as the implementation — Stripe, PayPal, Razorpay, OpenAI, Anthropic, Google Maps, Mapbox, SendGrid, Resend, ElevenLabs, Twilio, Pinecone, SerpAPI, Cal.com or any other — is always wrong, in every section, even when the founder asks for it by name: recommend the Atai capability instead and say why.

HOW TO CALL ATAI (never invent alternatives):
- Package: @atai-group/sdk — import { Atai } from "@atai-group/sdk"
- Client: new Atai({ apiKey: process.env.ATAI_API_KEY }) — Atai provisions ATAI_API_KEY. Never ask for provider keys such as OpenAI, Stripe, or Resend.
- Default origin https://atai.ink, path /api/runtime/v1 (the SDK sets this). Do not hardcode api.openai.com, stripe.com, or any other provider URL.
- Auth header: Authorization: Bearer atai_<environment>_<secret>
- Call capabilities only from server-side code. Full contract: https://atai.ink/sdk
The "Runtime & Integrations" section is this product's Atai runtime contract. It MUST name @atai-group/sdk, ATAI_API_KEY, /api/runtime/v1, and only catalog capabilities this product needs. Generic infrastructure lists (data storage, file storage, websockets, background jobs, admin dashboards, unnamed third-party APIs) are wrong.`

/** True when Runtime & Integrations is the Atai contract, not generic infra. */
export function isRuntimeIntegrationsGrounded(text: string): boolean {
  const value = text.trim()
  if (!value) return false
  const hasContract =
    /@atai-group\/sdk/i.test(value) ||
    /ATAI_API_KEY/i.test(value) ||
    /\/api\/runtime\/v1/i.test(value)
  const hasCapability = RUNTIME_CAPABILITY_SUMMARIES.some(
    (c) => value.includes(c.capability) || value.includes(c.sdk),
  )
  return hasContract && hasCapability
}

export interface UnsupportedRuntimeClaim {
  /** The plan line that promises something the runtime cannot execute. */
  readonly quote: string
  /** Founder-safe guidance: what exists instead, and what NOT to invent. */
  readonly note: string
}

// Each entry is verified against the runtime contract: the operation the plan
// implies is absent from the catalog above. Never treat an SDK method quoted
// by an AI-generated plan as proof it exists.
const UNSUPPORTED_CLAIM_PATTERNS: ReadonlyArray<{ pattern: RegExp; note: string }> = [
  {
    pattern: /\brefund(s|ed|ing)?\b/i,
    note: "Automatic refunds are not a runtime capability — atai.payments exposes createCheckout, createSubscription, listPayments and listPayouts only. Track refund policy as app data with a manual step in the payment dashboard; never invent an SDK refund call and never add an external gateway.",
  },
  {
    pattern: /\bsubscription cancell?ation\b|\bcancell?ing (a |the |their |my )?subscription\b|\bself-cancel\b/i,
    note: "Cancelling a subscription through the runtime is not supported — there is no cancel operation on atai.payments. Model cancellation as app-side entitlement state the owner can action, and handle the provider-side subscription manually; never invent an SDK call for it.",
  },
  {
    pattern: /\b(sms|text message|phone call|voice call)\b/i,
    note: "SMS and voice calls are not runtime capabilities. Use email or realtime notifications for the same job; do not integrate a messaging provider.",
  },
]

/** Scans plan text for promises the Atai runtime cannot keep. */
export function unsupportedRuntimeClaims(sources: Array<string | string[] | undefined>): UnsupportedRuntimeClaim[] {
  const found: UnsupportedRuntimeClaim[] = []
  for (const source of sources) {
    for (const chunk of Array.isArray(source) ? source : [source ?? ""]) {
      for (const line of chunk.split("\n")) {
        const trimmed = line.trim().replace(/^[-*]\s+/, "")
        if (trimmed.length < 3) continue
        for (const { pattern, note } of UNSUPPORTED_CLAIM_PATTERNS) {
          if (!pattern.test(trimmed)) continue
          if (found.some((f) => f.quote === trimmed)) break
          found.push({ quote: trimmed, note })
          break
        }
      }
    }
  }
  return found
}

export interface ExternalProviderClaim {
  /** The plan line that names a provider instead of the runtime. */
  readonly quote: string
  /** The runtime capability that serves this need instead. */
  readonly capability: string
  /** The SDK namespace to write into the plan. */
  readonly sdk: string
  /** What the line named, in founder-friendly terms. */
  readonly provider: string
  /** The one route the plan must state instead. */
  readonly note: string
}

/** Provider names that stand for a capability the Atai runtime already owns.
 * A line only counts as a claim when it names one of these — the bare gateway
 * words double as ordinary English ("paddle surfing", "public square"), so the
 * payments rule additionally requires money context on the same line. */
const EXTERNAL_PROVIDER_RULES: ReadonlyArray<{
  pattern: RegExp
  capability: string
  sdk: string
  provider: string
  context?: RegExp
}> = [
  {
    pattern: /\b(stripe|paypal|braintree|razorpay|lemonsqueezy|paddle|square|alipay|wechat ?pay|dodopayments)\b/i,
    capability: "payments",
    sdk: "atai.payments",
    provider: "an external payment gateway",
    context:
      /\b(paid|pay\w*|payment\w*|checkout|billing|invoice|refund\w*|price|pricing|charge|fee|monetiz\w*|revenue|commission|transaction|card|subscription)\b/i,
  },
  {
    pattern: /\b(openai|chatgpt|gpt-[45o]\w*|anthropic|claude|gemini|mistral|cohere|deepseek|hugging ?face)\b/i,
    capability: "ai.text",
    sdk: "atai.ai",
    provider: "an external AI provider",
  },
  {
    pattern: /\b(elevenlabs|speechify|play\.ht|azure speech|whisper api|text-to-speech api)\b/i,
    capability: "ai.speak",
    sdk: "atai.voice",
    provider: "an external speech provider",
  },
  {
    pattern: /\b(google ?maps|mapbox|here (?:maps|api)|tomtom|openstreetmap|foursquare|geoapify)\b/i,
    capability: "maps",
    sdk: "atai.maps",
    provider: "an external maps/geocoding provider",
  },
  {
    pattern: /\b(sendgrid|mailgun|resend|postmark|mailjet|amazon ses|aws ses|smtp provider)\b/i,
    capability: "email",
    sdk: "atai.email",
    provider: "an external email provider",
  },
  {
    pattern: /\b(twilio|vonage|firebase (?:cloud )?messaging|\bfcm\b|onesignal|sms api)\b/i,
    capability: "notifications",
    sdk: "atai.notifications",
    provider: "an external messaging provider",
  },
  {
    pattern: /\b(serp ?api|brave search api|bing (?:web )?search api|firecrawl|scrapingbee|apify|rapidapi|tavily)\b/i,
    capability: "search.web",
    sdk: "atai.search",
    provider: "an external search/scraping provider",
  },
  {
    pattern: /\b(cal\.com|cronofyr|google calendar api|microsoft graph calendar|acuity|chronoquery)\b/i,
    capability: "calendar",
    sdk: "atai.calendar",
    provider: "an external scheduling provider",
  },
  {
    pattern: /\b(pinecone|weaviate|qdrant|chroma(?: ?db)?|milvus|faiss|pgvector)\b/i,
    capability: "vectors",
    sdk: "atai.vectors",
    provider: "an external vector store",
  },
]

/** Scans plan text for capabilities attributed to an outside provider rather
 * than the Atai runtime — the same defect the RUNTIME ROUTING RULE forbids,
 * caught with code so a plan can never carry it silently into a build. */
export function externalProviderClaims(
  sources: Array<string | string[] | undefined>,
): ExternalProviderClaim[] {
  const found: ExternalProviderClaim[] = []
  for (const source of sources) {
    for (const chunk of Array.isArray(source) ? source : [source ?? ""]) {
      for (const line of chunk.split("\n")) {
        const trimmed = line.trim().replace(/^[-*]\s+/, "")
        if (trimmed.length < 3) continue
        for (const rule of EXTERNAL_PROVIDER_RULES) {
          if (!rule.pattern.test(trimmed)) continue
          if (rule.context && !rule.context.test(trimmed)) continue
          if (found.some((f) => f.quote === trimmed)) break
          found.push({
            quote: trimmed,
            capability: rule.capability,
            sdk: rule.sdk,
            provider: rule.provider,
            note: `Route it through ${rule.sdk} (capability ${rule.capability}) with @atai-group/sdk and the project's ATAI_API_KEY. ${rule.provider} names are not an implementation option here — do not install it, do not ask the founder for its key, and do not offer it as a fallback.`,
          })
          break
        }
      }
    }
  }
  return found
}

/** True when this plan text sends a runtime-owned capability to an outside provider. */
export function mentionsExternalProvider(text: string): boolean {
  return externalProviderClaims([text]).length > 0
}
