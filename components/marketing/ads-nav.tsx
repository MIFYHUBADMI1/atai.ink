import Link from "next/link"
import { cn } from "@/lib/utils"

export const ADS_TABS = [
  { key: "overview", label: "Overview" },
  { key: "strategy", label: "Strategy" },
  { key: "bench", label: "Ad bench" },
  { key: "promote", label: "Promote with Atai" },
  { key: "history", label: "History" },
] as const

export type AdsTab = (typeof ADS_TABS)[number]["key"]

export function isAdsTab(value: string | undefined): value is AdsTab {
  return (ADS_TABS as readonly { key: string }[]).some((t) => t.key === value)
}

/**
 * Growth Center sub-navigation. Links (not client state) so every tab is a
 * real URL that survives refresh and can be bookmarked — same pattern as the
 * Studio's tabs.
 */
export function AdsNav({ projectId, active }: { projectId: string; active: AdsTab }) {
  return (
    <nav aria-label="Ads and growth sections" className="mb-6 flex flex-wrap gap-1 border-b border-border pb-2">
      {ADS_TABS.map((tab) => {
        const isActive = tab.key === active
        return (
          <Link
            key={tab.key}
            href={`/project/${projectId}/ads?tab=${tab.key}`}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
