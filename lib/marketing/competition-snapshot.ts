import "server-only"

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
 */

import { contentItemsCol } from "@/lib/db/collections"
import { AppError } from "@/lib/errors"
import { readCombinedMarketingPlan } from "@/lib/analysis/plan-sections"
import { readOwnerGoals, type OwnerGoals } from "@/lib/marketing/growth-overview"
import type { ContentItemDoc } from "@/lib/types/db"
import type { MirrorProject } from "@/lib/types/project"
import type { ApplicationSpecification } from "@/lib/types/specification"
import { generateMarketContent, type MarketContentView } from "./studio/market-service"
import { buildLaunchKitContext } from "./studio/launch-kit-content"

const SNAPSHOT_TITLE = "Competitor snapshot (AI draft)"

const SNAPSHOT_ASK =
  "Draft a competitor-landscape snapshot for this product, written ONLY from the context provided. " +
  "Cover, each under its own short heading: 1 'Competitor types' — the kinds of alternatives these users likely " +
  "use today (describe types, do not name real companies unless they appear in the context); " +
  "2 'How this product is positioned' — what the plan says sets it apart, restated clearly; " +
  "3 'Where the plan is unproven' — the claims that would need real market evidence; " +
  "4 'What to watch' — two or three things worth checking about the space, phrased as questions. " +
  "Never invent market sizes, prices, rankings, reviews, funding, or statistics. Every statement that is an " +
  "inference rather than something the plan says must be plainly worded as an inference."

export interface CompetitionSnapshotView {
  id: string
  title: string
  body: string
  creditsCharged: number
  createdAt: number
}

/** Generate one competitor-landscape draft from the plan and persist it. */
export async function generateCompetitionSnapshot(input: {
  userId: string
  projectId: string
  project: MirrorProject
  ownerGoals?: OwnerGoals | null
}): Promise<MarketContentView> {
  const spec = (input.project.specification ?? undefined) as ApplicationSpecification | undefined
  if (!spec) {
    throw new AppError("VALIDATION", "The competitor snapshot drafts from your plan — this project has no plan yet.")
  }

  const context = buildLaunchKitContext({
    projectName: input.project.name,
    description: spec.description,
    idea: input.project.idea,
    marketingPlan: readCombinedMarketingPlan(spec).trim(),
    targetUsers: spec.targetUsers,
    siteUrl:
      input.project.deployment?.status === "success" ? input.project.deployment?.productionUrl : undefined,
    goals: input.ownerGoals ?? undefined,
  })

  return generateMarketContent({
    userId: input.userId,
    projectId: input.projectId,
    kind: "brief",
    brief: `${SNAPSHOT_ASK}\n\nContext you must draw from — do not invent facts that are not here:\n${context}`,
    title: SNAPSHOT_TITLE,
    kit: "competition",
    kitSlot: "snapshot",
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
  }
}

/** The NEWEST competitor-snapshot draft, or null when none exists yet. */
export async function getCompetitionSnapshot(projectId: string): Promise<CompetitionSnapshotView | null> {
  const col = await contentItemsCol()
  const [doc] = (await col
    .find(
      { projectId, kind: "marketing_asset", kit: "competition", kitSlot: "snapshot" },
      { projection: { "media.dataUrl": 0 } },
    )
    .sort({ createdAt: -1 })
    .limit(1)
    .toArray()) as unknown as ContentItemDoc[]
  return doc ? toSnapshotView(doc) : null
}
