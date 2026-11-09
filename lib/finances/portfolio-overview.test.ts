import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { EarningsResult, ProjectPayment } from "./dodo-earnings"
import type { DailyFinancePoint } from "./project-finances"
import {
  DEFAULT_PORTFOLIO_RANGE,
  getPortfolioOverview,
  resolvePortfolioRange,
  windowChangePct,
  zeroFillPortfolioDaily,
} from "./platform-finances"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock("@/lib/db/runtime-collections", () => ({
  runtimeUsageCol: vi.fn(),
  ensureRuntimeIndexes: vi.fn(),
}))
vi.mock("@/lib/store/store", () => ({
  store: { listProjects: vi.fn() },
}))
vi.mock("./dodo-earnings", () => ({
  getProjectEarnings: vi.fn(),
}))

import { runtimeUsageCol } from "@/lib/db/runtime-collections"
import { store } from "@/lib/store/store"
import { getProjectEarnings } from "./dodo-earnings"

const DAY_MS = 24 * 60 * 60 * 1000
// Pinned clock: window boundaries are computed from Date.now(), so a run that
// straddled UTC midnight would otherwise disagree with its own fixtures.
const NOW = Date.parse("2026-11-05T12:00:00.000Z")

function utcDate(daysAgo: number): string {
  return new Date(NOW - daysAgo * DAY_MS).toISOString().slice(0, 10)
}

function dayPoint(over: Partial<DailyFinancePoint> & { date: string }): DailyFinancePoint {
  return {
    requests: 0,
    creditsCharged: 0,
    providerCostUsd: null,
    providerCostUnavailableCount: 0,
    earningsMinor: 0,
    paymentsCount: 0,
    ...over,
  }
}

function payment(over: Partial<ProjectPayment> = {}): ProjectPayment {
  return {
    paymentId: over.paymentId ?? `pay_${Math.random().toString(36).slice(2)}`,
    amountMinor: over.amountMinor ?? 1000,
    currency: over.currency ?? "USD",
    status: over.status ?? "succeeded",
    createdAt: over.createdAt ?? NOW,
    subscriptionId: null,
    customerEmail: null,
    checkoutId: null,
  }
}

function okFeed(payments: ProjectPayment[]): EarningsResult {
  return { status: "ok", payments, fetchedAt: 1, pages: 1 }
}

interface RowInput {
  date: string
  projectId: string
  requests: number
  creditsCharged: number
  providerCostUsd?: number
  providerCostUnavailableCount?: number
}

/** Stub one aggregation read returning fixed day×project rows. */
function stubRows(rows: RowInput[]) {
  const full = rows.map((r) => ({
    succeeded: r.requests,
    failed: 0,
    providerCostUsd: r.providerCostUsd ?? 0,
    providerCostUnavailableCount: r.providerCostUnavailableCount ?? 0,
    providerCostNonUsdCount: 0,
    ...r,
  }))
  vi.mocked(runtimeUsageCol).mockResolvedValue({
    aggregate: () => ({ toArray: async () => full }),
  } as unknown as ReturnType<typeof runtimeUsageCol>)
}

describe("resolvePortfolioRange — only whitelisted windows reach the server", () => {
  it("accepts each advertised range", () => {
    for (const days of [14, 30, 90]) {
      expect(resolvePortfolioRange(String(days))).toBe(days)
    }
  })

  it("falls back to the default window for anything else", () => {
    for (const raw of [null, undefined, "", "7", "3650", "drop table"]) {
      expect(resolvePortfolioRange(raw)).toBe(DEFAULT_PORTFOLIO_RANGE)
    }
  })
})

describe("windowChangePct — no direction without a comparable past", () => {
  it("returns null when the prior window saw zero", () => {
    expect(windowChangePct(500, 0)).toBeNull()
  })

  it("rounds the percentage it does report", () => {
    expect(windowChangePct(150, 100)).toBe(50)
    expect(windowChangePct(75, 100)).toBe(-25)
  })
})

