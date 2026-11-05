import "server-only"
import { runtimeUsageCol, ensureRuntimeIndexes } from "@/lib/db/runtime-collections"
import { store } from "@/lib/store/store"
import {
  getProjectEarnings,
  type EarningsResult,
  type ProjectPayment,
} from "./dodo-earnings"
import {
  buildTotals,
  estimateArr,
  mergeDailySeries,
  projectNext30d,
  FINANCE_WINDOW_MS,
  type ArrEstimate,
  type DailyFinancePoint,
  type FinanceProjection,
  type FinanceTotals,
  type ProjectFinances,
} from "./project-finances"

/**
 * Atai Finance — platform-level ("whole business") roll-up (server-only).
 *
 * The user's finances across ALL of their projects, assembled from the same
 * building blocks as the per-project finance page: `runtime_usage` metering
 * (expenses), attributed Dodo payments (earnings), and the shared pure
 * metrics (daily merge, 30-day OLS projection, MRR/ARR estimate).
 *
 * Honesty rules are inherited, unchanged:
 *  - provider cost is never fabricated (missing numeric costs count as
 *    "unavailable", never rewritten to 0),
 *  - unconfigured payment provider → explicit "unavailable" state,
 *  - projections/ARR are labeled ESTIMATES with their basis.
 *
 * Bounds: earnings sweep attributes at most MAX_EARNINGS_PROJECTS projects
 * (each Dodo sync is itself bounded to 3 provider pages); the flag
 * `earningsSweepComplete` reports honestly when a portfolio is larger.
 *
 * @module lib/finances/platform-finances
 */

const DAY_MS = 24 * 60 * 60 * 1000
/** How many projects may sync earnings on one page load. */
export const MAX_EARNINGS_PROJECTS = 25
/** How many projects a portfolio roll-up considers at all. */
const MAX_PROJECTS = 50
/**
 * How many earnings syncs may hit the payment provider at once. A portfolio
 * sweep maps every project to up to MAX_PAGES provider reads; unbounded
 * parallelism fired dozens of simultaneous requests per page load, which the
 * provider throttles (slow responses / 429) and which stalls the page long
 * after the local aggregation has finished.
 */
const EARNINGS_CONCURRENCY = 4

export interface PlatformProjectFinanceRow {
  projectId: string
  projectName: string
  requests: number
  creditsCharged: number
  providerCostUsd: number | null
  /** Attributed earnings in minor units; null when the provider is unavailable. */
  earningsMinor: number | null
  succeededPayments: number
  /** First currency seen among the project's attributed payments sorted. */
  currency: string | null
  lastPaymentAt: number | null
}

export interface PlatformPaymentRow {
  projectId: string
  projectName: string
  paymentId: string
  amountMinor: number | null
  currency: string | null
  status: string
  createdAt: number | null
  subscriptionId: string | null
  customerEmail: string | null
}

export interface PlatformFinances {
  generatedAt: number
  window: { from: number; to: number; days: number }
  daily: DailyFinancePoint[]
  byProject: PlatformProjectFinanceRow[]
  totals: FinanceTotals
  /** Combined over all swept projects (see combineEarningsStatus). */
  earningsStatus: "ok" | "unavailable" | "error"
  earningsNote: string | null
  recentPayments: PlatformPaymentRow[]
  projection: FinanceProjection
  arr: ArrEstimate
  projectsCount: number
  /** false when the portfolio exceeded MAX_EARNINGS_PROJECTS. */
  earningsSweepComplete: boolean
}

// ─── Pure roll-up helpers (unit-tested) ─────────────────────────────────────

export interface ExpenseDayProjectRow {
  /** UTC date bucket (YYYY-MM-DD). */
  date: string
  projectId: string
  requests: number
  succeeded: number
  failed: number
  creditsCharged: number
  providerCostUsd: number
  providerCostUnavailableCount: number
  /** Numeric provider costs in a non-USD currency (counted, never summed in). */
  providerCostNonUsdCount?: number
}

export interface ProjectExpenseTotals {
  requests: number
  creditsCharged: number
  providerCostUsd: number
  providerCostUnavailableCount: number
  providerCostNonUsdCount?: number
}

