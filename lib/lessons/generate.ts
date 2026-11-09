import "server-only"

import { searchWeb, type FirecrawlSearchResult } from "@/lib/integrations/firecrawl/client"
import { generateWithRetry } from "@/lib/resources/ai-retry"
import { logger } from "@/lib/logging/logger"
import { youTubeVideoId } from "@/lib/resources/media"
import { LESSON_TOPICS, matchVideosToTopic, type LessonTopic } from "@/lib/lessons/topics"
import { assembleLessonContext, type LessonContext } from "@/lib/lessons/context"
import { insertGeneratedPack } from "@/lib/lessons/generated-store"
import type { GeneratedLessonDoc, LessonSource } from "@/lib/lessons/types"
import type { MirrorProject } from "@/lib/types/project"
import type { UserOnboarding } from "@/lib/types/db"

/**
 * The personal lesson pack generator: assemble free context → ground each
 * stage topic with live web research (plus one YouTube search per pack) →
 * synthesize one lesson per topic with the project's full context → persist
 * the pack (previous pack archived, history kept).
 *
 * Honesty rules baked into the prompt: the lesson may only reference the
 * observed context given here, never invent metrics about the founder's
 * business, and must say plainly when no research was available. Every throw
 * leaves the pack unwritten — the route refunds and the founder loses nothing.
 */

const SOURCE_SNIPPET_MAX = 1200
const MAX_SOURCES_PER_LESSON = 3
const MAX_VIDEOS_PER_LESSON = 2
const WEB_SEARCH_LIMIT = 3
const VIDEO_SEARCH_LIMIT = 5
const LESSON_MAX_OUTPUT_TOKENS = 2000

export interface GeneratePackInput {
  project: MirrorProject
  onboarding?: UserOnboarding | null
}

export interface GeneratePackOutcome {
  lessons: GeneratedLessonDoc[]
  context: LessonContext
}

