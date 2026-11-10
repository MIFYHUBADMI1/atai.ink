import type {
  AdCampaignActivityDoc,
  AdCampaignPerformanceDoc,
  AdCampaignRequestDoc,
  AdPricingPackageDoc,
  AdRequestEventDoc,
} from "@/lib/types/ads"

export function publicRequestView(request: AdCampaignRequestDoc) {
  return {
    id: request.id,
    projectId: request.projectId,
    status: request.status,
    business: request.business,
    promote: request.promote,
    audience: request.audience,
    preferences: request.preferences,
    assets: request.assets,
    creation: request.creation,
    proposal: request.proposal
      ? {
          version: request.proposal.version,
          title: request.proposal.title,
          description: request.proposal.description,
          objectives: request.proposal.objectives,
          audience: request.proposal.audience,
          platforms: request.proposal.platforms,
          formats: request.proposal.formats,
          creativeScope: request.proposal.creativeScope,
          duration: request.proposal.duration,
          frequency: request.proposal.frequency,
          deliverables: request.proposal.deliverables,
          estimatedImpressionsMin: request.proposal.estimatedImpressionsMin,
          estimatedImpressionsMax: request.proposal.estimatedImpressionsMax,
          estimateNote: request.proposal.estimateNote,
          startDate: request.proposal.startDate,
          endDate: request.proposal.endDate,
          creditsPrice: request.proposal.creditsPrice,
          breakdown: request.proposal.breakdown,
          conditions: request.proposal.conditions,
          customerInstructions: request.proposal.customerInstructions,
          issuedAt: request.proposal.issuedAt,
          expiresAt: request.proposal.expiresAt,
        }
      : null,
    payment: request.payment
      ? {
          status: request.payment.status,
          creditsCharged: request.payment.creditsCharged,
          chargedAt: request.payment.chargedAt,
          refundedAt: request.payment.refundedAt,
        }
      : { status: "unpaid" as const, creditsCharged: 0 },
    executionMode: request.executionMode ?? "manual",
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    submittedAt: request.submittedAt,
  }
}

export function publicEventView(event: AdRequestEventDoc) {
  return {
    id: event.id,
    actor: event.actor,
    action: event.action,
    detail: event.detail ?? "",
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    createdAt: event.createdAt,
  }
}

export function publicActivityView(activity: AdCampaignActivityDoc) {
  return {
    id: activity.id,
    title: activity.title,
    notes: activity.notes,
    status: activity.status,
    channel: activity.channel,
    publicationUrl: activity.publicationUrl,
    publishedAt: activity.publishedAt,
    createdAt: activity.createdAt,
    updatedAt: activity.updatedAt,
    completedAt: activity.completedAt,
  }
}

export function publicPerformanceView(row: AdCampaignPerformanceDoc) {
  return {
    id: row.id,
    metric: row.metric,
    value: row.value,
    source: row.source,
    evidenceUrl: row.evidenceUrl,
    note: row.note,
    reportedAt: row.reportedAt,
  }
}

export function publicPackageView(pkg: AdPricingPackageDoc) {
  return {
    id: pkg.id,
    name: pkg.name,
    description: pkg.description,
    durationDays: pkg.durationDays,
    creditsPrice: pkg.creditsPrice,
    estimatedImpressionsMin: pkg.estimatedImpressionsMin,
    estimatedImpressionsMax: pkg.estimatedImpressionsMax,
    channels: pkg.channels,
    active: pkg.active,
  }
}

export function adminRequestSummary(request: AdCampaignRequestDoc) {
  return {
    id: request.id,
    projectId: request.projectId,
    userId: request.userId,
    businessName: request.business.name,
    liveUrl: request.business.liveUrl,
    objective: request.preferences.objective || request.promote.goals[0] || "",
    channels: request.preferences.channels,
    budgetNote: request.preferences.budgetNote,
    status: request.status,
    priority: request.priority ?? "normal",
    assignedAdminEmail: request.assignedAdminEmail ?? "",
    submittedAt: request.submittedAt,
    updatedAt: request.updatedAt,
    creditsCharged: request.payment?.status === "paid" ? request.payment.creditsCharged : 0,
  }
}
