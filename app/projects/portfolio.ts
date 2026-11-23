import type { ProjectSummary } from "@/lib/types/project"
import type { BusinessStatus } from "@/lib/types/business"

/**
 * The portfolio on /projects holds two kinds of business: the ones Atai builds
 * (projects) and the ones a founder already runs (connected businesses). They
 * share one card, one search, one set of tabs — only the destination, the label
 * and the status badge differ. Everything here is pure so it can be tested
 * without rendering the page.
 */

export interface FinancialSummary {
  earningsMinor: number | null
  creditsCharged: number
  providerCostUsd: number | null
  currency: string | null
  hasFinancialData: boolean
}

export interface EnrichedProject extends ProjectSummary {
  financialSummary?: FinancialSummary
}

export interface ConnectedBusinessItem {
  kind: "business"
  id: string
  name: string
  status: BusinessStatus
  updatedAt: number
}

export type PortfolioItem = (EnrichedProject & { kind?: "project" }) | ConnectedBusinessItem

export function isConnectedBusinessItem(item: PortfolioItem): item is ConnectedBusinessItem {
  return item.kind === "business"
}

export function modeLabel(mode: string): string {
  if (mode === "connected") return "Connected business"
  if (mode === "website") return "Reference build"
  if (mode === "github") return "GitHub build"
  return "Idea build"
}

export function itemMode(item: PortfolioItem): string {
  return isConnectedBusinessItem(item) ? "connected" : item.mode
}

export function itemLabel(item: PortfolioItem): string {
  return isConnectedBusinessItem(item) ? "Connected business" : modeLabel(item.mode)
}

export function itemHref(item: PortfolioItem): string {
  if (isConnectedBusinessItem(item)) return `/business/${item.id}`
  return item.state === "plan_ready" ? `/project/${item.id}/collaborate` : `/project/${item.id}`
}

export type BusinessTab = "all" | "in-progress" | "live" | "needs-attention" | "archived"

export type SortKey = "updatedAt" | "name" | "revenue" | "profit"

const IN_PROGRESS_STATES = [
  "created",
  "analyzing",
  "analysis_complete",
  "specification_ready",
  "plan_ready",
  "awaiting_build_confirmation",
  "pending_plan",
  "building",
  "build_complete",
  "deploying",
]

const LIVE_STATES = ["ready", "deployed"]

const ATTENTION_STATES = ["analysis_failed", "plan_failed", "build_failed", "deployment_failed"]

/** A connected business has no build state, so its status answers the same question. */
export function matchesTab(item: PortfolioItem, tab: BusinessTab): boolean {
  if (tab === "all") return true
  if (isConnectedBusinessItem(item)) {
    switch (tab) {
      case "in-progress":
        return item.status === "draft"
      case "live":
        return item.status === "active"
      case "needs-attention":
        return item.status === "suspended"
      case "archived":
        return item.status === "archived"
    }
  }
  switch (tab) {
    case "in-progress":
      return IN_PROGRESS_STATES.includes(item.state)
    case "live":
      return LIVE_STATES.includes(item.state)
    case "needs-attention":
      return item.state === "plan_ready" || ATTENTION_STATES.includes(item.state)
    case "archived":
      return false
  }
}

function profitOf(item: PortfolioItem): number {
  if (isConnectedBusinessItem(item)) return -Infinity
  const finance = item.financialSummary
  if (!finance || finance.earningsMinor === null) return -Infinity
  return finance.earningsMinor / 100 - (finance.providerCostUsd ?? 0)
}

export function sortPortfolio(items: PortfolioItem[], sort: SortKey): PortfolioItem[] {
  return [...items].sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name)
    if (sort === "revenue") {
      if (isConnectedBusinessItem(a) || isConnectedBusinessItem(b)) return b.updatedAt - a.updatedAt
      return (b.financialSummary?.earningsMinor ?? -1) - (a.financialSummary?.earningsMinor ?? -1)
    }
    if (sort === "profit") {
      if (isConnectedBusinessItem(a) || isConnectedBusinessItem(b)) return b.updatedAt - a.updatedAt
      return profitOf(b) - profitOf(a)
    }
    return b.updatedAt - a.updatedAt
  })
}

export function filterPortfolio(
  items: PortfolioItem[],
  input: { tab: BusinessTab; search: string; sort: SortKey },
): PortfolioItem[] {
  const query = input.search.trim().toLowerCase()
  const matched = items.filter((item) => {
    if (!matchesTab(item, input.tab)) return false
    if (!query) return true
    if (item.name.toLowerCase().includes(query)) return true
    return !isConnectedBusinessItem(item) && Boolean(item.sourceUrl?.toLowerCase().includes(query))
  })
  return sortPortfolio(matched, input.sort)
}

export function countTabs(items: PortfolioItem[]): Record<BusinessTab, number> {
  const counts: Record<BusinessTab, number> = {
    all: 0,
    "in-progress": 0,
    live: 0,
    "needs-attention": 0,
    archived: 0,
  }
  for (const item of items) {
    counts.all++
    for (const tab of ["in-progress", "live", "needs-attention", "archived"] as const) {
      if (matchesTab(item, tab)) counts[tab]++
    }
  }
  return counts
}
