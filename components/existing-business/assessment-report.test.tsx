import { describe, expect, it } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { BusinessAssessment } from "@/lib/types/business-intake"
import { AssessmentReport } from "./assessment-report"

const assessment: BusinessAssessment = {
  generatedAt: 1,
  evidence: { websiteAnalysed: true, pagesCrawled: 3, ownerDescription: true, domainVerified: false },
  understanding: "A neighbourhood bakery selling bread and pastries.",
  currentPosition: "Clear product, no way to order.",
  strengths: [],
  challenges: [],
  growthOpportunities: [],
  technicalOpportunities: [],
  marketingOpportunities: [],
  priorities: [],
  actionPlan: [],
  openQuestions: [],
}

describe("AssessmentReport", () => {
  it("lets the founder open the read behind the website source", () => {
    const html = renderToStaticMarkup(
      createElement(AssessmentReport, { assessment, onShowReading: () => {} }),
    )

    expect(html).toContain("Your site · 3 page(s)")
    expect(html).toContain('title="See what was read"')
  })

  it("leaves the source inert when there is nothing to open", () => {
    const html = renderToStaticMarkup(createElement(AssessmentReport, { assessment }))

    expect(html).toContain("Your site · 3 page(s)")
    expect(html).not.toContain('title="See what was read"')
  })

  it("accepts a partial stored assessment without throwing", () => {
    // An older parser could have stored a result missing most sections.
    const html = renderToStaticMarkup(
      createElement(AssessmentReport, {
        assessment: { understanding: "Only this survived" } as unknown as BusinessAssessment,
      }),
    )

    expect(html).toContain("Only this survived")
    expect(html).toContain("Your site · not read")
    // A missing `generatedAt` must not print "Jan 1, 1970".
    expect(html).not.toContain("1970")
  })

  it("never offers a preview for a site that was not read", () => {
    const html = renderToStaticMarkup(
      createElement(AssessmentReport, {
        assessment: { ...assessment, evidence: { ...assessment.evidence, websiteAnalysed: false, pagesCrawled: 0 } },
        onShowReading: () => {},
      }),
    )

    expect(html).toContain("Your site · not read")
    expect(html).not.toContain('title="See what was read"')
  })
})
