import { describe, expect, it } from "vitest"
import {
  aggregatePerformance,
  buildFunnel,
  campaignNameFromStrategy,
  dailyRecordedSeries,
  DAY_MS,
  deriveStrategyStages,
  formatPerfValue,
  lifecyclePosition,
  LIFECYCLE_STAGES,
  mapStrategyChannels,
  normalizePerfMetric,
  requestStatusGroup,
  seriesHasSignal,
  summarizeCampaigns,
  type PerfReport,
} from "./center-model"

const DAY = DAY_MS
const T0 = 1_700_000_000_000

function report(overrides: Partial<PerfReport> = {}): PerfReport {
  return {
    id: `perf_${Math.random().toString(36).slice(2)}`,
    requestId: "adreq_1",
    metric: "impressions",
    value: 100,
    source: "manual",
    reportedAt: T0,
    ...overrides,
  }
}

describe("normalizePerfMetric", () => {
  it("maps known aliases case-insensitively", () => {
    expect(normalizePerfMetric("Impressions")).toBe("impressions")
    expect(normalizePerfMetric("  Website   Clicks ")).toBe("clicks")
    expect(normalizePerfMetric("Sign-ups")).toBe("registrations")
    expect(normalizePerfMetric("Paying customers")).toBe("customers")
    expect(normalizePerfMetric("Revenue attributed")).toBe("revenue")
  })

  it("returns null for unknown metrics instead of guessing", () => {
    expect(normalizePerfMetric("vibes")).toBeNull()
    expect(normalizePerfMetric("")).toBeNull()
  })
})

describe("aggregatePerformance", () => {
  it("reports not_recorded (null) when nothing exists — never a fake zero", () => {
    const { totals, other } = aggregatePerformance([])
    expect(totals.impressions.state).toBe("not_recorded")
    expect(totals.impressions.value).toBeNull()
    expect(other).toEqual([])
  })

  it("sums the LATEST report per campaign, not every cumulative update", () => {
    const { totals } = aggregatePerformance([
      report({ requestId: "a", metric: "impressions", value: 1000, reportedAt: T0 }),
      report({ requestId: "a", metric: "impressions", value: 2500, reportedAt: T0 + DAY }),
      report({ requestId: "b", metric: "impressions", value: 500, reportedAt: T0 }),
    ])
    expect(totals.impressions.value).toBe(3000)
    expect(totals.impressions.campaigns).toBe(2)
    expect(totals.impressions.state).toBe("measured")
  })

  it("keeps a genuine recorded zero as measured_zero", () => {
    const { totals } = aggregatePerformance([report({ metric: "leads", value: 0 })])
    expect(totals.leads.state).toBe("measured_zero")
    expect(totals.leads.value).toBe(0)
  })

  it("collects the sources behind the latest reports", () => {
    const { totals } = aggregatePerformance([
      report({ requestId: "a", metric: "clicks", value: 10, source: "platform" }),
      report({ requestId: "b", metric: "clicks", value: 5, source: "manual" }),
    ])
    expect(totals.clicks.sources.sort()).toEqual(["manual", "platform"])
  })

  it("never drops unknown metrics — they land in other, newest first", () => {
    const { totals, other } = aggregatePerformance([
      report({ metric: "store visits", value: 3, reportedAt: T0 }),
      report({ metric: "coupon redemptions", value: 9, reportedAt: T0 + DAY }),
    ])
    expect(totals.visits.state).toBe("not_recorded")
    expect(other.map((r) => r.metric)).toEqual(["coupon redemptions", "store visits"])
  })

  it("marks revenue as money, counts as count", () => {
    const { totals } = aggregatePerformance([report({ metric: "revenue", value: 120 })])
    expect(totals.revenue.unit).toBe("money")
    expect(totals.clicks.unit).toBe("count")
  })
})

