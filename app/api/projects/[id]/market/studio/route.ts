import { z } from "zod"
import { requireUser } from "@/lib/auth/session"
import { checkRateLimit } from "@/lib/auth/rate-limit"
import { ok, fail, handleRouteError } from "@/lib/api/respond"
import { checkProjectOwnership } from "@/lib/runtime/ownership"
import { isMarketStudioEnabled } from "@/lib/marketing/feature-flags"
import { capabilityAvailability } from "@/lib/runtime/router/adapters/availability"
import {
  MARKET_CHANNELS,
  MARKET_ASPECT_RATIOS,
  MARKET_IMAGE_QUALITIES,
  MARKET_LANGUAGES,
  MARKET_LENGTHS,
  MARKET_TONES,
  MARKET_VIDEO_DURATIONS,
  MARKET_VOICE_STYLES,
  MARKET_KIND_META,
  isMarketContentKind,
} from "@/lib/marketing/studio/market-content"
import {
  deleteMarketContent,
  generateMarketContent,
  getMarketContent,
  getMarketStudioState,
  listMarketContent,
  pollMarketVideo,
  suggestMarketContent,
} from "@/lib/marketing/studio/market-service"
import {
  MARKET_SUGGESTION_MAX_ASK,
  MARKET_SUGGESTION_MAX_INSTRUCTIONS,
} from "@/lib/marketing/studio/market-suggestion"

/**
 * Market & Grow AI studio endpoint.
 *
 * Session-authenticated + ownership-gated. Generation runs through the project
 * runtime (the project's API key when one exists) and is billed by the central
 * runtime metering path. GET is free; POST generate/poll and DELETE only touch
 * this project's own assets.
 */

const KIND_ENUM = z.enum([
  "copy",
  "email",
  "social",
  "timeline",
  "blog",
  "brief",
  "image",
  "voice",
  "video",
])

const BaseGenerateSchema = z
  .object({
    kind: KIND_ENUM,
    brief: z.string().max(2000).default(""),
    title: z.string().max(200).optional(),
    tone: z.enum(MARKET_TONES).optional(),
    language: z.enum(MARKET_LANGUAGES).optional(),
    channel: z.enum(MARKET_CHANNELS).optional(),
    channels: z.array(z.enum(MARKET_CHANNELS)).max(6).optional(),
    audience: z.string().max(400).optional(),
    length: z.enum(MARKET_LENGTHS).optional(),
    aspectRatio: z.enum(MARKET_ASPECT_RATIOS).optional(),
    quality: z.enum(MARKET_IMAGE_QUALITIES).optional(),
    voiceStyle: z.enum(MARKET_VOICE_STYLES).optional(),
    durationSeconds: z
      .union([z.literal(4), z.literal(6), z.literal(8)])
      .optional(),
    script: z.string().max(4000).optional(),
    instructions: z.string().max(MARKET_SUGGESTION_MAX_INSTRUCTIONS).optional(),
  })
  .strict()

const SuggestSchema = z
  .object({
    action: z.literal("suggest"),
    kind: KIND_ENUM,
    /** What the founder asked for, in their own words (optional). */
    ask: z.string().max(MARKET_SUGGESTION_MAX_ASK).optional(),
    /** The founder's standing direction for the AI (optional). */
    instructions: z.string().max(MARKET_SUGGESTION_MAX_INSTRUCTIONS).optional(),
  })
  .strict()

const PostSchema = z.discriminatedUnion("action", [
  BaseGenerateSchema.extend({ action: z.literal("generate") }).strict(),
  SuggestSchema,
  z.object({ action: z.literal("pollVideo"), contentId: z.string().min(1).max(80) }).strict(),
])

function capabilityReady(capability: string): { ready: boolean; missing: string[] } {
  const entry = capabilityAvailability()[capability]
  return {
    ready: Boolean(entry?.configured && entry.provider),
    missing: entry?.missingEnvVars ?? [],
  }
}

/** Every capability a kind needs (voice first writes a script). */
function requiredCapabilities(kind: string): string[] {
  if (!isMarketContentKind(kind)) return []
  const primary = MARKET_KIND_META[kind].capability
  return kind === "voice" ? ["ai.text", primary] : [primary]
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await params
    const ownership = await checkProjectOwnership(user.id, id)
    if (!ownership.ok) return fail("UNAUTHORIZED_PROJECT_ACCESS", "We couldn't find this project.", 404)

    if (!isMarketStudioEnabled()) {
      return ok({ enabled: false, capabilities: [], items: [], creditsAvailable: null })
    }

    const contentId = new URL(req.url).searchParams.get("contentId")
    if (contentId) {
      const item = await getMarketContent(id, contentId)
      if (!item) return fail("NOT_FOUND", "We couldn't find this asset.", 404)
      return ok(item)
    }

    const state = await getMarketStudioState(user.id, id)
    const items = await listMarketContent(id)
    return ok({ enabled: true, ...state, items })
  } catch (e) {
    return handleRouteError("api.projects.market.studio.get", e)
  }
}

