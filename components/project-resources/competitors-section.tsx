"use client"

import { useEffect, useRef, useState } from "react"
import { Users, Sparkles, Loader2, ExternalLink, ThumbsUp, ThumbsDown, Clock, RefreshCw, Shield, Zap, TriangleAlert } from "lucide-react"
import { toast } from "sonner"
import { postJson, type ApiError } from "@/lib/client/api"
import type { ApplicationSpecification } from "@/lib/types/specification"
import { normalizeCompetitors, type CompetitorProfile } from "@/lib/resources/competitor-schema"
import { RESOURCES_CREDIT_COSTS } from "@/lib/resources/credit-costs"

interface Props {
  projectId: string
  spec: ApplicationSpecification
  cachedCompetitors?: { data: CompetitorProfile[]; generatedAt: number }
  credits: number
  onCreditsChanged: (n: number) => void
}

export function CompetitorsSection({ projectId, spec, cachedCompetitors, credits, onCreditsChanged }: Props) {
  const [competitors, setCompetitors] = useState<CompetitorProfile[]>(() => normalizeCompetitors(cachedCompetitors?.data).competitors)
  const [generatedAt, setGeneratedAt] = useState(cachedCompetitors?.generatedAt ?? null)
  const [generating, setGenerating] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const cost = RESOURCES_CREDIT_COSTS.competitors
  // Retain the identity across uncertain responses; ledger guards decide whether recovery is possible.
  const requestIdRef = useRef<string | null>(null)
  const inFlight = useRef(false)
  const [hasPendingRequest, setHasPendingRequest] = useState(false)
  const storageKey = `atai:competitor-request:${projectId}`

  useEffect(() => {
    try {
      requestIdRef.current = sessionStorage.getItem(storageKey)
      setHasPendingRequest(Boolean(requestIdRef.current))
    } catch { /* Storage can be unavailable in private browser contexts. */ }
  }, [storageKey])

  function rememberRequest(id: string | null) {
    requestIdRef.current = id
    setHasPendingRequest(Boolean(id))
    try {
      if (id) sessionStorage.setItem(storageKey, id)
      else sessionStorage.removeItem(storageKey)
    } catch { /* The mounted component still retains the intent. */ }
  }

  async function find() {
    if (inFlight.current) return
    if (credits < cost && !requestIdRef.current) {
      toast.error(`You need ${cost} credits to generate competitor suggestions.`)
      return
    }
    inFlight.current = true
    rememberRequest(requestIdRef.current ?? cryptoId())
    setGenerating(true)
    try {
      const data = await postJson<{ competitors: CompetitorProfile[]; generatedAt: number; availableCredits: number; note?: string }>(
        `/api/projects/${projectId}/resources/competitors`,
        { requestId: requestIdRef.current },
      )
      setCompetitors(normalizeCompetitors(data.competitors).competitors)
      setGeneratedAt(data.generatedAt)
      onCreditsChanged(data.availableCredits)
      rememberRequest(null)
      toast.success(data.note || `Found ${data.competitors.length} competitor suggestions!`)
    } catch (e) {
      if ((e as ApiError).code === "RESOURCE_REQUEST_REFUNDED") rememberRequest(null)
      toast.error(e instanceof Error ? e.message : "Failed to find competitors")
    } finally {
      inFlight.current = false
      setGenerating(false)
    }
  }

  function rowKey(competitor: CompetitorProfile, index: number): string {
    return `${index}-${competitor.name}`
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Users className="size-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Competitive intelligence</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            AI-suggested competitors drawn from your business description — verify their pricing and positioning before acting on them.
          </p>
        </div>
        {competitors.length === 0 ? (
          <button
            onClick={find}
            disabled={generating || (credits < cost && !hasPendingRequest)}
            className="shrink-0 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {generating ? "Drafting suggestions…" : hasPendingRequest ? "Recover previous request" : `Suggest competitors (${cost} credits)`}
          </button>
        ) : (
          <button
            onClick={find}
            disabled={generating || (credits < cost && !hasPendingRequest)}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent disabled:opacity-40"
          >
            <RefreshCw className="size-3" />
            {hasPendingRequest ? "Recover previous request" : `New suggestions (${cost} credits)`}
          </button>
        )}
      </div>

      <p className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs leading-5 text-foreground/80">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-primary" />
        <span>
          These are <strong className="font-semibold">AI suggestions</strong>, not verified market research — no live
          websites were checked. Treat names, pricing, and funding as leads to verify. A new generation replaces the
          displayed list; it does not verify previous claims.
        </span>
      </p>

      {typeof generatedAt === "number" && Number.isFinite(generatedAt) && generatedAt > 0 && generatedAt <= 8.64e15 && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Clock className="size-3" />
          Suggestions generated {new Date(generatedAt).toISOString().slice(0, 10)} · not a research date
        </p>
      )}

      {competitors.length === 0 && !generating && (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-10 text-center">
          <Users className="mx-auto size-10 text-muted-foreground mb-3" />
          <p className="font-medium text-foreground">No competitor suggestions yet</p>
          <p className="mt-1 text-sm text-muted-foreground max-w-sm mx-auto">
            Click "Suggest competitors" and Atai will draft the players likely in your space — names, positioning, and
            strengths to verify.
          </p>
        </div>
      )}

      {competitors.length > 0 && (
        <div className="space-y-4">
          {competitors.map((c, i) => {
            const key = rowKey(c, i)
            return (
            <div key={key} className="rounded-xl border border-border bg-card overflow-hidden">
              <button
                type="button"
                aria-expanded={expanded === key}
                onClick={() => setExpanded(expanded === key ? null : key)}
                className="w-full min-w-0 break-words p-4 text-left hover:bg-accent/50 transition-colors"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs font-bold text-muted-foreground">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-foreground">{c.name}</p>
                        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">AI suggestion · needs verification</span>
                        {c.fundingStatus && (
                          <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                            {c.fundingStatus}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-sm text-muted-foreground">{c.tagline}</p>
                    </div>
                  </div>
                  <p className="min-w-0 break-words text-xs text-muted-foreground">{c.pricing}</p>
                </div>
              </button>
              {c.url && (
                <a href={c.url} target="_blank" rel="noopener noreferrer" className="mx-4 mb-3 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  <ExternalLink className="size-3.5" aria-hidden /> Suggested website for {c.name} · not evidence
                </a>
              )}

              {expanded === key && (
                <div className="border-t border-border p-4 space-y-4">
                  {c.targetCustomer && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Who they serve</p>
                      <p className="text-sm text-foreground">{c.targetCustomer}</p>
                    </div>
                  )}

                  {c.competitiveEdge && (
                    <div className="rounded-lg bg-primary/5 border border-primary/20 p-3">
                      <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1 flex items-center gap-1">
                        <Zap className="size-3" /> Their claimed competitive edge
                      </p>
                      <p className="text-sm text-foreground">{c.competitiveEdge}</p>
                    </div>
                  )}

                  <div className="grid gap-4 sm:grid-cols-2">
                    {c.strengths && c.strengths.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 mb-2">
                          <ThumbsUp className="size-3" /> Suggested strengths
                        </p>
                        <ul className="space-y-1">
                          {c.strengths.map((s, si) => (
                            <li key={`${key}-strength-${si}`} className="text-sm text-muted-foreground flex items-start gap-1.5">
                              <Shield className="size-3 shrink-0 mt-0.5 text-emerald-500" />
                              {s}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {c.weaknesses && c.weaknesses.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1 mb-2">
                          <ThumbsDown className="size-3" /> Suggested weaknesses
                        </p>
                        <ul className="space-y-1">
                          {c.weaknesses.map((w, wi) => (
                            <li key={`${key}-weakness-${wi}`} className="text-sm text-muted-foreground flex items-start gap-1.5">
                              <span className="mt-1 size-1.5 shrink-0 rounded-full bg-rose-400" />
                              {w}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {(c.businessModel || c.founded) && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      {c.businessModel && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Suggested business model</p>
                          <p className="text-sm text-muted-foreground">{c.businessModel}</p>
                        </div>
                      )}
                      {c.founded && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Founded (unverified)</p>
                          <p className="text-sm text-muted-foreground">{c.founded}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Idempotency identity on the wire — charset matches the ledger's accepted
 * intent format (UUIDs use only [0-9a-f-]). */
function cryptoId(): string {
  return globalThis.crypto.randomUUID()
}