export interface CollapsedExpenses {
  /** Day-collapsed series (sums across projects) — mergeDailySeries input. */
  daily: Array<{
    date: string
    requests: number
    succeeded: number
    failed: number
    creditsCharged: number
    providerCostUsd: number
    providerCostUnavailableCount: number
    providerCostNonUsdCount?: number
  }>
  /** Platform totals — buildTotals input (checkoutAttempts is always 0: the
   * roll-up does not aggregate per-project checkout attempts). */
  totals: {
    requests: number
    succeeded: number
    failed: number
    creditsCharged: number
    providerCostUsd: number
    providerCostUnavailableCount: number
    providerCostNonUsdCount?: number
    checkoutAttempts: 0
  }
  /** Per-project expense sums keyed by projectId. */
  byProject: Map<string, ProjectExpenseTotals>
}

/** Collapse per-day-per-project expense rows into day totals + project totals. */
export function collapseExpenseRows(rows: ExpenseDayProjectRow[]): CollapsedExpenses {
  const byDate = new Map<string, CollapsedExpenses["daily"][number]>()
  const projects = new Map<string, ProjectExpenseTotals>()

  for (const row of rows) {
    const day =
      byDate.get(row.date) ??
      {
        date: row.date,
        requests: 0,
        succeeded: 0,
        failed: 0,
        creditsCharged: 0,
        providerCostUsd: 0,
        providerCostUnavailableCount: 0,
        providerCostNonUsdCount: 0,
      }
    day.requests += row.requests
    day.succeeded += row.succeeded
    day.failed += row.failed
    day.creditsCharged += row.creditsCharged
    day.providerCostUsd += row.providerCostUsd
    day.providerCostUnavailableCount += row.providerCostUnavailableCount
    day.providerCostNonUsdCount = (day.providerCostNonUsdCount ?? 0) + (row.providerCostNonUsdCount ?? 0)
    byDate.set(row.date, day)

    const project =
      projects.get(row.projectId) ??
      { requests: 0, creditsCharged: 0, providerCostUsd: 0, providerCostUnavailableCount: 0, providerCostNonUsdCount: 0 }
    project.requests += row.requests
    project.creditsCharged += row.creditsCharged
    project.providerCostUsd += row.providerCostUsd
    project.providerCostUnavailableCount += row.providerCostUnavailableCount
    project.providerCostNonUsdCount = (project.providerCostNonUsdCount ?? 0) + (row.providerCostNonUsdCount ?? 0)
    projects.set(row.projectId, project)
  }

  const dailyValues = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return {
    daily: dailyValues,
    totals: {
      requests: dailyValues.reduce((a, r) => a + r.requests, 0),
      succeeded: dailyValues.reduce((a, r) => a + r.succeeded, 0),
      failed: dailyValues.reduce((a, r) => a + r.failed, 0),
      creditsCharged: dailyValues.reduce((a, r) => a + r.creditsCharged, 0),
      providerCostUsd: dailyValues.reduce((a, r) => a + r.providerCostUsd, 0),
      providerCostUnavailableCount: dailyValues.reduce((a, r) => a + r.providerCostUnavailableCount, 0),
      providerCostNonUsdCount: dailyValues.reduce((a, r) => a + (r.providerCostNonUsdCount ?? 0), 0),
      checkoutAttempts: 0,
    },
    byProject: projects,
  }
}

export interface EarningsStatusInput {
  status: EarningsResult["status"]
  note?: string | null
}

/**
 * Combine per-project earnings feed statuses, honestly:
 *  - ANY "ok" → ok (at least one project read real payments),
 *  - else any "error" → error (provider reachable but refused/faulted),
 *  - else (all "unavailable") → unavailable, with the shared setup note.
 * No input is treated as "unavailable" with no note (zero projects swept is
 * a distinct state the view explains).
 */
export function combineEarningsStatus(entries: EarningsStatusInput[]): {
  status: "ok" | "unavailable" | "error"
  note: string | null
} {
  const hasOk = entries.some((e) => e.status === "ok")
  if (hasOk) return { status: "ok", note: null }
  const firstError = entries.find((e) => e.status === "error")
  if (firstError) {
    return { status: "error", note: firstError.note ?? "The payment provider could not be reached for this portfolio." }
  }
  const firstUnavailable = entries.find((e) => e.status === "unavailable")
  return {
    status: "unavailable",
    note: firstUnavailable?.note ?? null,
  }
}

export interface PortfolioEntry {
  projectId: string
  projectName: string
  expense: {
    requests: number
    creditsCharged: number
    providerCostUsd: number
    providerCostUnavailableCount: number
  }
  earnings: EarningsResult
}