import { withAiProtection } from "@/lib/api/ai-protection"

export const POST = withAiProtection("studio", post)

async function post(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await params

    const ownership = await checkProjectOwnership(user.id, id)
    if (!ownership.ok) return fail("UNAUTHORIZED_PROJECT_ACCESS", "We couldn't find this project.", 404)

    if (!isMarketStudioEnabled()) {
      return fail("FEATURE_DISABLED", "The AI content studio isn't available right now.", 403)
    }

    const parsed = PostSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return fail("VALIDATION", "Please check the brief and try again.", 422)
    }

    // Suggestions and generations are metered separately so asking for an idea
    // never eats the budget for building the asset.
    await checkRateLimit({
      action: parsed.data.action === "suggest" ? "market_studio_suggest" : "market_studio_generate",
      identifier: user.id,
      limit: parsed.data.action === "suggest" ? 60 : 30,
      windowMs: 60 * 60 * 1000,
    })

    if (parsed.data.action === "pollVideo") {
      const item = await pollMarketVideo({
        userId: user.id,
        projectId: id,
        contentId: parsed.data.contentId,
      })
      return ok(item)
    }

    if (parsed.data.action === "suggest") {
      const readiness = capabilityReady("ai.text")
      if (!readiness.ready) {
        return fail(
          "AI_UNAVAILABLE",
          readiness.missing.length > 0
            ? `This capability isn't configured on this deployment (missing ${readiness.missing.join(", ")}).`
            : "This AI capability isn't wired on this deployment yet.",
          503,
        )
      }
      const result = await suggestMarketContent({
        userId: user.id,
        projectId: id,
        kind: parsed.data.kind,
        ...(parsed.data.ask ? { ask: parsed.data.ask } : {}),
        ...(parsed.data.instructions ? { instructions: parsed.data.instructions } : {}),
      })
      return ok(result)
    }

    const capabilities = requiredCapabilities(parsed.data.kind)
    for (const capability of capabilities) {
      const readiness = capabilityReady(capability)
      if (!readiness.ready) {
        return fail(
          "AI_UNAVAILABLE",
          readiness.missing.length > 0
            ? `This capability isn't configured on this deployment (missing ${readiness.missing.join(", ")}).`
            : "This AI capability isn't wired on this deployment yet.",
          503,
        )
      }
    }

    const item = await generateMarketContent({
      userId: user.id,
      projectId: id,
      kind: parsed.data.kind,
      brief: parsed.data.brief,
      ...(parsed.data.title ? { title: parsed.data.title } : {}),
      ...(parsed.data.tone ? { tone: parsed.data.tone } : {}),
      ...(parsed.data.language ? { language: parsed.data.language } : {}),
      ...(parsed.data.channel ? { channel: parsed.data.channel } : {}),
      ...(parsed.data.channels ? { channels: parsed.data.channels } : {}),
      ...(parsed.data.audience ? { audience: parsed.data.audience } : {}),
      ...(parsed.data.length ? { length: parsed.data.length } : {}),
      ...(parsed.data.aspectRatio ? { aspectRatio: parsed.data.aspectRatio } : {}),
      ...(parsed.data.quality ? { quality: parsed.data.quality } : {}),
      ...(parsed.data.voiceStyle ? { voiceStyle: parsed.data.voiceStyle } : {}),
      ...(parsed.data.durationSeconds ? { durationSeconds: parsed.data.durationSeconds } : {}),
      ...(parsed.data.script ? { script: parsed.data.script } : {}),
      ...(parsed.data.instructions ? { instructions: parsed.data.instructions } : {}),
    })

    return ok(item)
  } catch (e) {
    return handleRouteError("api.projects.market.studio.post", e)
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await params
    const ownership = await checkProjectOwnership(user.id, id)
    if (!ownership.ok) return fail("UNAUTHORIZED_PROJECT_ACCESS", "We couldn't find this project.", 404)

    const contentId = new URL(req.url).searchParams.get("contentId")
    if (!contentId) return fail("VALIDATION", "Missing asset id.", 422)

    const deleted = await deleteMarketContent({ userId: user.id, projectId: id, contentId })
    if (!deleted) return fail("NOT_FOUND", "We couldn't find this asset.", 404)
    return ok({ deleted: true })
  } catch (e) {
    return handleRouteError("api.projects.market.studio.delete", e)
  }
}
