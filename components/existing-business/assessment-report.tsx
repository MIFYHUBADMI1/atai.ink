"use client"

import Link from "next/link"
import { ArrowRight, ListChecks, Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { AssessmentFinding, BusinessAssessment } from "@/lib/types/business-intake"
import { formatTimestamp } from "@/lib/client/format"
import { completeAssessmentResult } from "@/lib/existing-business/intake-view"
import { cn } from "@/lib/utils"

const BASIS_LABEL: Record<AssessmentFinding["basis"], string> = {
  observed: "Observed",
  inferred: "Inferred",
  owner_stated: "You said",
  assumption: "Assumption",
}

const BASIS_TONE: Record<AssessmentFinding["basis"], string> = {
  observed: "bg-primary/10 text-primary",
  inferred: "bg-secondary text-secondary-foreground",
  owner_stated: "bg-secondary text-secondary-foreground",
  assumption: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
}

const HORIZON_LABEL: Record<"immediate" | "short_term" | "later", string> = {
  immediate: "Do first",
  short_term: "Next",
  later: "Later",
}

/** A titled block inside the assessment. Sections, not cards — the report
 * already sits inside the step card, and nesting boxes made it unreadable. */
function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="border-t border-border/70 pt-6">
      <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      {hint ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{hint}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function FindingList({ findings }: { findings: AssessmentFinding[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {findings.map((finding, index) => (
        <li key={`${finding.title}-${index}`} className="border-l-2 border-border pl-3">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-medium">{finding.title}</h4>
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", BASIS_TONE[finding.basis])}>
              {BASIS_LABEL[finding.basis]}
            </span>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{finding.detail}</p>
          {finding.evidence ? (
            <p className="mt-1 text-[11px] text-muted-foreground/80">
              <span className="font-medium">Source:</span> {finding.evidence}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

export function AssessmentReport({
  assessment: stored,
  onShowReading,
}: {
  assessment: BusinessAssessment
  /** Opens the read itself. Omitted where there is nothing to open. */
  onShowReading?: () => void
}) {
  // A row written by an older parser can be missing a section. Fill the shape
  // rather than trusting storage — `evidence.websiteAnalysed` on `undefined`
  // used to take the whole page down.
  const assessment = completeAssessmentResult(stored) ?? stored
  const evidence = assessment.evidence
  const opportunities = [
    ...assessment.growthOpportunities,
    ...assessment.technicalOpportunities,
    ...assessment.marketingOpportunities,
  ]

  return (
    <div className="flex flex-col gap-6" data-atai-tour="existing-business-assessment">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">The short version</p>
        <p className="mt-2 whitespace-pre-wrap text-base leading-7">{assessment.understanding}</p>
        {assessment.currentPosition ? (
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{assessment.currentPosition}</p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-muted-foreground">Built only from:</span>
          <EvidenceChip
            ok={evidence.websiteAnalysed}
            label={evidence.websiteAnalysed ? `Your site · ${evidence.pagesCrawled} page(s)` : "Your site · not read"}
            {...(evidence.websiteAnalysed && onShowReading ? { onClick: onShowReading } : {})}
          />
          <EvidenceChip ok={evidence.ownerDescription} label={evidence.ownerDescription ? "Your description" : "No description"} />
          <EvidenceChip ok={evidence.domainVerified} label={evidence.domainVerified ? "Verified domain" : "Domain not proven"} />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Anything not backed by those sources is labelled as an assumption. No traffic, revenue or ranking numbers are
          invented.
        </p>
      </div>

      {assessment.priorities.length ? (
        <Section
          title="Do this first"
          hint="Each one points at the screen that carries it out. Where Atai cannot do the work itself, it says what it needs from you."
        >
          <ol className="flex flex-col gap-3">
            {assessment.priorities.map((priority, index) => (
              <li key={`${priority.title}-${index}`} className="rounded-xl border border-border/70 bg-background/60 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 font-mono text-[11px] font-semibold text-primary">
                    {index + 1}
                  </span>
                  <h4 className="text-sm font-semibold">{priority.title}</h4>
                  <Badge variant="secondary">{HORIZON_LABEL[priority.priority]}</Badge>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{priority.explanation}</p>
                <dl className="mt-2 flex flex-col gap-1 text-xs">
                  <div>
                    <dt className="inline font-medium">Why it matters: </dt>
                    <dd className="inline text-muted-foreground">{priority.whyItMatters}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium">Expected direction: </dt>
                    <dd className="inline text-muted-foreground">{priority.expectedOutcome}</dd>
                  </div>
                </dl>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {priority.route ? (
                    <Link
                      href={priority.route}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {priority.ataiSection}
                      <ArrowRight className="size-3.5" />
                    </Link>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">
                      {priority.ataiSection} — no dedicated screen for this yet; work it with your co-founder.
                    </span>
                  )}
                  <span className="text-[11px] text-muted-foreground">
                    {priority.executableNow
                      ? "Atai can carry this out with you."
                      : priority.needs
                        ? `Needs ${priority.needs}.`
                        : "This one is yours to do, with Atai's guidance."}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      {assessment.strengths.length || assessment.challenges.length ? (
        <Section title="What is working, what is in the way">
          <div className="grid gap-6 sm:grid-cols-2">
            {assessment.strengths.length ? (
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Working</p>
                <div className="mt-2">
                  <FindingList findings={assessment.strengths} />
                </div>
              </div>
            ) : null}
            {assessment.challenges.length ? (
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">In the way</p>
                <div className="mt-2">
                  <FindingList findings={assessment.challenges} />
                </div>
              </div>
            ) : null}
          </div>
        </Section>
      ) : null}

      {opportunities.length ? (
        <Section title="Opportunities">
          <FindingList findings={opportunities} />
        </Section>
      ) : null}

      {assessment.actionPlan.length ? (
        <Section title="Action plan">
          <div className="flex flex-col gap-4">
            {assessment.actionPlan.map((horizon) => (
              <div key={horizon.horizon}>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  {HORIZON_LABEL[horizon.horizon]}
                </p>
                <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed">
                  {horizon.items.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {assessment.openQuestions.length ? (
        <Section
          title="Questions only you can answer"
          hint="Answering these in the co-founder chat sharpens every later recommendation."
        >
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed">
            {assessment.openQuestions.map((question, index) => (
              <li key={index}>{question}</li>
            ))}
          </ul>
        </Section>
      ) : null}

      <p className="flex items-center gap-2 border-t border-border/70 pt-4 text-[11px] text-muted-foreground">
        <ListChecks className="size-3.5 text-primary" />
        {assessment.generatedAt > 0
          ? `Generated ${formatTimestamp(assessment.generatedAt)} — written from the evidence above, not from guesswork about your numbers.`
          : "Written from the evidence above, not from guesswork about your numbers."}
      </p>
    </div>
  )
}

function EvidenceChip({ ok, label, onClick }: { ok: boolean; label: string; onClick?: () => void }) {
  const className = cn(
    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
    ok ? "border-success/30 bg-success/10 text-success" : "border-border bg-secondary/60 text-muted-foreground",
    onClick && "transition-colors hover:border-success/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  )
  const content = (
    <>
      <Sparkles className="size-2.5" />
      {label}
    </>
  )
  return onClick ? (
    <button type="button" onClick={onClick} className={className} title="See what was read">
      {content}
    </button>
  ) : (
    <span className={className}>{content}</span>
  )
}