/** One portfolio-table row per project; sorted by credit spend, descending. */
export function portfolioProjectRows(entries: PortfolioEntry[]): PlatformProjectFinanceRow[] {
  const rows: PlatformProjectFinanceRow[] = []
  for (const entry of entries) {
    const okPayments = entry.earnings.status === "ok" ? entry.earnings.payments : []
    let earningsMinor = 0
    let succeededPayments = 0
    let lastPaymentAt: number | null = null
    for (const p of okPayments) {
      if (p.status === "succeeded" && typeof p.amountMinor === "number") earningsMinor += p.amountMinor
      if (p.status === "succeeded") succeededPayments += 1
      if (p.createdAt !== null && (lastPaymentAt === null || p.createdAt > lastPaymentAt)) {
        lastPaymentAt = p.createdAt
      }
    }
    const currencies = [...new Set(okPayments.map((p) => p.currency).filter((c): c is string => Boolean(c)))].sort()
    const providerCostUsd =
      entry.expense.providerCostUnavailableCount < entry.expense.requests || entry.expense.providerCostUsd > 0
        ? entry.expense.providerCostUsd
        : null
    rows.push({
      projectId: entry.projectId,
      projectName: entry.projectName,
      requests: entry.expense.requests,
      creditsCharged: entry.expense.creditsCharged,
      providerCostUsd,
      // Distinct from 0: null = the portfolio's feed state does not cover
      // this project's earnings truthfully (unconfigured or failed).
      earningsMinor: entry.earnings.status === "ok" ? earningsMinor : null,
      succeededPayments,
      currency: currencies[0] ?? null,
      lastPaymentAt,
    })
  }
  return rows.sort((a, b) => b.creditsCharged - a.creditsCharged)
}

/** Merge recent attributed payments across projects; tagged, newest first. */
export function mergeRecentPayments(entries: PortfolioEntry[], limit = 20): PlatformPaymentRow[] {
  const rows: PlatformPaymentRow[] = []
  for (const entry of entries) {
    if (entry.earnings.status !== "ok") continue
    for (const p of entry.earnings.payments) {
      rows.push({
        projectId: entry.projectId,
        projectName: entry.projectName,
        paymentId: p.paymentId,
        amountMinor: p.amountMinor,
        currency: p.currency,
        status: p.status,
        createdAt: p.createdAt,
        subscriptionId: p.subscriptionId,
        customerEmail: p.customerEmail,
      })
    }
  }
  // Un-parseable dates sort last (they never claim recency they don't have).
  return rows
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .slice(0, limit)
}

/** Run `fn` over `items` with at most `limit` in flight; order is preserved. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let index = next++; index < items.length; index = next++) {
      results[index] = await fn(items[index])
    }
  })
  await Promise.all(workers)
  return results
}

// ─── Expenses: one bounded aggregation across all projects ─────────────────

const NUMERIC_PROVIDER_TYPES: string[] = ["double", "int", "long", "decimal"]
const EPOCH_DATE = new Date(0)

/**
 * Raw per-day-per-project expense rows for a range. Kept separate from the
 * collapse so one read can serve a reporting window AND the equal-length
 * window before it (the dashboard's direction figure) without a second
 * aggregation.
 */
async function aggregateExpenseRows(
  projectIds: string[],
  from: number,
  to: number,
): Promise<ExpenseDayProjectRow[]> {
  if (projectIds.length === 0) return []
  await ensureRuntimeIndexes()
  const col = await runtimeUsageCol()

  const numericCostCond = { $in: [{ $type: "$costMetadata.providerCost" }, NUMERIC_PROVIDER_TYPES] }
  // Phase 2 currency honesty: only USD-denominated provider reports sum into
  // providerCostUsd; other currencies are counted, never mixed or converted.
  const providerCostExpr = {
    $cond: [
      { $and: [numericCostCond, { $eq: ["$costMetadata.providerCostCurrency", "USD"] }] },
      "$costMetadata.providerCost",
      0,
    ],
  }
  const providerNonUsdExpr = {
    $cond: [{ $and: [numericCostCond, { $ne: ["$costMetadata.providerCostCurrency", "USD"] }] }, 1, 0],
  }
  const providerMissingExpr = {
    $cond: [numericCostCond, 0, 1],
  }

  const rows = await col
    .aggregate<ExpenseDayProjectRow>([
      { $match: { projectId: { $in: projectIds }, createdAt: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: {
            date: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: { $dateTrunc: { date: { $add: [EPOCH_DATE, "$createdAt"] }, unit: "day" } },
              },
            },
            projectId: "$projectId",
          },
          requests: { $sum: 1 },
          succeeded: { $sum: { $cond: [{ $eq: ["$status", "succeeded"] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } },
          creditsCharged: { $sum: "$creditsCharged" },
          providerCostUsd: { $sum: providerCostExpr },
          providerNonUsd: { $sum: providerNonUsdExpr },
          providerUnavailable: { $sum: providerMissingExpr },
        },
      },
      { $sort: { "_id.date": 1 } },
      { $project: { _id: 0, date: "$_id.date", projectId: "$_id.projectId", requests: 1, succeeded: 1, failed: 1, creditsCharged: 1, providerCostUsd: 1, providerCostUnavailableCount: "$providerUnavailable", providerCostNonUsdCount: "$providerNonUsd" } },
    ])
    .toArray()

  return rows
}

