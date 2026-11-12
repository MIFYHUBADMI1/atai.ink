import "server-only"
import { createHash } from "node:crypto"

/**
 * Competition snapshot service.
 *
 * The v1 snapshot was written strictly from the founder's own plan — an
 * honest limitation, because Atai collected no live market data anywhere.
 * That limitation is now lifted AT THE FOUNDER'S REQUEST: each snapshot run
 * first performs live web research (Firecrawl /v2/search across web, news,
 * the research category, and Alexandria data-tool discovery — see
 * `./competition-research`), then the analysis is written grounded in exactly
 * those sources, and every source is persisted on the snapshot and rendered
 * on the page as a reference. The plan still anchors positioning and
 * audience; the sources anchor every company, number, and funding event.
 *
 * Honesty invariants that must not regress:
 *  - Sources are real search results returned at query time, shown with
 *    links and dates — never presented as verified or current-forever data.
 *  - The research step is billed like every market feature (fixed ledger
 *    charge, refunded when the run fails); the AI analysis is metered
 *    through the runtime router.
 *  - The prompt is Competition's OWN dedicated assembly
 *    (`./competition-research-context`) — no studio template injection, and
 *    nothing is dropped from the prompt without an explicit omission marker.
 */

import { contentItemsCol } from "@/lib/db/collections"
import { AppError } from "@/lib/errors"
import { readCombinedMarketingPlan } from "@/lib/analysis/plan-sections"
import type { OwnerGoals } from "@/lib/marketing/growth-overview"
import type { ContentItemDoc, MarketAssetResearch } from "@/lib/types/db"
import type { MirrorProject } from "@/lib/types/project"
import type { ApplicationSpecification } from "@/lib/types/specification"
import { COMPETITION_SNAPSHOT_TITLE } from "./competition-snapshot-context"
import { buildCompetitionResearchMessages } from "./competition-research-context"
import {
  chargeCompetitionResearchCredits,
  getCompetitionResearchCost,
  refundCompetitionResearchCredits,
  runCompetitionResearch,
} from "./competition-research"
import { generateMarketContent, type MarketContentView } from "./studio/market-service"

const SNAPSHOT_MAX_TOKENS = 1_600

export interface CompetitionSnapshotView {
  id: string
  title: string
  body: string
  creditsCharged: number
  createdAt: number
  contextHash?: string
  /** Live-research evidence behind this snapshot (absent on pre-research drafts). */
  research?: MarketAssetResearch
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

/** Generate one live-researched competitor snapshot and persist it. */
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
    throw new AppError("VALIDATION", "The competitor snapshot builds on your plan — this project has no plan yet.")
  }

  const cost = getCompetitionResearchCost()
  const charged = await chargeCompetitionResearchCredits(input.userId, input.projectId)
  if (!charged) {
    throw new AppError(
      "INSUFFICIENT_CREDITS",
      `Live competitor research costs ${cost} credits and you don't have enough available.`,
    )
  }

  try {
    const { research } = await runCompetitionResearch({
      userId: input.userId,
      projectId: input.projectId,
      project: input.project,
    })

    const messages = buildCompetitionResearchMessages({
      projectName: input.project.name,
      description: spec.description,
      idea: input.project.idea,
      marketingPlan: readCombinedMarketingPlan(spec),
      targetUsers: spec.targetUsers,
      siteUrl:
        input.project.deployment?.status === "success" ? input.project.deployment?.productionUrl : undefined,
      goals: input.ownerGoals ?? undefined,
      research: { queries: research.queries, sources: research.sources },
    })

    return await generateMarketContent({
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
      research: { ...research, researchCreditsCharged: cost },
    })
  } catch (e) {
    // The founder got nothing usable (no searches, or no persisted snapshot):
    // give the research credits back rather than billing for a failure. The
    // refund helper logs its own outcome.
    await refundCompetitionResearchCredits(input.userId, input.projectId, cost)
    throw e
  }
}

function toSnapshotView(doc: ContentItemDoc): CompetitionSnapshotView {
  return {
    id: doc.id,
    title: doc.title,
    body: doc.body,
    creditsCharged: doc.creditsCharged ?? 0,
    createdAt: doc.createdAt,
    contextHash: doc.kitInput?.contextHash,
    ...(doc.research ? { research: doc.research } : {}),
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
      {
        projection: {
          id: 1,
          title: 1,
          body: 1,
          creditsCharged: 1,
          createdAt: 1,
          "kitInput.contextHash": 1,
          research: 1,
        },
      },
    )
    .sort({ createdAt: -1 })
    .limit(25)
    .toArray()
  return docs.map(toSnapshotView)
}
