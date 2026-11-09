"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ExternalLink, Film, History, Loader2, PlayCircle, RefreshCw, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { MarkdownArticle } from "@/components/resources/markdown-article"
import { LESSON_STAGE_META, type LessonStage } from "@/lib/lessons/types"

/**
 * The personal lesson pack panel: the founder's current AI-written pack plus
 * the control to write a fresh one (credit-charged, refunded on failure —
 * the server owns all of that; this surface only reports outcomes honestly).
 */

export interface GeneratedLessonItem {
  id: string
  title: string
  stage: LessonStage
  bodyMarkdown: string
  sources: { title: string; url: string; kind: "web" | "video" | "resource" }[]
  videos: { title: string; url: string }[]
  grounded: boolean
  createdAt: number
}

export interface LessonsPackView {
  packId: string
  version: number
  generatedAt: number
  contextSnapshot: { state: string; stage: LessonStage; planPercent: number | null }
  stale: boolean
}

const GENERATION_STEPS = [
  "Reading where your business stands",
  "Researching live sources for your business",
  "Writing your three lessons",
  "Saving the pack to this project",
]

function formatDate(ms: number) {
  return new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
}

export function LessonsPackPanel({
  projectId,
  hasSignal,
  cost,
  available,
  pack,
  lessons: initialLessons,
  archivedCount,
}: {
  projectId: string
  hasSignal: boolean
  cost: number
  available: number
  pack: LessonsPackView | null
  lessons: GeneratedLessonItem[]
  archivedCount: number
}) {
  const router = useRouter()
  const [lessons, setLessons] = useState<GeneratedLessonItem[]>(initialLessons)
  const [packView, setPackView] = useState<LessonsPackView | null>(pack)
  const [running, setRunning] = useState(false)
  const [activeStep, setActiveStep] = useState(0)
  const intentRef = useRef<string | null>(null)

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => {
      setActiveStep((step) => Math.min(step + 1, GENERATION_STEPS.length - 1))
    }, 20_000)
    return () => window.clearInterval(timer)
  }, [running])

  async function generate() {
    setRunning(true)
    setActiveStep(0)
    if (!intentRef.current) {
      intentRef.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `lessons_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    }
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/lessons`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: intentRef.current }),
      })
      const json = await response.json()
      // The server answered definitively — this attempt is settled, so the
      // next click is a new operation with its own intent id.
      intentRef.current = null
      if (!response.ok || !json.ok) {
        const code = json?.error?.code
        const message = json?.error?.message ?? "The lesson pack couldn't be written."
        toast.error(code === "INSUFFICIENT_CREDITS" ? "Not enough credits for a lesson pack." : message)
        return
      }
      const data = json.data as { lessons: GeneratedLessonItem[]; pack: LessonsPackView }
      setLessons(data.lessons)
      setPackView(data.pack)
      toast.success("Your lesson pack is ready.")
      router.refresh()
    } catch {
      // No server answer — keep the intent id so a retry cannot double-charge.
      toast.error("The lesson pack couldn't be written. Nothing was lost — try again.")
    } finally {
      setRunning(false)
    }
  }

  const snapshot = packView?.contextSnapshot
  const snapshotLine = snapshot
    ? [
        LESSON_STAGE_META[snapshot.stage]?.label ?? snapshot.stage,
        snapshot.planPercent !== null ? `plan ${snapshot.planPercent}%` : "no plan yet",
        `app state: ${snapshot.state}`,
      ].join(" · ")
    : null

  return (
    <section className="flex min-w-0 flex-col gap-4" aria-labelledby="personal-lessons">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 id="personal-lessons" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <Sparkles className="size-5 shrink-0 text-primary" /> Your personal lessons
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Written for this business from where it stands right now, with live research behind them.
          </p>
        </div>
        <Button onClick={generate} disabled={running || !hasSignal} className="w-full sm:w-auto">
          {running ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RefreshCw className="mr-2 size-4" />}
          {lessons.length > 0 ? "Write a fresh pack" : "Write my lesson pack"}
          {cost > 0 ? ` · ${cost} credits` : " · free"}
        </Button>
      </div>

      {!hasSignal ? (
        <p className="rounded-2xl border border-border bg-card p-5 text-sm leading-6 text-muted-foreground">
          Add the business idea first — lessons need something to be about.{" "}
          <Link href="/start" className="font-medium text-primary hover:underline">
            Start or update your business
          </Link>
          .
        </p>
      ) : running ? (
        <div className="rounded-2xl border border-border bg-card p-5" role="status">
          <p className="text-sm font-medium">Writing your lesson pack…</p>
          <ol className="mt-3 space-y-2">
            {GENERATION_STEPS.map((step, index) => (
              <li
                key={step}
                className={`flex items-center gap-2 text-sm ${
                  index < activeStep ? "text-muted-foreground" : index === activeStep ? "text-foreground" : "text-muted-foreground/60"
                }`}
              >
                {index === activeStep ? (
                  <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
                ) : (
                  <span
                    className={`size-1.5 shrink-0 rounded-full ${index < activeStep ? "bg-primary/60" : "bg-border"}`}
                  />
                )}
                {step}
              </li>
            ))}
          </ol>
          <p className="mt-3 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
            This usually takes a couple of minutes — the research and writing are real. If it fails, the pack is not
            written and the credits come back automatically.
          </p>
        </div>
      ) : lessons.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card p-5 text-sm leading-6 text-muted-foreground">
          No personal pack yet. A pack is three lessons for the stage this business is at — each grounded in live web
          research about businesses like yours, with steps you can take this week.
          {cost > 0 ? ` Writing one costs ${cost} credits.` : " Writing one is free on this deployment."}
        </p>
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          {packView ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono uppercase tracking-[0.14em]">
                Pack v{packView.version} · {formatDate(packView.generatedAt)}
              </span>
              {snapshotLine ? <span>{snapshotLine}</span> : null}
            </div>
          ) : null}

          {packView?.stale ? (
            <p className="rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm leading-6 text-amber-700 dark:text-amber-300">
              Your business has moved since this pack was written — the plan or the app state changed. Write a fresh
              pack when you are ready; this one is kept for reference.
            </p>
          ) : null}

          {lessons.map((lesson) => (
            <article key={lesson.id} className="min-w-0 rounded-2xl border border-border bg-card p-5 sm:p-6">
              <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-lg font-semibold tracking-tight">{lesson.title}</h3>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                    lesson.grounded
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {lesson.grounded ? "Grounded in live research" : "Written without web research"}
                </span>
              </div>
              <div className="mt-4 min-w-0">
                <MarkdownArticle markdown={lesson.bodyMarkdown} />
              </div>

              {lesson.sources.length > 0 ? (
                <div className="mt-5 border-t border-border pt-4">
                  <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Sources</p>
                  <ul className="mt-2 space-y-1.5">
                    {lesson.sources.map((source) => (
                      <li key={source.url} className="min-w-0 text-sm">
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex min-w-0 items-center gap-1.5 text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary"
                        >
                          <ExternalLink className="size-3.5 shrink-0" />
                          <span className="truncate">{source.title}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {lesson.videos.length > 0 ? (
                <div className="mt-4">
                  <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                    Videos worth watching
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {lesson.videos.map((video) => (
                      <li key={video.url} className="min-w-0 text-sm">
                        <a
                          href={video.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex min-w-0 items-center gap-1.5 text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary"
                        >
                          <Film className="size-3.5 shrink-0" />
                          <span className="truncate">{video.title}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </article>
          ))}

          {archivedCount > 0 ? (
            <p className="flex items-center gap-2 rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              <History className="size-4 shrink-0" />
              Your history keeps {archivedCount} earlier lesson{archivedCount === 1 ? "" : "s"} from previous packs —
              each written for the stage the business was at then.
            </p>
          ) : null}
        </div>
      )}
    </section>
  )
}