async function searchOrNull(query: string, limit: number): Promise<FirecrawlSearchResult[] | null> {
  try {
    const response = await searchWeb(query, { limit, scrapeOptions: { formats: ["markdown"] } })
    return response.data.web ?? []
  } catch (error) {
    logger.warn("lessons.generate", "web search failed; lesson continues ungrounded", {
      query,
      message: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

function sourcesFromResults(results: FirecrawlSearchResult[] | null): LessonSource[] {
  if (!results) return []
  return results
    .filter((result) => Boolean(result.url))
    .slice(0, MAX_SOURCES_PER_LESSON)
    .map((result) => ({
      title: result.title || result.url,
      url: result.url,
      kind: "web" as const,
    }))
}

function snippetOf(result: FirecrawlSearchResult): string {
  const body = result.markdown || result.description || ""
  return body.replace(/\s+/g, " ").trim().slice(0, SOURCE_SNIPPET_MAX)
}

function videoPoolFromResults(results: FirecrawlSearchResult[] | null): { title: string; url: string }[] {
  if (!results) return []
  const seen = new Set<string>()
  const pool: { title: string; url: string }[] = []
  for (const result of results) {
    const id = youTubeVideoId(result.url)
    if (!id || seen.has(id)) continue
    seen.add(id)
    pool.push({ title: result.title || "YouTube video", url: result.url })
    if (pool.length >= VIDEO_SEARCH_LIMIT) break
  }
  return pool
}

function onboardingLine(context: LessonContext): string {
  const parts: string[] = []
  if (context.onboarding.businessGoal) parts.push(`Goal: ${context.onboarding.businessGoal}`)
  if (context.onboarding.revenueTarget) parts.push(`Revenue target: ${context.onboarding.revenueTarget}`)
  if (context.onboarding.targetUsers) parts.push(`Audience: ${context.onboarding.targetUsers}`)
  if (context.onboarding.intent) parts.push(`Intent: ${context.onboarding.intent}`)
  return parts.join(" · ")
}

/** Drop a model-added top-level heading so the reader page owns the title. */
function stripLeadingH1(markdown: string): string {
  return markdown.replace(/^\s*#\s+[^\n]+\n+/, "").trim()
}

function contextBlock(context: LessonContext): string {
  const lines = [
    `- Business: ${context.businessName}${context.businessType ? ` — ${context.businessType}` : ""}`,
    `- Description: ${context.description || "not written yet"}`,
    `- Target customers: ${context.targetUsers.join(", ") || "not defined yet"}`,
    `- Business model: ${context.businessModel || "not defined yet"}`,
    `- Revenue model: ${context.revenueModel || "not defined yet"}`,
    `- Positioning: ${context.positioning || "not defined yet"}`,
    `- Current stage: ${context.stage} (app state: ${context.state})`,
    `- Plan: ${context.hasSpec ? `${context.planPercent}% complete` : "not written yet"}`,
  ]
  const intent = onboardingLine(context)
  if (intent) lines.push(`- Founder context: ${intent}`)
  if (context.nextSteps.length > 0) {
    lines.push(
      `- Next steps already suggested: ${context.nextSteps.map((step) => step.title).join("; ")}`,
    )
  }
  return lines.join("\n")
}

function synthesisPrompt(topic: LessonTopic, context: LessonContext, sources: LessonSource[], sourceSnippets: string[]): string {
  return `Write ONE business lesson for this founder. Be specific to THEIR business.

## Where the business stands (observed — do not contradict or invent beyond this)
${contextBlock(context)}

## This lesson
Title: ${topic.title}
Teach: ${topic.focus}

## Research for this business (live web results, already fetched)
${
  sources.length > 0
    ? sources
        .map((source, index) => `[${index + 1}] ${source.title}\nURL: ${source.url}\nExcerpt: ${sourceSnippets[index] || "(no excerpt)"}`)
        .join("\n\n")
    : "No web research was available for this lesson. Teach from established practice and say so plainly in one line — never pretend research was done."
}

## Required structure (markdown, exactly these h2 sections)
## Where you are
Two or three sentences tying THIS business's current position to the lesson topic. Use the observed stage and plan state.
## What you have done so far
Acknowledge what the observed state actually shows — no more, no less.
## What remains
## How to do it
Five to eight numbered steps for THIS business, each concrete enough to act on this week.
## Watch out for
Two or three mistakes specific to this business type and stage.
## Go deeper
Markdown links to the research sources above that are actually worth reading, with one line on why. Omit this section entirely if there are no sources.

Rules: 900-1300 words. Use the business's name and specifics throughout. Never invent numbers, customers, or results for their business. Only link the sources provided. Start directly with "## Where you are" — no title heading, no preamble, no closing questions.`
}

const SYSTEM_PROMPT = `You are a business mentor inside Atai, a platform where founders build and run real businesses. You write one focused lesson at a time for a founder whose exact business position you know. Your lessons are honest (you never invent their metrics), specific (you use their business details), and actionable (every lesson ends in steps they can take this week). You write clean markdown and nothing else.`

export async function generateLessonPack(input: GeneratePackInput): Promise<GeneratePackOutcome> {
  const context = assembleLessonContext(input.project, input.onboarding)
  const topics = LESSON_TOPICS[context.stage]

  // One YouTube search per pack, shared across the lessons — bounded cost.
  const videoResults = await searchOrNull(
    `site:youtube.com ${context.businessType || "small business"} ${context.stage} founder tutorial`,
    VIDEO_SEARCH_LIMIT,
  )
  const videoPool = videoPoolFromResults(videoResults)

  const lessons: Array<{
    topicKey: string
    title: string
    bodyMarkdown: string
    sources: LessonSource[]
    videos: { title: string; url: string }[]
    grounded: boolean
  }> = []

  for (const topic of topics) {
    const results = await searchOrNull(topic.query(context), WEB_SEARCH_LIMIT)
    const sources = sourcesFromResults(results)
    const snippets = (results ?? []).slice(0, MAX_SOURCES_PER_LESSON).map(snippetOf)

    const text = await generateWithRetry(
      { system: SYSTEM_PROMPT, prompt: synthesisPrompt(topic, context, sources, snippets) },
      { maxOutputTokens: LESSON_MAX_OUTPUT_TOKENS },
    )

    const body = stripLeadingH1(text)
    if (!body) throw new Error("Lesson synthesis returned empty output")

    lessons.push({
      topicKey: topic.key,
      title: topic.title,
      bodyMarkdown: body,
      sources,
      videos: matchVideosToTopic(topic, context.businessType, videoPool, MAX_VIDEOS_PER_LESSON),
      grounded: sources.length > 0,
    })
  }

  const docs = await insertGeneratedPack({
    userId: input.project.userId,
    projectId: input.project.id,
    stage: context.stage,
    fingerprint: context.fingerprint,
    snapshot: {
      state: context.state,
      stage: context.stage,
      planPercent: context.planPercent,
    },
    lessons,
  })

  logger.info("lessons.generate", "lesson pack generated", {
    projectId: input.project.id,
    lessons: docs.length,
    grounded: lessons.filter((lesson) => lesson.grounded).length,
    videos: videoPool.length,
  })

  return { lessons: docs, context }
}