async function aggregatePlatformExpenses(
  projectIds: string[],
  from: number,
  to: number,
): Promise<CollapsedExpenses> {
  return collapseExpenseRows(await aggregateExpenseRows(projectIds, from, to))
}

// ─── Assembly ───────────────────────────────────────────────────────────────

/** Assemble the whole-business finance view for one user. Read-only. */
export async function getPlatformFinances(userId: string): Promise<PlatformFinances> {
  const to = Date.now()
  const from = to - FINANCE_WINDOW_MS

  const projects = await store.listProjects(userId, MAX_PROJECTS)
  const projectIds = projects.map((p) => p.id)
  // The earnings sweep is bounded: each project sync costs up to 3 provider
  // pages, so a large portfolio syncs only its most recently-updated slice
  // and reports the truncation honestly instead of blocking the page.
  const sweep = projects.slice(0, MAX_EARNINGS_PROJECTS)

  // The expense aggregation and the provider sweep run concurrently, but the
  // portfolio rows are assembled only AFTER `Promise.all` resolves — reading
  // the `expenses` binding from inside the map callbacks is a temporal dead
  // zone error (it is not initialized until the destructuring completes).
  const [expenses, earningsResults] = await Promise.all([
    aggregatePlatformExpenses(projectIds, from, to),
    mapWithConcurrency(sweep, EARNINGS_CONCURRENCY, (p) => getProjectEarnings(p.id, from)),
  ])

  const entries: PortfolioEntry[] = sweep.map((p, index) => ({
    projectId: p.id,
    projectName: p.name,
    expense:
      expenses.byProject.get(p.id) ??
      { requests: 0, creditsCharged: 0, providerCostUsd: 0, providerCostUnavailableCount: 0 },
    earnings: earningsResults[index],
  }))

  const allPayments: ProjectPayment[] = entries.flatMap((e) =>
    e.earnings.status === "ok" ? e.earnings.payments : [],
  )
  const combined =
    entries.length === 0
      ? { status: "unavailable" as const, note: "You have no projects yet — your portfolio finances roll up here once you create one." }
      : combineEarningsStatus(
          entries.map((e): EarningsStatusInput =>
            e.earnings.status === "ok"
              ? { status: "ok" }
              : { status: e.earnings.status, note: e.earnings.note },
          ),
        )

  const daily = mergeDailySeries(expenses.daily, allPayments)
  const totals = buildTotals(
    { daily: expenses.daily, totals: expenses.totals },
    { status: combined.status, payments: allPayments },
    from,
    to,
  )
  const projection = projectNext30d(daily)
  const arr = estimateArr(allPayments)

  return {
    generatedAt: to,
    window: { from, to, days: Math.round(FINANCE_WINDOW_MS / DAY_MS) },
    daily,
    byProject: portfolioProjectRows(entries),
    totals,
    earningsStatus: combined.status,
    earningsNote: combined.note,
    recentPayments: mergeRecentPayments(entries),
    projection,
    arr,
    projectsCount: projects.length,
    earningsSweepComplete: projects.length <= MAX_EARNINGS_PROJECTS,
  }
}

/** Keep the re-export surface explicit: the view builds on ProjectFinances types. */
export type { ProjectFinances }

// ─── Home-dashboard portfolio overview ────────────────────────────────────

/** Ranges the dashboard portfolio panel may ask for, in days. */
export const PORTFOLIO_RANGES = [14, 30, 90] as const
export type PortfolioRange = (typeof PORTFOLIO_RANGES)[number]
export const DEFAULT_PORTFOLIO_RANGE: PortfolioRange = 30