describe("zeroFillPortfolioDaily — a quiet day is a real zero", () => {
  it("emits one point per day, oldest first, ending today", () => {
    const out = zeroFillPortfolioDaily(5, NOW, [dayPoint({ date: utcDate(2), creditsCharged: 7 })])
    expect(out.map((d) => d.date)).toEqual([utcDate(4), utcDate(3), utcDate(2), utcDate(1), utcDate(0)])
    expect(out.find((d) => d.date === utcDate(2))?.creditsCharged).toBe(7)
    expect(out.filter((d) => d.date !== utcDate(2)).every((d) => d.creditsCharged === 0)).toBe(true)
  })

  it("keeps an unreported provider cost null instead of calling it zero", () => {
    const out = zeroFillPortfolioDaily(2, NOW, [
      dayPoint({ date: utcDate(1), requests: 3, providerCostUsd: null, providerCostUnavailableCount: 3 }),
      dayPoint({ date: utcDate(0), requests: 2, providerCostUsd: 0.5, providerCostUnavailableCount: 0 }),
    ])
    expect(out[0].providerCostUsd).toBeNull()
    expect(out[1].providerCostUsd).toBe(0.5)
  })
})

describe("getPortfolioOverview — window split, scoped totals, honesty states", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("reports the requested window and compares it with the equal window before", async () => {
    stubRows([
      // older than the 14-day cut → prior window
      { date: utcDate(20), projectId: "p1", requests: 4, creditsCharged: 500, providerCostUsd: 1 },
      // inside the reported window
      { date: utcDate(3), projectId: "p1", requests: 2, creditsCharged: 100, providerCostUsd: 0.5 },
      { date: utcDate(3), projectId: "p2", requests: 1, creditsCharged: 50, providerCostUsd: 0, providerCostUnavailableCount: 1 },
    ])
    vi.mocked(store.listProjects).mockResolvedValue([
      { id: "p1", name: "Shop" },
      { id: "p2", name: "Docs" },
    ] as never)
    vi.mocked(getProjectEarnings).mockImplementation(async (projectId: string) =>
      projectId === "p1"
        ? okFeed([
            payment({ amountMinor: 900, createdAt: NOW - 2 * DAY_MS }),
            payment({ amountMinor: 5000, createdAt: NOW - 20 * DAY_MS }),
          ])
        : okFeed([]),
    )

    const out = await getPortfolioOverview("u1", 14)

    expect(out.days).toBe(14)
    expect(out.daily).toHaveLength(14)
    expect(out.totals.creditsCharged).toBe(150)
    expect(out.prior.creditsCharged).toBe(500)
    expect(out.spendChangePct).toBe(-70)

    // Earnings follow the same split — the 20-days-ago payment is prior-window.
    expect(out.totals.earningsMinor).toBe(900)
    expect(out.prior.earningsMinor).toBe(5000)

    expect(out.byProject.map((r) => r.projectName)).toEqual(["Shop", "Docs"])
    expect(out.byProject.find((r) => r.projectName === "Shop")?.creditsCharged).toBe(100)
    expect(out.byProject.find((r) => r.projectName === "Docs")?.earningsMinor).toBe(0)

    // A day whose only call reported no numeric cost stays null.
    const busyDay = out.daily.find((d) => d.date === utcDate(3))
    expect(busyDay?.creditsCharged).toBe(150)
    expect(busyDay?.providerCostUsd).toBe(0.5)
  })

  it("leaves earnings null when no feed reported ok", async () => {
    stubRows([{ date: utcDate(1), projectId: "p1", requests: 1, creditsCharged: 10 }])
    vi.mocked(store.listProjects).mockResolvedValue([{ id: "p1", name: "Shop" }] as never)
    vi.mocked(getProjectEarnings).mockResolvedValue({
      status: "unavailable",
      note: "Payment provider not configured.",
    } as unknown as EarningsResult)

    const out = await getPortfolioOverview("u1", 14)

    expect(out.totals.earningsMinor).toBeNull()
    expect(out.earningsStatus).toBe("unavailable")
    expect(out.earningsNote).toContain("not configured")
    // Credits stay complete even when money is unavailable.
    expect(out.totals.creditsCharged).toBe(10)
  })

  it("says so when a portfolio is too large to sweep", async () => {
    stubRows([])
    vi.mocked(store.listProjects).mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, name: `Business ${i}` })) as never,
    )
    vi.mocked(getProjectEarnings).mockResolvedValue({ status: "unavailable", note: "n/a" } as unknown as EarningsResult)

    const out = await getPortfolioOverview("u1", 30)

    expect(out.projectsCount).toBe(30)
    expect(out.earningsSweepComplete).toBe(false)
    expect(out.daily).toHaveLength(30)
    expect(out.daily.every((d) => d.creditsCharged === 0 && d.earningsMinor === 0)).toBe(true)
    expect(out.spendChangePct).toBeNull()
  })
})