describe("dailyRecordedSeries", () => {
  const window = { from: T0, to: T0 + 3 * DAY }

  it("zero-fills every day of the window and sums same-day reports", () => {
    const points = dailyRecordedSeries(
      [
        report({ metric: "clicks", value: 4, reportedAt: T0 + 1000 }),
        report({ metric: "clicks", value: 6, reportedAt: T0 + 2000 }),
        report({ metric: "clicks", value: 9, reportedAt: T0 + 2 * DAY + 500 }),
      ],
      "clicks",
      window,
    )
    expect(points).toHaveLength(4)
    expect(points[0].value).toBe(10)
    expect(points[1].value).toBe(0)
    expect(points[2].value).toBe(9)
    expect(points[3].value).toBe(0)
  })

  it("ignores reports outside the window and other metrics", () => {
    const points = dailyRecordedSeries(
      [
        report({ metric: "clicks", value: 4, reportedAt: T0 - DAY }),
        report({ metric: "impressions", value: 90, reportedAt: T0 + 1000 }),
      ],
      "clicks",
      window,
    )
    expect(points.every((p) => p.value === 0)).toBe(true)
    expect(seriesHasSignal(points)).toBe(false)
  })

  it("detects signal only when a non-zero day exists", () => {
    const points = dailyRecordedSeries([report({ metric: "visits", value: 2, reportedAt: T0 })], "visits", window)
    expect(seriesHasSignal(points)).toBe(true)
  })
})

describe("buildFunnel", () => {
  it("computes conversion only between adjacent measured stages", () => {
    const { totals } = aggregatePerformance([
      report({ metric: "impressions", value: 1000 }),
      report({ metric: "clicks", value: 100 }),
      report({ metric: "customers", value: 5 }),
    ])
    const funnel = buildFunnel(totals)
    expect(funnel[0].conversionFromPrev).toBeNull()
    expect(funnel[1].conversionFromPrev).toBeCloseTo(0.1)
    // visits + registrations unmeasured: customers has no measured previous stage
    expect(funnel[2].state).toBe("not_recorded")
    expect(funnel[4].value).toBe(5)
    expect(funnel[4].conversionFromPrev).toBeCloseTo(0.05)
  })

  it("never divides by zero or fabricates missing stages", () => {
    const { totals } = aggregatePerformance([report({ metric: "impressions", value: 0 })])
    const funnel = buildFunnel(totals)
    expect(funnel[0].state).toBe("measured_zero")
    expect(funnel[1].conversionFromPrev).toBeNull()
    expect(funnel[1].value).toBeNull()
  })
})

describe("deriveStrategyStages", () => {
  const base = {
    hasAudience: false,
    hasChannels: false,
    hasStrategy: false,
    creativeCount: 0,
    activeCampaigns: 0,
    activeRequests: 0,
    finishedCampaigns: 0,
    finishedRequests: 0,
  }

  it("starts everything upcoming for a blank workspace", () => {
    const stages = deriveStrategyStages(base)
    expect(stages.map((s) => s.state)).toEqual(["upcoming", "upcoming", "upcoming", "upcoming"])
  })

  it("marks materials in progress once a strategy exists, complete with drafts", () => {
    expect(deriveStrategyStages({ ...base, hasStrategy: true })[2].state).toBe("in_progress")
    expect(deriveStrategyStages({ ...base, creativeCount: 3 })[2].state).toBe("complete")
  })

  it("launch is in progress while running, complete once anything finished", () => {
    expect(deriveStrategyStages({ ...base, activeRequests: 1 })[3].state).toBe("in_progress")
    expect(deriveStrategyStages({ ...base, activeRequests: 1, finishedCampaigns: 1 })[3].state).toBe("complete")
  })
})

