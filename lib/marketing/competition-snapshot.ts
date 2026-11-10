import "server-only"
import { createHash } from "node:crypto"

/**
 * Competition snapshot service — the honest v1 of /competition.
 *
 * Atai does not collect live market or competitor data anywhere (research
 * findings are the plan's own gap analysis, not competitor research). So this
 * surface does exactly two honest things:
 *
 *  1. Render the positioning story the founder's plan already holds.
 *  2. Offer a ONE-CLICK competitor-landscape DRAFT written strictly from the
 *     plan context, persisted as a kit-stamped draft (`kit: "competition"`,
 *     `kitSlot: "snapshot"`). The prompt forbids naming real companies that
 *     are not in the context and forbids market sizes, prices, rankings and
 *     other invented facts — every inference stays labelled as one.
 *
 * The prompt is Competition's OWN dedicated assembly
 * (`./competition-snapshot-context`) — the studio's generic brief template is
 * bypassed entirely, and the plan context budget is large enough that a
 * full-length plan is not silently truncated.
 */

import { contentItemsCol } from "@/lib/db/collections"
import { AppError } from "@/lib/errors"
import { readCombinedMarketingPlan } from "@/lib/analysis/plan-sections"
import type { OwnerGoals } from "@/lib/marketing/growth-overview"
import type { ContentItemDoc } from "@/lib/types/db"
import type { MirrorProject } from "@/lib/types/project"
import type { ApplicationSpecification } from "@/lib/types/specification"
import {
  COMPETITION_SNAPSHOT_TITLE,
  buildCompetitionSnapshotMessages,
} from "./competition-snapshot-context"
import { generateMarketContent, type MarketContentView } from "./studio/market-service"

const SNAPSHOT_MAX_TOKENS = 1_200

export interface CompetitionSnapshotView {
  id: string
  title: string
  body: string
  creditsCharged: number
  createdAt: number
  contextHash?: string
}

export function competitionContextHash(project: MirrorProject, goals?: OwnerGoals | null): string {
  return createHash("sha256").update(JSON.stringify({
    name: project.name,
    idea: project.idea,
    description: project.specification?.description,
    plan: readCombinedMarketingPlan(project.specification),
    targetUsers: project.specification?.targetUsers,
    siteUrl: project.deployment?.status === "success" ? project.deployment.productionUrl : undefined,
    goals: goals ?? undefined,
  })).digest("hex")
}

/** Generate one competitor-landscape draft from the plan and persist it. */
export async function generateCompetitionSnapshot(input: {
  userId: string
  projectId: string
  project: MirrorProject
  ownerGoals?: OwnerGoals | null
}): Promise<MarketContentView> {
  if (input.project.id !== input.projectId || input.project.userId !== input.userId) {
    throw new AppError("UNAUTHORIZED_PROJECT_ACCESS")
  }
  const spec = (input.project.specification ?? undefined) as ApplicationSpecification | undefined
  if (!spec) {
    throw new AppError("VALIDATION", "The competitor snapshot drafts from your plan — this project has no plan yet.")
  }

  const messages = buildCompetitionSnapshotMessages({
    projectName: input.project.name,
    description: spec.description,
    idea: input.project.idea,
    marketingPlan: readCombinedMarketingPlan(spec),
    targetUsers: spec.targetUsers,
    siteUrl:
      input.project.deployment?.status === "success" ? input.project.deployment?.productionUrl : undefined,
    goals: input.ownerGoals ?? undefined,
  })

  return generateMarketContent({
    userId: input.userId,
    projectId: input.projectId,
    kind: "brief",
    // The full assembled prompt is stored as the brief so the library keeps
    // an honest record of what the model was asked, not a 2,000-char slice.
    brief: messages.prompt,
    messages,
    maxTokens: SNAPSHOT_MAX_TOKENS,
    title: COMPETITION_SNAPSHOT_TITLE,
    kit: "competition",
    kitSlot: "snapshot",
    kitInput: { contextHash: competitionContextHash(input.project, input.ownerGoals) },
    tone: "professional",
    length: "medium",
  })
}

function toSnapshotView(doc: ContentItemDoc): CompetitionSnapshotView {
  return {
    id: doc.id,
    title: doc.title,
    body: doc.body,
    creditsCharged: doc.creditsCharged ?? 0,
    createdAt: doc.createdAt,
    contextHash: doc.kitInput?.contextHash,
  }
}

export async function listCompetitionSnapshots(
  userId: string,
  projectId: string,
): Promise<CompetitionSnapshotView[]> {
  const col = await contentItemsCol()
  const docs = await col
    .find(
      { userId, projectId, kind: "marketing_asset", kit: "competition", kitSlot: "snapshot" },
      { projection: { id: 1, title: 1, body: 1, creditsCharged: 1, createdAt: 1, "kitInput.contextHash": 1 } },
    )
    .sort({ createdAt: -1 })
    .limit(25)
    .toArray()
  return docs.map(toSnapshotView)
}
