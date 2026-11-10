import type { ResourceCompetitorIntelligence } from "@/lib/resources/competitor-schema"

export function CompetitorIntelligenceList({ intelligence, projectId }: { intelligence: ResourceCompetitorIntelligence | null; projectId: string }) {
  return (
    <section aria-labelledby="resources-intelligence-heading" className="flex min-w-0 flex-col gap-3">
      <h2 id="resources-intelligence-heading" className="text-lg font-semibold tracking-tight">Competitor suggestions from Resources</h2>
      <p className="text-sm leading-6 text-muted-foreground">
        Read directly from this project’s Resources cache, without generating or charging again. These suggestions are separate from the plan-derived snapshot above; neither is verified market research.
      </p>
      {!intelligence ? (
        <p role="status" className="rounded-xl border border-border p-4 text-sm text-muted-foreground">Resources intelligence could not be loaded. Your plan and saved snapshots remain available.</p>
      ) : intelligence.competitors.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">No usable competitor suggestions are available in Resources yet. You can draft a landscape from your plan independently.</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Source: Resources · AI suggestions · unverified · {intelligence.generatedAt ? `generated ${new Date(intelligence.generatedAt).toISOString().slice(0, 10)}` : "generation date unknown"}. No websites were checked; evidence and research dates are unavailable.
          </p>
          {intelligence.competitors.map((competitor, index) => (
            <details key={`${index}-${competitor.name}`} className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5">
              <summary className="cursor-pointer break-words text-sm font-semibold">
                {competitor.name} <span className="font-normal text-muted-foreground">— AI suggestion · needs verification</span>
              </summary>
              <div className="mt-3 flex min-w-0 flex-col gap-3 break-words text-sm leading-6">
                {competitor.url && <a href={competitor.url} target="_blank" rel="noopener noreferrer" className="text-primary underline">Suggested website (not an evidence source)</a>}
                <dl className="space-y-2">
                  {([
                    ["Possible positioning", competitor.tagline], ["Possible audience", competitor.targetCustomer],
                    ["Possible differentiation", competitor.competitiveEdge], ["Possible business model", competitor.businessModel],
                    ["Pricing (unverified)", competitor.pricing], ["Funding (unverified)", competitor.fundingStatus],
                    ["Founded (unverified)", competitor.founded],
                  ] as const).filter(([, value]) => value).map(([label, value]) => (
                    <div key={label}><dt className="font-medium">{label}</dt><dd className="whitespace-pre-wrap text-muted-foreground">{value}</dd></div>
                  ))}
                </dl>
                {([ ["Suggested strengths", competitor.strengths], ["Suggested weaknesses", competitor.weaknesses] ] as const).filter(([, items]) => items?.length).map(([label, items]) => (
                  <div key={label}><p className="font-medium">{label}</p><ul className="list-disc pl-5 text-muted-foreground">{items?.map((item, i) => <li key={i}>{item}</li>)}</ul></div>
                ))}
              </div>
            </details>
          ))}
        </>
      )}
      {Boolean(intelligence?.omittedEntries) && <p className="text-xs text-muted-foreground">Unusable or duplicate entries are hidden in this view; the original Resources cache has not been changed.</p>}
      <a href={`/project/${encodeURIComponent(projectId)}/resources?section=competitors`} className="w-fit text-sm font-medium text-primary hover:underline">Open Resources to investigate these leads or generate suggestions</a>
      <p className="text-xs text-muted-foreground">Research gaps: confirm the business and website, check current pricing and positioning, and retain supporting sources before making comparisons.</p>
    </section>
  )
}