describe("lifecyclePosition", () => {
  it("walks the eight-stage happy path", () => {
    expect(lifecyclePosition("submitted").index).toBe(0)
    expect(lifecyclePosition("under_review").index).toBe(1)
    expect(lifecyclePosition("proposal_prepared").index).toBe(2)
    expect(lifecyclePosition("awaiting_approval").index).toBe(3)
    expect(lifecyclePosition("awaiting_payment").index).toBe(4)
    expect(lifecyclePosition("approved").index).toBe(5)
    expect(lifecyclePosition("scheduled").index).toBe(5)
    expect(lifecyclePosition("in_progress").index).toBe(6)
    expect(lifecyclePosition("completed").index).toBe(LIFECYCLE_STAGES.length)
  })

  it("flags side states without inventing progress", () => {
    expect(lifecyclePosition("needs_info")).toEqual({ index: 1, side: "needs_info" })
    expect(lifecyclePosition("paused")).toEqual({ index: 6, side: "paused" })
    expect(lifecyclePosition("rejected")).toEqual({ index: -1, side: "rejected" })
    expect(lifecyclePosition("cancelled")).toEqual({ index: -1, side: "cancelled" })
    expect(lifecyclePosition("refunded")).toEqual({ index: -1, side: "refunded" })
  })
})

describe("requestStatusGroup", () => {
  it("buckets every status into exactly one founder-facing group", () => {
    expect(requestStatusGroup("awaiting_approval")).toBe("needs_action")
    expect(requestStatusGroup("awaiting_payment")).toBe("needs_action")
    expect(requestStatusGroup("needs_info")).toBe("needs_action")
    expect(requestStatusGroup("submitted")).toBe("in_review")
    expect(requestStatusGroup("under_review")).toBe("in_review")
    expect(requestStatusGroup("proposal_prepared")).toBe("in_review")
    expect(requestStatusGroup("approved")).toBe("running")
    expect(requestStatusGroup("scheduled")).toBe("running")
    expect(requestStatusGroup("in_progress")).toBe("running")
    expect(requestStatusGroup("paused")).toBe("running")
    expect(requestStatusGroup("completed")).toBe("completed")
    expect(requestStatusGroup("rejected")).toBe("closed")
    expect(requestStatusGroup("cancelled")).toBe("closed")
    expect(requestStatusGroup("refunded")).toBe("closed")
  })
})

describe("summarizeCampaigns", () => {
  it("buckets active / pending / completed without counting cancelled as either", () => {
    const summary = summarizeCampaigns([
      { status: "active" },
      { status: "draft" },
      { status: "paused" },
      { status: "completed" },
      { status: "cancelled" },
    ])
    expect(summary).toEqual({ total: 5, active: 1, pending: 2, completed: 1 })
  })
})

describe("mapStrategyChannels", () => {
  it("maps platform names onto the plan enum, deduplicated and bounded", () => {
    expect(mapStrategyChannels(["Facebook", "Instagram", "Email newsletter", "SEO / content", "Referral", "Other"])).toEqual([
      "social",
      "email",
      "seo",
      "referral",
      "other",
    ])
  })

  it("ignores blanks and caps at six", () => {
    expect(mapStrategyChannels(["", "  "])).toEqual([])
    expect(mapStrategyChannels(["a", "b", "c", "d", "e", "f", "g"]).length).toBeLessThanOrEqual(6)
  })
})

describe("campaignNameFromStrategy", () => {
  it("prefers the first real objective, falls back to positioning", () => {
    expect(campaignNameFromStrategy({ objectives: ["", "Fill the weekend calendar"], positioning: "x" })).toBe(
      "Fill the weekend calendar",
    )
    expect(campaignNameFromStrategy({ objectives: [], positioning: "The warm local bakery" })).toBe(
      "The warm local bakery",
    )
    expect(campaignNameFromStrategy({ objectives: [], positioning: "" })).toBe("Growth campaign from my strategy")
  })

  it("clamps to the API's 120-character bound", () => {
    const name = campaignNameFromStrategy({ objectives: ["x".repeat(300)], positioning: "" })
    expect(name.length).toBeLessThanOrEqual(120)
  })
})

describe("formatPerfValue", () => {
  it("renders money and counts distinctly", () => {
    expect(formatPerfValue(12345, "count")).toBe("12,345")
    expect(formatPerfValue(12345, "money")).toBe("$12,345")
  })
})
