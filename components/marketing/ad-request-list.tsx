import Link from "next/link"
import { AD_REQUEST_STATUS_LABELS } from "@/lib/marketing/ads/request-shared"
import type { AdCampaignRequestDoc } from "@/lib/types/ads"

export function AdRequestList({ projectId, requests }: { projectId: string; requests: AdCampaignRequestDoc[] }) {
  if (requests.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
        You have not asked Atai to promote this business yet. Submitting is free — you are only charged if you later
        approve a quotation.
      </p>
    )
  }
  return (
    <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-card">
      {requests.map((request) => (
        <li key={request.id}>
          <Link
            href={`/project/${projectId}/ads?tab=promote&request=${encodeURIComponent(request.id)}`}
            className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm hover:bg-muted/40"
          >
            <span className="font-medium">{request.business.name}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              {AD_REQUEST_STATUS_LABELS[request.status]}
            </span>
            <span className="text-xs text-muted-foreground">{new Date(request.submittedAt).toLocaleDateString()}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
