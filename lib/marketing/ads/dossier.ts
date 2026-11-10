import "server-only"

/**
 * Authorized campaign dossier for admins. Never includes credentials, env
 * vars, API keys, or unrelated secrets.
 */

import { store } from "@/lib/store/store"
import { usersCol } from "@/lib/db/collections"
import { readCombinedMarketingPlan, readValuePropositionText } from "@/lib/analysis/plan-sections"
import { STATE_LABELS } from "@/lib/types/project"
import type { AdCampaignRequestDoc } from "@/lib/types/ads"
import { getAdStrategy } from "./strategy"
import { listAdsKitDrafts } from "@/lib/marketing/studio/ads-kit"
import { listActivities, listPerformance } from "./operations"
import { listAdRequestEventsById } from "./requests"
import { AD_ESTIMATE_DISCLAIMER } from "./request-shared"

export async function buildCampaignDossier(request: AdCampaignRequestDoc) {
  const [project, founder, strategy, drafts, events, activities, performance] = await Promise.all([
    store.getProject(request.projectId),
    (await usersCol()).findOne({ id: request.userId }, { projection: { email: 1, name: 1, passwordHash: 0 } }),
    getAdStrategy(request.projectId).catch(() => null),
    listAdsKitDrafts(request.projectId, { limit: 20 }).catch(() => []),
    listAdRequestEventsById(request.id, { includeInternal: true }),
    listActivities(request.id),
    listPerformance(request.id),
  ])

  const spec = project?.specification
  const valueProp = spec ? readValuePropositionText(spec) : ""
  const marketingPlan = spec ? readCombinedMarketingPlan(spec) : ""

  return {
    generatedAt: Date.now(),
    disclaimer: AD_ESTIMATE_DISCLAIMER,
    request: {
      id: request.id,
      status: request.status,
      priority: request.priority ?? "normal",
      submittedAt: request.submittedAt,
      updatedAt: request.updatedAt,
      executionMode: request.executionMode ?? "manual",
      business: request.business,
      promote: request.promote,
      audience: request.audience,
      preferences: request.preferences,
      assets: request.assets,
      creation: request.creation,
      proposal: request.proposal ?? null,
      payment: request.payment
        ? {
            status: request.payment.status,
            creditsCharged: request.payment.creditsCharged,
            chargedAt: request.payment.chargedAt,
            refundedAt: request.payment.refundedAt,
          }
        : null,
    },
    founder: {
      id: request.userId,
      name: founder?.name ?? "",
      email: founder?.email ?? "",
    },
    project: project
      ? {
          source: "project_record" as const,
          id: project.id,
          name: project.name,
          state: project.state,
          stateLabel: STATE_LABELS[project.state],
          idea: project.idea ?? "",
          liveUrl: project.deployment?.productionUrl ?? "",
          sourceUrl: project.sourceUrl ?? "",
        }
      : { source: "missing" as const, id: request.projectId },
    application: {
      source: "project_saved_data" as const,
      valueProposition: valueProp.slice(0, 4000),
      marketingPlan: marketingPlan.slice(0, 8000),
      targetUsers: spec && "targetUsers" in spec ? String((spec as { targetUsers?: unknown }).targetUsers ?? "") : "",
    },
    founderStrategy: strategy
      ? {
          source: "founder_supplied" as const,
          positioning: strategy.positioning,
          icp: strategy.icp,
          geographies: strategy.geographies,
          objectives: strategy.objectives,
          channels: strategy.channels,
          brandVoice: strategy.brandVoice,
          usps: strategy.usps,
        }
      : null,
    generatedAds: drafts.map((draft) => ({
      source: "ai_generated" as const,
      id: draft.id,
      title: draft.title,
      kind: draft.kind,
      createdAt: draft.createdAt,
      hasMedia: draft.hasMedia,
    })),
    timeline: events.map((event) => ({
      id: event.id,
      actor: event.actor,
      action: event.action,
      detail: event.detail ?? "",
      visibility: event.visibility ?? "founder",
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      createdAt: event.createdAt,
    })),
    activities: activities.map((activity) => ({
      id: activity.id,
      title: activity.title,
      status: activity.status,
      channel: activity.channel,
      publicationUrl: activity.publicationUrl,
      notes: activity.notes,
      completedAt: activity.completedAt,
    })),
    performance: performance.map((row) => ({
      id: row.id,
      metric: row.metric,
      value: row.value,
      source: row.source,
      evidenceUrl: row.evidenceUrl,
      note: row.note,
      reportedAt: row.reportedAt,
    })),
  }
}

export function dossierToHtml(dossier: Awaited<ReturnType<typeof buildCampaignDossier>>): string {
  const req = dossier.request
  const sections = [
    ["Campaign request", jsonBlock({
      id: req.id,
      status: req.status,
      submittedAt: new Date(req.submittedAt).toISOString(),
      business: req.business,
      promote: req.promote,
      audience: req.audience,
      preferences: req.preferences,
      creation: req.creation,
    })],
    ["Proposal", req.proposal ? jsonBlock(req.proposal) : "<p>No quotation issued yet.</p>"],
    ["Payment", req.payment ? jsonBlock(req.payment) : "<p>Unpaid — submission does not charge credits.</p>"],
    ["Application (saved project data)", jsonBlock(dossier.application)],
    ["Founder strategy", dossier.founderStrategy ? jsonBlock(dossier.founderStrategy) : "<p>No saved strategy.</p>"],
    ["AI-generated ads (titles only)", jsonBlock(dossier.generatedAds)],
    ["Execution", jsonBlock(dossier.activities)],
    ["Performance (source-aware)", jsonBlock(dossier.performance)],
  ]
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><title>Campaign ${escapeHtml(req.id)}</title>
<style>
body{font-family:Georgia,serif;max-width:880px;margin:40px auto;padding:0 24px;color:#111;line-height:1.5}
h1{font-size:28px}h2{font-size:18px;margin-top:32px}
pre{background:#f6f6f4;padding:12px;overflow:auto;font-size:12px}
.note{font-size:13px;color:#555}
</style></head><body>
<p class="note">Atai campaign brief — print this page to save a PDF. ${escapeHtml(dossier.disclaimer)}</p>
<h1>${escapeHtml(req.business.name)}</h1>
<p>${escapeHtml(req.business.liveUrl)} · ${escapeHtml(req.id)} · ${escapeHtml(req.status)}</p>
${sections.map(([title, body]) => `<h2>${escapeHtml(String(title))}</h2>${body}`).join("\n")}
</body></html>`
}

function jsonBlock(value: unknown): string {
  return `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
