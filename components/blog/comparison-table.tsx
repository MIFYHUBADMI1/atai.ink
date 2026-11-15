import type { ComparisonData } from "@/lib/blog/types"

/** Structured comparison table for vs/alternatives articles. Every competitor
 * claim shows its evidence and verification date — honest positioning only. */
export function ComparisonTable({ comparison }: { comparison: ComparisonData }) {
  if (!comparison.rows.length) return null
  return (
    <section className="mt-10" aria-label={`Atai vs ${comparison.competitorName} comparison`}>
      <h2 className="text-xl font-semibold tracking-tight">
        Atai vs {comparison.competitorName}: side by side
      </h2>
      {comparison.positioning ? (
        <p className="mt-2 text-sm leading-7 text-muted-foreground">{comparison.positioning}</p>
      ) : null}
      <div className="mt-4 overflow-x-auto rounded-xl border border-border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="border-b border-border bg-muted/50 px-3 py-2 text-left font-semibold">Dimension</th>
              <th className="border-b border-border bg-muted/50 px-3 py-2 text-left font-semibold">Atai</th>
              <th className="border-b border-border bg-muted/50 px-3 py-2 text-left font-semibold">
                {comparison.competitorUrl ? (
                  <a href={comparison.competitorUrl} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">
                    {comparison.competitorName}
                  </a>
                ) : (
                  comparison.competitorName
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {comparison.rows.map((row) => (
              <tr key={row.dimension}>
                <td className="border-b border-border/60 px-3 py-2 align-top font-medium">{row.dimension}</td>
                <td className="border-b border-border/60 px-3 py-2 align-top">{row.atai}</td>
                <td className="border-b border-border/60 px-3 py-2 align-top">
                  <span>{row.competitor}</span>
                  {row.evidence ? (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Source:{" "}
                      {row.evidence.startsWith("http") ? (
                        <a href={row.evidence} target="_blank" rel="noreferrer noopener" className="break-all text-primary hover:underline" title={row.evidence}>
                          {row.evidence.replace(/^https?:\/\//, "")}
                        </a>
                      ) : (
                        row.evidence
                      )}
                      {row.lastChecked ? ` · checked ${row.lastChecked}` : ""}
                    </span>
                  ) : null}
                  {row.note ? <span className="mt-1 block text-xs text-muted-foreground">{row.note}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {comparison.limitations ? (
        <p className="mt-3 text-xs leading-6 text-muted-foreground">Limitations: {comparison.limitations}</p>
      ) : null}
      {comparison.lastReviewed ? (
        <p className="mt-1 text-xs text-muted-foreground">Comparison last reviewed {comparison.lastReviewed}.</p>
      ) : null}
    </section>
  )
}