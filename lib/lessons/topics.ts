import type { LessonStage } from "@/lib/lessons/types"
import type { LessonContext } from "@/lib/lessons/context"

/**
 * Per-stage lesson topics. The skeleton is the same for every business at the
 * same stage; the SPECIFICITY comes from the synthesis prompt, which receives
 * the full project context (spec, stage, plan health, onboarding intent) plus
 * live web research for this exact business type.
 */

export interface LessonTopic {
  key: string
  title: string
  /** What the lesson must teach, in the founder's current position. */
  focus: string
  /** Grounding query — specialized per business via the context. */
  query: (context: LessonContext) => string
}

function businessTypeOf(context: LessonContext): string {
  return context.businessType || "software product"
}

export const LESSON_TOPICS: Record<LessonStage, LessonTopic[]> = {
  planning: [
    {
      key: "validate",
      title: "Validate this idea before you build",
      focus:
        "how to pressure-test this specific business idea with real potential customers this week — interviews, landing tests, pre-orders — before spending build credits",
      query: (c) => `how to validate a ${businessTypeOf(c)} business idea customer interviews before building`,
    },
    {
      key: "positioning",
      title: "Sharpen your positioning",
      focus:
        "how to position this exact product against the alternatives its target customers already use, in one clear sentence",
      query: (c) => `product positioning for ${businessTypeOf(c)} targeting ${c.targetUsers.join(", ") || "early customers"}`,
    },
    {
      key: "pricing-model",
      title: "Choose a pricing model you can defend",
      focus:
        "how to pick a pricing model for this business — freemium, subscription, one-time, usage — with concrete price anchors for this category",
      query: (c) => `pricing models for ${businessTypeOf(c)} ${c.revenueModel ? c.revenueModel : "early stage"} pricing benchmarks`,
    },
  ],
  building: [
    {
      key: "waitlist",
      title: "Build your waitlist while the app builds",
      focus:
        "how to find and line up the first 20-50 potential users for this specific product while the build runs, so launch day has an audience",
      query: (c) => `how to build a waitlist for a ${businessTypeOf(c)} before launch`,
    },
    {
      key: "launch-prep",
      title: "Prepare launch day",
      focus:
        "a concrete launch-day checklist for this product — domain, analytics, payments, terms, first post — sized for a solo founder",
      query: (c) => `${businessTypeOf(c)} launch day checklist solo founder`,
    },
    {
      key: "one-metric",
      title: "Pick the one metric that matters",
      focus:
        "how to choose the single metric that tells this business it is working, and track it from day one",
      query: (c) => `key metric for ${businessTypeOf(c)} early stage north star`,
    },
  ],
  live: [
    {
      key: "first-customers",
      title: "Get your first 10 customers",
      focus:
        "the fastest manual, non-scalable ways to bring the first paying customers to this exact product this month",
      query: (c) => `first customers for a new ${businessTypeOf(c)} outreach tactics`,
    },
    {
      key: "feedback",
      title: "Run your first feedback sessions",
      focus:
        "how to watch real users use this product and turn what you see into the next fixes — without guiding them",
      query: (c) => `user feedback sessions early stage ${businessTypeOf(c)}`,
    },
    {
      key: "seo-start",
      title: "Start your SEO foundation",
      focus:
        "the first three articles and pages this business should publish, targeting what its customers actually search for",
      query: (c) => `seo keywords for ${businessTypeOf(c)} ${c.targetUsers.join(" ") || "small business"} blog topics`,
    },
  ],
  growing: [
    {
      key: "double-down",
      title: "Double down on your best channel",
      focus:
        "how to identify which acquisition channel is actually working for this business and put most of the effort there",
      query: (c) => `best acquisition channels for growing ${businessTypeOf(c)}`,
    },
    {
      key: "retention",
      title: "Fix retention before acquisition",
      focus:
        "how to measure whether users come back to this product, and the cheapest experiments that make them stay",
      query: (c) => `retention improvement tactics ${businessTypeOf(c)}`,
    },
    {
      key: "systematize",
      title: "Systematize with automation and help",
      focus:
        "what a solo founder should automate first (AI agents, templates, workflows) and which role to hire or contract first",
      query: (c) => `automating a solo founder ${businessTypeOf(c)} business with AI agents`,
    },
  ],
}

const STOP_WORDS = new Set([
  "the", "a", "an", "for", "of", "to", "and", "or", "your", "you", "with", "on", "in", "is", "it",
  "how", "what", "this", "that", "before", "after", "first", "best", "get", "fix", "run", "start",
])

function wordsOf(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
}

/**
 * Deterministically pick the videos for one lesson from the pack's YouTube
 * search results: score each video by word overlap between its title and the
 * topic's title+focus, take the top ones. Zero matches falls back to the
 * first results so a good video is never dropped by a wording mismatch.
 */
export function matchVideosToTopic(
  topic: LessonTopic,
  topicContext: string,
  videos: { title: string; url: string }[],
  max: number,
): { title: string; url: string }[] {
  const topicWords = new Set([...wordsOf(topic.title), ...wordsOf(topic.focus), ...wordsOf(topicContext)])
  const scored = videos.map((video, index) => {
    let score = 0
    for (const word of wordsOf(video.title)) {
      if (topicWords.has(word)) score += 1
    }
    return { video, score, index }
  })
  scored.sort((a, b) => b.score - a.score || a.index - b.index)
  const picked = scored.slice(0, max).map((entry) => entry.video)
  return picked
}