/** Whitelisted parse — anything unknown falls back to the default range. */
export function resolvePortfolioRange(raw: string | null | undefined): PortfolioRange {
  const days = Number(raw)
  return (PORTFOLIO_RANGES as readonly number[]).includes(days)
    ? (days as PortfolioRange)
    : DEFAULT_PORTFOLIO_RANGE
}

export interface PortfolioDailyPoint {
  /** UTC date bucket (YYYY-MM-DD). */
  date: string
  creditsCharged: number
  /** Attributed earnings that day, minor units (0 when none succeeded). */
  earningsMinor: number
  /** USD the providers reported that day; null when nothing reported one. */
  providerCostUsd: number | null
}

export interface PortfolioBusinessRow {
  projectId: string
  projectName: string
  requests: number
  creditsCharged: number
  /** null while the project's earnings feed has never reported "ok". */
  earningsMinor: number | null
  currency: string | null
}

export interface PortfolioOverview {
  generatedAt: number
  days: number
  daily: PortfolioDailyPoint[]
  totals: {
    requests: number
    succeeded: number
    failed: number
    creditsCharged: number
    /** null means the feed is unavailable — never a fabricated zero. */
    earningsMinor: number | null
    providerCostUsd: number | null
    providerCostUnavailableCount: number
    succeededPayments: number
    pendingPayments: number
    currencies: string[]
  }
  /** The equal-length window immediately before the reported one. */
  prior: { requests: number; creditsCharged: number; earningsMinor: number | null }
  /** Credits vs the prior window; null when that window saw no spend. */
  spendChangePct: number | null
  earningsStatus: "ok" | "unavailable" | "error"
  earningsNote: string | null
  projectsCount: number
  earningsSweepComplete: boolean
  byProject: PortfolioBusinessRow[]
}

/** Percent change against a prior window; no honest percentage exists at zero. */
export function windowChangePct(current: number, prior: number): number | null {
  return prior === 0 ? null : Math.round(((current - prior) / prior) * 100)
}

/** A day's provider cost is a number only when at least one call reported one. */
function dayProviderCostUsd(point: DailyFinancePoint): number | null {
  const reported = point.requests - point.providerCostUnavailableCount
  return reported > 0 || point.providerCostUsd !== null ? point.providerCostUsd : null
}

/**
 * One point per day for the whole window. A quiet day is a real zero, not a
 * gap the reader has to infer from the shape of the line.
 */
export function zeroFillPortfolioDaily(
  days: number,
  to: number,
  points: DailyFinancePoint[],
): PortfolioDailyPoint[] {
  const byDate = new Map(points.map((p) => [p.date, p]))
  const out: PortfolioDailyPoint[] = []
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date(to - offset * DAY_MS).toISOString().slice(0, 10)
    const found = byDate.get(date)
    out.push({
      date,
      creditsCharged: found?.creditsCharged ?? 0,
      earningsMinor: found?.earningsMinor ?? 0,
      providerCostUsd: found ? dayProviderCostUsd(found) : null,
    })
  }
  return out
}

/** Keep only the payments that fall inside one window. */
function scopeEarningsToWindow(result: EarningsResult, from: number, to: number): EarningsResult {
  if (result.status !== "ok") return result
  return {
    ...result,
    payments: result.payments.filter((p) => p.createdAt !== null && p.createdAt >= from && p.createdAt <= to),
  }
}

/**
 * Fold successful attributed payments into zero-filled day buckets, keeping the
 * minor-unit honesty of the finance pages (only succeeded amounts count,
 * payments with no parseable date are not day-bucketed). Pure and unit-tested.
 */
export function mergeEarningsIntoDaily(
  daily: Array<{ date: string; creditsCharged: number }>,
  payments: Array<Pick<ProjectPayment, "amountMinor" | "currency" | "status" | "createdAt">>,
): Array<{ date: string; creditsCharged: number; earningsMinor: number }> {
  const earningsByDate = new Map<string, number>()
  for (const p of payments) {
    if (p.status !== "succeeded" || typeof p.amountMinor !== "number" || p.createdAt === null) continue
    const date = new Date(p.createdAt).toISOString().slice(0, 10)
    earningsByDate.set(date, (earningsByDate.get(date) ?? 0) + p.amountMinor)
  }
  return daily.map((d) => ({ ...d, earningsMinor: earningsByDate.get(d.date) ?? 0 }))
}

