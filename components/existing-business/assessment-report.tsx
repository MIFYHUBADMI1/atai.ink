"use client"

import Link from "next/link"
import { ArrowRight, CircleHelp, Compass, ListChecks, Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { AssessmentFinding, BusinessAssessment } from "@/lib/types/business-intake"
import { cn } from "@/lib/utils"

const BASIS_LABEL: Record<AssessmentFinding["basis"], string> = {
  observed: "Observed in your evidence",
  inferred: "Inferred from evidence",
  owner_stated: "From your own words",
  assumption: "Assumption — needs confirming",
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

function FindingList({ title, findings }: { title: string; findings: AssessmentFinding[] }) {
  if (!findings.length) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-3">
          {findings.map((finding, index) => (
            <li key={`${finding.title}-${index}`} className="rounded-xl border border-border/70 bg-card p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-medium">{finding.title}</h4>
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", BASIS_TONE[finding.basis])}>
                  {BASIS_LABEL[finding.basis]}
                </span>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{finding.detail}</p>
              {finding.evidence ? (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  <span className="font-medium">Source:</span> {finding.evidence}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

export function AssessmentReport({ assessment }: { assessment: BusinessAssessment }) {
  const evidence = assessment.evidence
  return (
    <div className="flex flex-col gap-4" data-atai-tour="existing-business-assessment">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Compass className="size-4 text-primary" />
            What Atai could read
          </CardTitle>
          <CardDescription>
            This assessment is grounded only in the sources below. Anything not backed by them is labelled as an
            assumption, and no traffic, revenue or ranking numbers are invented.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 text-xs sm:grid-cols-2">
            <li className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2">
              <span className="text-muted-foreground">Your description</span>
              <Badge variant={evidence.ownerDescription ? "default" : "secondary"}>
                {evidence.ownerDescription ? "Provided" : "Not provided"}
              </Badge>
            </li>
            <li className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2">
              <span className="text-muted-foreground">Live website</span>
              <Badge variant={evidence.websiteAnalysed ? "default" : "secondary"}>
                {evidence.websiteAnalysed ? `Read · ${evidence.pagesCrawled} page(s)` : "Not read"}
              </Badge>
            </li>
            <li className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2">
              <span className="text-muted-foreground">Repository</span>
              <Badge variant={evidence.repoAnalysed ? "default" : "secondary"}>
                {evidence.repoAnalysed ? "Read" : "Not read"}
              </Badge>
            </li>
            <li className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2">
              <span className="text-muted-foreground">Domain ownership</span>
              <Badge variant={evidence.domainVerified ? "default" : "secondary"}>
                {evidence.domainVerified ? "Verified in Atai" : "Not verified"}
              </Badge>
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4 text-primary" />
            How your co-founder reads the business
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Understanding</h4>
            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">{assessment.understanding}</p>
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Where you stand</h4>
            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">{assessment.currentPosition}</p>
          </div>
        </CardContent>
      </Card>

      <FindingList title="Strengths" findings={assessment.strengths} />
      <FindingList title="Challenges" findings={assessment.challenges} />
      <FindingList title="Growth opportunities" findings={assessment.growthOpportunities} />
      <FindingList title="Technical opportunities" findings={assessment.technicalOpportunities} />
      <FindingList title="Marketing opportunities" findings={assessment.marketingOpportunities} />

      {assessment.priorities.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="size-4 text-primary" />
              Priorities, with where to work on them
            </CardTitle>
            <CardDescription>
              Every destination below is a real screen in your workspace. Where Atai cannot do the work itself, the
              card says what it needs from you.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-3">
              {assessment.priorities.map((priority, index) => (
                <li key={`${priority.title}-${index}`} className="rounded-xl border border-border/70 bg-card p-4">
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
          </CardContent>
        </Card>
      ) : null}

      {assessment.actionPlan.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Action plan</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {assessment.actionPlan.map((horizon) => (
              <div key={horizon.horizon}>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {HORIZON_LABEL[horizon.horizon]}
                </h4>
                <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed">
                  {horizon.items.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {assessment.openQuestions.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CircleHelp className="size-4 text-primary" />
              Questions only you can answer
            </CardTitle>
            <CardDescription>Answering these in the co-founder chat sharpens every later recommendation.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed">
              {assessment.openQuestions.map((question, index) => (
                <li key={index}>{question}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}