/**
 * Portfolio overview for the home dashboard: one expense read and one earnings
 * sweep across TWICE the reported window, split at the halfway date so the
 * current window and the equal-length window before it come from the same
 * aggregation. Every total, percentage and daily bucket is computed here — the
 * browser renders numbers and never derives one.
 *
 * Units stay separate on purpose: runtime spend is credits, earnings are money
 * in whatever currency arrived. Credits have no single purchase price (packs
 * sell 200k for $59 and 500k for $119), so no cross-unit "net" is produced.
 *
 * Bounds and honesty states match getPlatformFinances: at most
 * MAX_EARNINGS_PROJECTS projects are swept, `earningsSweepComplete` says when
 * that truncates, and an unavailable earnings feed stays null.
 */
export async function getPortfolioOverview(
  userId: string,
  days: PortfolioRange = DEFAULT_PORTFOLIO_RANGE,
): Promise<PortfolioOverview> {
  const to = Date.now()
  const spanMs = days * DAY_MS
  const windowFrom = to - spanMs
  // Day boundary between the two halves: rows on or after this UTC date belong
  // to the reported window, anything earlier is the comparison window.
  const cutDate = new Date(windowFrom).toISOString().slice(0, 10)

  const projects = await store.listProjects(userId, MAX_PROJECTS)
  const projectIds = projects.map((p) => p.id)
  const sweep = projects.slice(0, MAX_EARNINGS_PROJECTS)

  const [rows, earningsResults] = await Promise.all([
    aggregateExpenseRows(projectIds, windowFrom - spanMs, to),
    mapWithConcurrency(sweep, EARNINGS_CONCURRENCY, (p) => getProjectEarnings(p.id, windowFrom - spanMs)),
  ])

  const current = collapseExpenseRows(rows.filter((r) => r.date >= cutDate))
  const prior = collapseExpenseRows(rows.filter((r) => r.date < cutDate))

  const statuses: EarningsStatusInput[] = earningsResults.map((r) =>
    r.status === "ok" ? { status: "ok" as const } : { status: r.status, note: r.note },
  )
  const combined =
    sweep.length === 0
      ? {
          status: "unavailable" as const,
          note: "You have no projects yet — your portfolio finances roll up here once you create one.",
        }
      : combineEarningsStatus(statuses)

  const windowed = earningsResults.map((r) => scopeEarningsToWindow(r, windowFrom, to))
  const currentPayments = windowed.flatMap((r) => (r.status === "ok" ? r.payments : []))
  const priorPayments = earningsResults.flatMap((r) =>
    r.status === "ok"
      ? r.payments.filter((p) => p.createdAt !== null && p.createdAt < windowFrom)
      : [],
  )

  const dailyMerged = mergeDailySeries(current.daily, currentPayments)
  const totals = buildTotals(current, { status: combined.status, payments: currentPayments }, windowFrom, to)
  const priorTotals = buildTotals(prior, { status: combined.status, payments: priorPayments }, windowFrom - spanMs, windowFrom)

  const entries: PortfolioEntry[] = sweep.map((p, index) => ({
    projectId: p.id,
    projectName: p.name,
    expense:
      current.byProject.get(p.id) ??
      { requests: 0, creditsCharged: 0, providerCostUsd: 0, providerCostUnavailableCount: 0 },
    earnings: windowed[index],
  }))

  return {
    generatedAt: to,
    days,
    daily: zeroFillPortfolioDaily(days, to, dailyMerged),
    totals: {
      requests: totals.requests,
      succeeded: totals.succeeded,
      failed: totals.failed,
      creditsCharged: totals.creditsCharged,
      earningsMinor: totals.earningsMinor,
      providerCostUsd: totals.providerCostUsd,
      providerCostUnavailableCount: totals.providerCostUnavailableCount,
      succeededPayments: totals.succeededPayments,
      pendingPayments: totals.pendingPayments,
      currencies: totals.currencies,
    },
    prior: {
      requests: priorTotals.requests,
      creditsCharged: priorTotals.creditsCharged,
      earningsMinor: priorTotals.earningsMinor,
    },
    spendChangePct: windowChangePct(totals.creditsCharged, priorTotals.creditsCharged),
    earningsStatus: combined.status,
    earningsNote: combined.note,
    projectsCount: projects.length,
    earningsSweepComplete: projects.length <= MAX_EARNINGS_PROJECTS,
    byProject: portfolioProjectRows(entries),
  }
}
