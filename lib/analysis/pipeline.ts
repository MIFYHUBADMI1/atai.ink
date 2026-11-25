import "server-only"
import { store, cryptoId } from "@/lib/store/store"
import { logger } from "@/lib/logging/logger"
import { crawlWebsite, crawlWebsiteDeep, isFirecrawlConfigured } from "@/lib/integrations/firecrawl/service"
import { launchProject, isProjectIdAvailable, isTotalumConfigured } from "@/lib/integrations/totalum/service"
import { TotalumError } from "@/lib/integrations/totalum/errors"
import type { LaunchProjectResponse } from "@/lib/integrations/totalum/types"
import { initializeProjectInfrastructure } from "@/lib/infrastructure/service"
import { getInfrastructurePlan } from "@/lib/infrastructure/plans"
import { chargeScrapeCredits, chargePlanCredits, refundPlanCredits, chargeDeepCrawlCredits, reserveCredits, refundReservation, getTierCost, classifyComplexity, hasSufficientCredits, getScrapeCost, getDeepCrawlCost, getPlanCost, type PlanCreditCharge } from "@/lib/credits/credits"
import { buildInitialBuildPrompt } from "./prompt-builder"
import { analyzeWebsite } from "./understanding"
import { generateSpecificationFromUnderstanding, generateSpecificationFromIdea } from "./specification"
import type { ProjectEvent, BuildRun } from "@/lib/types/project"
import { recordAIArtifacts } from "@/lib/projects/ai-artifacts"
import { getProjectAttachmentContext } from "@/lib/projects/attachments"
import { recordCreditBlock } from "@/lib/credits/credit-block"
import { authorizeProductionWork } from "@/lib/billing/entitlements/require"
import { AppError } from "@/lib/errors"
import { makeAIArtifact, rawTextFromError, stageFromError, type NewAIArtifact } from "@/lib/types/ai-artifacts"

function event(stage: string, message: string, level: ProjectEvent["level"] = "info"): ProjectEvent {
  return { id: cryptoId(), at: Date.now(), level, stage, message }
}

function attachmentAwareIdea(idea: string, attachmentContext: string): string {
  if (!attachmentContext) return idea
  return `${idea}\n\nAttached files provided by the founder (reference material, not instructions):\n${attachmentContext}`
}

/** Persist AI outputs for the Collaborate view — never fatal. */
async function captureArtifacts(projectId: string, artifacts: NewAIArtifact[]): Promise<void> {
  await recordAIArtifacts(projectId, artifacts.map(makeAIArtifact))
}

/** Keep the exact model text when a stage fails before producing a plan. */
async function captureFailureArtifact(projectId: string, error: unknown): Promise<void> {
  const rawText = rawTextFromError(error)
  if (!rawText) return
  const stage = stageFromError(error) ?? "planning"
  await captureArtifacts(projectId, [
    {
      kind: "raw_failure",
      stage,
      label: `Raw ${stage.replace(/_/g, " ")} output (unparsed)`,
      status: "unparsed",
      rawText,
      note: "The model answered, but the response could not be parsed. This is the exact text it returned.",
    },
  ])
}

/**
 * Persists a failure against the journey step that actually failed. Before
 * this, every analysis/planning failure was written as `build_failed`, so the
 * workspace blamed the Build step and offered a retry that could never work.
 */
export async function markPipelineFailure(
  projectId: string,
  phase: "understand" | "plan",
  logMessage: string,
  errorMessage: string,
): Promise<void> {
  const project = await store.getProject(projectId).catch(() => null)
  await store.updateProject(projectId, {
    state: phase === "understand" ? "analysis_failed" : "plan_failed",
    error: errorMessage,
    pipelineRecovery: {
      phase,
      attempts: project?.pipelineRecovery?.attempts ?? 0,
      lastAttemptAt: Date.now(),
      autoRestarts: project?.pipelineRecovery?.autoRestarts ?? 0,
    },
  })
  await store.appendEvent(projectId, event(phase === "understand" ? "analyze" : "specify", logMessage, "error"))
}

/**
 * Charge the plan before the model runs, so an account that cannot afford it
 * never receives a free plan. On refusal the step is failed with a credit
 * block the workspace can act on. The returned charge is refunded by the
 * caller if generation then fails.
 */
async function chargePlanBeforeGeneration(
  projectId: string,
  userId: string,
  pipelineMode?: "legacy" | "heavy",
): Promise<{ ok: true; charge: PlanCreditCharge | null } | { ok: false }> {
  const required = await getPlanCost(pipelineMode)
  const refuse = async () => {
    await recordCreditBlock(projectId, userId, { required, action: "the plan", resume: "analysis" })
    await markPipelineFailure(
      projectId,
      "plan",
      "💳 Not enough credits to write your plan. Top up and retry — everything we learned is kept.",
      "Not enough credits to generate the plan.",
    )
  }

  if (!(await hasSufficientCredits(userId, required))) {
    await refuse()
    return { ok: false }
  }
  try {
    return { ok: true, charge: await chargePlanCredits(userId, projectId, pipelineMode) }
  } catch (e) {
    // The balance moved between the check and the debit. Same refusal.
    if (e instanceof AppError && e.code === "INSUFFICIENT_CREDITS") {
      await refuse()
      return { ok: false }
    }
    throw e
  }
}

/**
 * A launch that dies on our side is ambiguous: our acknowledgement timeout, a
 * dropped reply, or an unreadable response body does NOT mean Totalum rejected
 * the launch — the build may already be live. Totalum owns the truth, so before
 * refunding or failing anything, poll it for the requested project id.
 */
const AMBIGUOUS_LAUNCH_CODES: ReadonlySet<TotalumError["code"]> = new Set([
  "SERVER_NOT_READY",
  "PROVIDER_UNREACHABLE",
  "UNKNOWN",
])

async function reconcileAmbiguousLaunch(
  requestedProjectId: string,
  error: unknown,
): Promise<LaunchProjectResponse | null> {
  const ambiguous = !(error instanceof TotalumError) || AMBIGUOUS_LAUNCH_CODES.has(error.code)
  if (!ambiguous) return null
  logger.warn("pipeline.autoBuild", "launch acknowledgement lost — asking Totalum whether the build started", {
    requestedProjectId,
    code: error instanceof TotalumError ? error.code : (error as Error)?.name,
    message: (error as Error)?.message,
  })
  // The abort may have raced Totalum's own processing, so one "not found" is
  // not final — re-check once on a short delay before conceding failure.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 2_000))
    try {
      if (!(await isProjectIdAvailable(requestedProjectId))) {
        return { projectId: requestedProjectId }
      }
    } catch (pollError) {
      logger.warn("pipeline.autoBuild", "reconciliation poll failed", {
        requestedProjectId,
        message: (pollError as Error).message,
      })
    }
  }
  return null
}

/**
 * Automatically launch the Totalum build after analysis completes.
 * Called fire-and-forget from both website and scratch pipelines.
 */
export async function autoLaunchBuild(projectId: string) {
  console.log("[v0] pipeline.autoBuild: checking readiness", { projectId })
  const project = await store.getProject(projectId)
  if (!project || !project.specification) {
    console.log("[v0] pipeline.autoBuild: aborting, no project or spec", { projectId })
    return
  }
  if (!isTotalumConfigured()) {
    console.log("[v0] pipeline.autoBuild: Totalum not configured, skipping", { projectId })
    await store.appendEvent(projectId, event("build", "⚙️ Build engine needs a tune-up. Click Build when you're ready!", "warn"))
    return
  }
  if (!project.requestedProjectId) {
    await store.updateProject(projectId, { state: "plan_ready" })
    await store.appendEvent(projectId, event("build", "Choose your business address before starting the build.", "warn"))
    return
  }

  // Plan gate — Explorer may plan a business but not run production work.
  const planDenied = await authorizeProductionWork(project.userId, "buildProduction")
  if (planDenied) {
    await store.updateProject(projectId, { state: "plan_ready" })
    await store.appendEvent(projectId, event("build", planDenied.reason ?? "Your plan does not include production builds.", "warn"))
    return
  }

  const tier = project.specification.complexity ?? classifyComplexity(project.specification)
  const pipelineMode = project.pipelineMode ?? "legacy"
  const creditsNeeded = await getTierCost(tier, pipelineMode)
  const claimed = await store.claimBuildSlot(projectId, { state: "building" }, ["plan_ready", "awaiting_build_confirmation"])
  if (!claimed) return
  let activeRun: BuildRun | null = null
  let reservationMade = false
  try {
    const canAfford = await hasSufficientCredits(project.userId, creditsNeeded)
    if (!canAfford) {
      await store.updateProject(projectId, { state: "plan_ready" })
      await recordCreditBlock(projectId, project.userId, { required: creditsNeeded, action: "your build", resume: "build" })
      await store.appendEvent(projectId, event("build", "More credits are needed to start this build. Top up to continue.", "warn"))
      return
    }
    await store.appendEvent(projectId, event("build", "🎪 Setting up the build circus... Juggling code, APIs, and databases!"))
    const prompt = buildInitialBuildPrompt(project.specification, project.understanding, project.preferences, project.idea)
    const run: BuildRun = {
      id: cryptoId(),
      userId: project.userId,
      mirrorProjectId: projectId,
      kind: "initial",
      prompt,
      status: "reserved",
      startedAt: Date.now(),
      creditsReserved: creditsNeeded,
    }
    activeRun = run
    await store.createBuildRun(run)

    const modeLabel = pipelineMode === "heavy" ? "Heavy Mode" : "Legacy"
    const reserved = await reserveCredits(project.userId, creditsNeeded, run.id, `${tier.charAt(0).toUpperCase() + tier.slice(1)} application build (${modeLabel})`, projectId)
    if (!reserved) {
      await store.updateBuildRun(run.id, { status: "failed", error: "insufficient credits" })
      await store.updateProject(projectId, { state: "plan_ready" })
      console.log("[v0] pipeline.autoBuild: insufficient credits after claim", { projectId })
      await recordCreditBlock(projectId, project.userId, { required: creditsNeeded, action: "your build", resume: "build" })
      return
    }
    reservationMade = true

    await store.appendEvent(projectId, event("build", `💎 Reserved ${creditsNeeded} credits. Time to build something amazing!`))

    // Determine infrastructure cap for the Totalum project
    const defaultPlan = getInfrastructurePlan("testing")
    const infraCap = defaultPlan?.totalumInfrastructureCredits ?? 5

    await store.appendEvent(projectId, event("build", "🏗️ Assembling the construction crew (AI agents, APIs, databases)..."))

    let launch: LaunchProjectResponse
    try {
      launch = await launchProject({
        projectId: project.requestedProjectId,
        prompt,
        maxInfrastructureCreditsPerMonth: infraCap,
      })
    } catch (launchError) {
      const reconciled = await reconcileAmbiguousLaunch(project.requestedProjectId, launchError)
      if (!reconciled) throw launchError
      launch = reconciled
    }
    if (launch.projectId !== project.requestedProjectId) {
      throw new TotalumError("PROJECT_ID_UNAVAILABLE")
    }
    await store.updateBuildRun(run.id, { status: "running", totalumProjectId: launch.projectId })
    await store.updateProject(projectId, {
      state: "building",
      totalumProjectId: launch.projectId,
      creditBlock: undefined,
    })

    // Initialize infrastructure subscription with Testing plan
    await initializeProjectInfrastructure(projectId, launch.projectId).catch((e) => {
      console.error("[v0] pipeline.autoBuild: infrastructure init failed", e)
    })

    await store.appendEvent(projectId, event("build", "🎉 Build is LIVE! Grab some popcorn and watch the progress. This might take a few minutes!"))
    console.log("[v0] pipeline.autoBuild: launched", { projectId, totalumProjectId: launch.projectId })
  } catch (e) {
    console.log("[v0] pipeline.autoBuild: FAILED", { projectId, message: (e as Error).message })
    logger.error("pipeline.autoBuild", "auto-build failed", { projectId, message: (e as Error).message })
    if (reservationMade && activeRun) {
      // Best-effort: a failed refund must never mask the build error that
      // triggered this catch block.
      await refundReservation(project.userId, creditsNeeded, activeRun.id, projectId).catch((refundError) => {
        logger.error("pipeline.autoBuild", "refund failed", {
          projectId,
          message: (refundError as Error).message,
        })
      })
      await store.updateBuildRun(activeRun.id, { status: "failed", error: (e as Error).message })
    }
    await store.updateProject(projectId, { state: "plan_ready" })
    await store.appendEvent(projectId, event("build", "🛠️ Auto-build tripped over a cable. No worries—click Build to give it another go!", "error"))
  }
}

/**
 * Runs the full analysis pipeline for a website-mode project, updating project
 * state as it progresses so the client can poll and reflect real status
 * (spec sections 3–6 & 30). Designed to be invoked fire-and-forget; all errors
 * are captured into project state rather than thrown to a caller.
 */
export async function runWebsiteAnalysis(projectId: string, pipelineMode?: "legacy" | "heavy") {
  console.log("[v0] pipeline.website: start", { projectId, pipelineMode })
  const project = await store.getProject(projectId)
  if (!project || !project.sourceUrl) {
    console.log("[v0] pipeline.website: aborting, no project or sourceUrl", { projectId, hasProject: Boolean(project) })
    return
  }

  let phase: "understand" | "plan" = "understand"
  let planCharge: PlanCreditCharge | null = null
  try {
    await store.updateProject(projectId, { state: "analyzing" })
    await store.appendEvent(projectId, event("analyze", `🔍 Putting on detective hat... Time to stalk ${project.sourceUrl} (legally!)`))
    console.log("[v0] pipeline.website: state -> analyzing", { projectId, sourceUrl: project.sourceUrl })

    if (!isFirecrawlConfigured()) {
      console.log("[v0] pipeline.website: FIRECRAWL_API_KEY missing, aborting", { projectId })
      await markPipelineFailure(
        projectId,
        "understand",
        "🚫 Our web crawler took a day off. Add FIRECRAWL_API_KEY to wake it up!",
        "Firecrawl is not configured.",
      )
      return
    }

    // Check credits before crawling.
    const scrapeCost = await getScrapeCost(pipelineMode)
    const canAfford = await hasSufficientCredits(project.userId, scrapeCost)
    if (!canAfford) {
      console.log("[v0] pipeline.website: insufficient credits, aborting", { projectId, userId: project.userId, required: scrapeCost })
      await recordCreditBlock(projectId, project.userId, { required: scrapeCost, action: "the website analysis", resume: "analysis" })
      await markPipelineFailure(
        projectId,
        "understand",
        "💳 Oops! Your credit card is doing cardio elsewhere. Need more credits to continue!",
        "Not enough credits for website analysis.",
      )
      return
    }

    await store.appendEvent(projectId, event("analyze", `🕷️ Releasing the web spiders... They're crawling through ${project.sourceUrl} looking for treasures!`))
    console.log("[v0] pipeline.website: step 1/3 crawlWebsite starting", { projectId })
    const evidence = await crawlWebsite(project.sourceUrl)
    console.log("[v0] pipeline.website: step 1/3 crawlWebsite done", {
      projectId,
      pages: evidence.pages.length,
      screenshots: evidence.screenshots.length,
    })
    await store.appendEvent(
      projectId,
      event("analyze", `✨ Jackpot! Found ${evidence.pages.length} pages and ${evidence.screenshots.length} screenshots. Our spiders are happy!`),
    )

    // Store screenshots and assets immediately so they appear in the UI
    // even if later analysis steps fail.
    const crawlAssets = [...new Set(evidence.pages.flatMap((p) => p.images))].slice(0, 40)
    await store.updateProject(projectId, {
      understanding: {
        ...(project.understanding as Record<string, unknown> ?? {}),
        sourceUrl: evidence.sourceUrl,
        screenshots: evidence.screenshots,
        assets: crawlAssets,
      } as import("@/lib/types/understanding").ProjectUnderstanding,
    })
    console.log("[v0] pipeline.website: stored crawl screenshots and assets", {
      projectId,
      screenshots: evidence.screenshots.length,
      assets: crawlAssets.length,
    })

    // Charge credits for the scrape.
    try {
      await chargeScrapeCredits(project.userId, projectId, pipelineMode)
      const modeLabel = pipelineMode === "heavy" ? "Heavy mode" : "Legacy"
      await store.appendEvent(projectId, event("analyze", `💰 Ka-ching! Charged ${scrapeCost} credits for the web crawl (${modeLabel}). Worth every penny!`))
    } catch (e) {
      console.log("[v0] pipeline.website: scrape credit charge failed", { projectId, message: (e as Error).message })
      logger.error("pipeline.scrape", "credit charge failed", { projectId, message: (e as Error).message })
    }

    await store.appendEvent(projectId, event("analyze", `🧠 Feeding everything to our AI... It's speed-reading like it's cramming for finals!`))
    console.log("[v0] pipeline.website: step 2/3 analyzeWebsite (generateText) starting", { projectId })
    const understanding = await analyzeWebsite(evidence)
    console.log("[v0] pipeline.website: step 2/3 analyzeWebsite done", { projectId })
    const attachmentContext = await getProjectAttachmentContext(projectId).catch(() => "")
    if (attachmentContext) understanding.founderContext = attachmentContext
    await store.updateProject(projectId, { state: "analysis_complete", understanding })
    await captureArtifacts(projectId, [
      {
        kind: "understanding",
        stage: "understanding",
        label: "Website understanding",
        status: "ready",
        content: understanding,
        note: "What the AI understood from the crawled website — pages, flows, entities, and design system.",
      },
    ])
    await store.appendEvent(projectId, event("understand", "🎓 Aha! The AI just had its 'eureka' moment. We understand your website now!"))

    phase = "plan"
    await store.appendEvent(projectId, event("specify", `📝 Time to write the master plan... Think of this as your app's blueprint, but cooler!`))
    console.log("[v0] pipeline.website: step 3/3 generateSpecificationFromUnderstanding starting", { projectId, pipelineMode })
    // Charge before generating: an underfunded account must never receive a
    // plan it did not pay for. Refunded below if generation fails.
    const planGate = await chargePlanBeforeGeneration(projectId, project.userId, pipelineMode)
    if (!planGate.ok) return
    planCharge = planGate.charge
    const specification = await generateSpecificationFromUnderstanding(understanding, project.userId, projectId, pipelineMode)
    // Classify complexity for customer-facing tier pricing.
    specification.complexity = classifyComplexity(specification)
    const wasSanitized = (specification as Record<string, unknown>)._sanitized === true
    delete (specification as Record<string, unknown>)._sanitized
    console.log("[v0] pipeline.website: step 3/3 generateSpecificationFromUnderstanding done", { projectId, complexity: specification.complexity, sanitized: wasSanitized })
    await store.updateProject(projectId, {
      state: "plan_ready",
      specification,
      name: specification.title || project.name,
      error: undefined,
      pipelineRecovery: undefined,
      ...(wasSanitized ? { specSanitized: true } : {}),
    })
    await captureArtifacts(projectId, [
      {
        kind: "final_spec",
        stage: "final",
        label: "Final plan (stored)",
        status: "ready",
        content: specification,
        note: "This exact plan is what the plan sections and the build receive.",
      },
    ])
    if (wasSanitized) {
      await store.appendEvent(projectId, event("specify", "⚙️ Pro tip: We swapped some tech for Totalum SDK. Think of it as upgrading from a bicycle to a Tesla!", "warn"))
    }
    await store.appendEvent(projectId, event("specify", `🎯 Blueprint complete! Your app is classified as ${specification.complexity.toUpperCase()} tier. Review your plan and start the build when ready!`))

    if (planCharge) {
      const modeLabel = pipelineMode === "heavy" ? "Heavy mode" : "Legacy"
      await store.appendEvent(projectId, event("specify", `💸 Plan credits charged (${modeLabel}). Review your plan and refine it before starting the build.`))
    }

    await store.appendEvent(projectId, event("plan", `✨ Your app plan is ready! Taking you to the Collaborate page to review and refine before building.`))
    console.log("[v0] pipeline.website: analysis complete, plan_ready — awaiting founder review", { projectId })
    logger.info("pipeline.website", "analysis complete — plan_ready", { projectId })
  } catch (e) {
    console.log("[v0] pipeline.website: FAILED", {
      projectId,
      phase,
      message: (e as Error).message,
      stack: (e as Error).stack,
    })
    logger.error("pipeline.website", "analysis failed", { projectId, phase, message: (e as Error).message })
    if (planCharge) await refundPlanCredits(project.userId, projectId, planCharge)
    await captureFailureArtifact(projectId, e)
    await markPipelineFailure(
      projectId,
      phase,
      phase === "plan"
        ? "😢 The plan couldn't be finished. Retry it and we'll keep what we already learned."
        : "😢 Oops! Something went wrong while getting to know your website. Try again?",
      phase === "plan" ? "We couldn't finish your plan." : "We couldn't finish analyzing this website.",
    )
  }
}

/** Runs specification generation for a scratch-mode project. */
export async function runScratchAnalysis(projectId: string, pipelineMode?: "legacy" | "heavy") {
  console.log("[v0] pipeline.scratch: start", { projectId, pipelineMode })
  const project = await store.getProject(projectId)
  if (!project || !project.idea) {
    console.log("[v0] pipeline.scratch: aborting, no project or idea", { projectId, hasProject: Boolean(project) })
    return
  }
  let planCharge: PlanCreditCharge | null = null
  try {
    await store.updateProject(projectId, { state: "analyzing" })
    await store.appendEvent(projectId, event("specify", "💡 Your idea is brilliant! Let's turn those brain waves into code..."))
    console.log("[v0] pipeline.scratch: state -> analyzing, calling generateSpecificationFromIdea", { projectId, pipelineMode })
    await store.appendEvent(projectId, event("specify", "🤖 AI is brainstorming... Imagine a room full of engineers, but faster!"))
    // Charge before generating: an underfunded account must never receive a
    // plan it did not pay for. Refunded below if generation fails.
    const planGate = await chargePlanBeforeGeneration(projectId, project.userId, pipelineMode)
    if (!planGate.ok) return
    planCharge = planGate.charge
    const specification = await generateSpecificationFromIdea(
      attachmentAwareIdea(project.idea, await getProjectAttachmentContext(projectId)),
      project.userId,
      projectId,
      pipelineMode,
    )
    // Classify complexity for customer-facing tier pricing.
    specification.complexity = classifyComplexity(specification)
    console.log("[v0] pipeline.scratch: generateSpecificationFromIdea done", { projectId, complexity: specification.complexity })
    const wasSanitized = (specification as Record<string, unknown>)._sanitized === true
    delete (specification as Record<string, unknown>)._sanitized
    await store.updateProject(projectId, {
      state: "plan_ready",
      specification,
      name: specification.title || project.name,
      error: undefined,
      pipelineRecovery: undefined,
      ...(wasSanitized ? { specSanitized: true } : {}),
    })
    await captureArtifacts(projectId, [
      {
        kind: "final_spec",
        stage: "final",
        label: "Final plan (stored)",
        status: "ready",
        content: specification,
        note: "This exact plan is what the plan sections and the build receive.",
      },
    ])
    if (wasSanitized) {
      await store.appendEvent(projectId, event("specify", "🔧 Heads up! We upgraded your tech stack to Totalum SDK. It's like swapping dial-up for fiber!", "warn"))
    }
    await store.appendEvent(projectId, event("specify", `🎨 Ta-da! Your app blueprint is ready. Complexity level: ${specification.complexity.toUpperCase()}. Review and refine it before building!`))

    if (planCharge) {
      const modeLabel = pipelineMode === "heavy" ? "Heavy mode" : "Legacy"
      await store.appendEvent(projectId, event("specify", `💳 Plan credits charged (${modeLabel}). Your app plan is ready — taking you there now.`))
    }

    await store.appendEvent(projectId, event("plan", "✨ Your app plan is ready! Taking you to the Collaborate page now."))
    console.log("[v0] pipeline.scratch: analysis complete, plan_ready — awaiting founder review", { projectId })
  } catch (e) {
    console.log("[v0] pipeline.scratch: FAILED", {
      projectId,
      message: (e as Error).message,
      stack: (e as Error).stack,
    })
    logger.error("pipeline.scratch", "failed", { projectId, message: (e as Error).message })
    if (planCharge) await refundPlanCredits(project.userId, projectId, planCharge)
    await captureFailureArtifact(projectId, e)
    await markPipelineFailure(
      projectId,
      "plan",
      "💔 The plan hit a snag. Your idea is safe — retry and we'll pick it up from here.",
      "We couldn't generate a plan from your idea.",
    )
  }
}

/**
 * Deep crawl pipeline: crawls the ENTIRE site, then processes it based on pipeline mode.
 * 
 * Pipeline Modes:
 * - legacy: Uses original AI website analysis (included in the crawl cost)
 * - heavy: Runs the full 7-stage pipeline after the crawl
 * 
 * Charges the configured deep-crawl cost upfront for crawling.
 */
export async function runDeepCrawlAnalysis(projectId: string, pipelineMode?: "legacy" | "heavy") {
  console.log("[v0] pipeline.deepCrawl: start", { projectId, pipelineMode })
  const project = await store.getProject(projectId)
  if (!project || !project.sourceUrl) {
    console.log("[v0] pipeline.deepCrawl: aborting, no project or sourceUrl", { projectId })
    return
  }

  const mode = pipelineMode ?? "legacy"
  const deepCrawlCost = await getDeepCrawlCost(mode)

  let phase: "understand" | "plan" = "understand"
  try {
    await store.updateProject(projectId, { state: "analyzing" })
    await store.appendEvent(projectId, event("analyze", `Deep crawling ${project.sourceUrl} — collecting entire site (${mode} mode)`))
    console.log("[v0] pipeline.deepCrawl: state -> analyzing", { projectId, sourceUrl: project.sourceUrl, mode, cost: deepCrawlCost })

    if (!isFirecrawlConfigured()) {
      await markPipelineFailure(projectId, "understand", "Firecrawl is not connected.", "Firecrawl is not configured.")
      return
    }

    // Check credits before crawling at the configured mode-specific cost.
    const canAfford = await hasSufficientCredits(project.userId, deepCrawlCost)
    if (!canAfford) {
      await recordCreditBlock(projectId, project.userId, { required: deepCrawlCost, action: "the full site crawl", resume: "analysis" })
      await markPipelineFailure(
        projectId,
        "understand",
        `Not enough credits for deep crawl (${deepCrawlCost} required).`,
        `Not enough credits for deep crawl (${deepCrawlCost} credits required).`,
      )
      return
    }

    // Charge credits upfront for deep crawl at the configured cost.
    try {
      await chargeDeepCrawlCredits(project.userId, projectId, mode)
      await store.appendEvent(projectId, event("analyze", `Deep crawl credits charged (${deepCrawlCost})`))
    } catch (e) {
      console.log("[v0] pipeline.deepCrawl: credit charge failed", { projectId, message: (e as Error).message })
      logger.error("pipeline.deepCrawl", "credit charge failed", { projectId, message: (e as Error).message })
    }

    // Deep crawl the entire site
    console.log("[v0] pipeline.deepCrawl: crawlWebsiteDeep starting", { projectId })
    const evidence = await crawlWebsiteDeep(project.sourceUrl, 50)
    console.log("[v0] pipeline.deepCrawl: crawlWebsiteDeep done", { projectId, pages: evidence.pages.length })
    await store.appendEvent(projectId, event("analyze", `Deep crawl complete — ${evidence.pages.length} pages collected`))

    // Convert crawled evidence into ProjectUnderstanding
    console.log("[v0] pipeline.deepCrawl: converting evidence to understanding", { projectId, mode })
    const attachmentContext = await getProjectAttachmentContext(projectId).catch(() => "")
    const crawlAssets = [...new Set(evidence.pages.flatMap((p) => p.images))].slice(0, 80)
    const understanding: import("@/lib/types/understanding").ProjectUnderstanding = {
      sourceUrl: evidence.sourceUrl,
      screenshots: evidence.screenshots,
      assets: crawlAssets,
      pages: evidence.pages.map((p) => ({
        url: p.url,
        title: p.title,
        importance: "primary" as const,
      })),
      targetUsers: [],
      userRoles: [],
      components: [],
      dataEntities: [],
      userFlows: [],
      designSystem: { colors: [], typography: [], visualLanguage: `Deep crawl — ${evidence.pages.length} pages collected` },
      navigation: evidence.navigation,
      contentStructure: [],
      interactions: [],
      observedFunctionality: [],
      inferredFunctionality: [],
      suggestedFeatures: [],
      backendRequirements: [],
      authenticationRequirements: [],
      rawEvidenceReferences: [],
      confidenceNotes: `Deep crawl: ${evidence.pages.length} pages collected from ${evidence.sourceUrl}`,
      founderContext: attachmentContext || undefined,
    }

    await store.updateProject(projectId, { understanding })
    await captureArtifacts(projectId, [
      {
        kind: "understanding",
        stage: "understanding",
        label: "Deep-crawl understanding",
        status: "ready",
        content: understanding,
        note: `Built from a deep crawl of ${evidence.pages.length} page${evidence.pages.length === 1 ? "" : "s"}.`,
      },
    ])

    phase = "plan"
    // Generate specification based on pipeline mode
    let specification: import("@/lib/types/specification").ApplicationSpecification

    if (mode === "heavy") {
      // Use the full 7-stage planning pipeline
      console.log("[v0] pipeline.deepCrawl: using heavy mode (7-stage pipeline)", { projectId })
      await store.appendEvent(projectId, event("analyze", "Starting AI planning pipeline (heavy mode)"))

      // Import and use the planning orchestrator
      const { PlanningOrchestrator } = await import("@/lib/planning/orchestrator")
      const orchestrator = new PlanningOrchestrator()

      try {
        const result = await orchestrator.executeWebsitePipeline(projectId, understanding, project.userId, mode)
        specification = result.specification
        console.log("[v0] pipeline.deepCrawl: heavy mode pipeline complete", { projectId })
      } catch (pipelineError) {
        console.log("[v0] pipeline.deepCrawl: heavy mode pipeline failed", {
          projectId,
          error: pipelineError instanceof Error ? pipelineError.message : String(pipelineError)
        })
        throw pipelineError
      }
    } else {
      // Legacy mode: Use original AI website analysis
      console.log("[v0] pipeline.deepCrawl: using legacy mode (original AI analysis)", { projectId })
      await store.appendEvent(projectId, event("analyze", "Generating specification with AI analysis (legacy mode)"))

      specification = await generateSpecificationFromUnderstanding(understanding, project.userId, projectId, "legacy")
      console.log("[v0] pipeline.deepCrawl: legacy AI analysis complete", { projectId })
    }

    // Classify complexity and store specification
    specification.complexity = classifyComplexity(specification)
    await store.updateProject(projectId, {
      state: "plan_ready",
      specification,
      name: specification.title || project.name,
      error: undefined,
      pipelineRecovery: undefined,
    })
    await captureArtifacts(projectId, [
      {
        kind: "final_spec",
        stage: "final",
        label: "Final plan (stored)",
        status: "ready",
        content: specification,
        note: "This exact plan is what the plan sections and the build receive.",
      },
    ])

    const modeLabel = mode === "heavy" ? "heavy mode pipeline" : "legacy AI analysis"
    await store.appendEvent(projectId, event("specify", `Plan ready (${modeLabel}) — ${specification.complexity} tier. Review and refine before building.`))
    await store.appendEvent(projectId, event("plan", "✨ Your app plan is ready! Taking you to the Collaborate page now."))
    console.log("[v0] pipeline.deepCrawl: plan_ready — awaiting founder review", { projectId, mode })
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    console.log("[v0] pipeline.deepCrawl: FAILED", { projectId, phase, message: errorMessage })
    logger.error("pipeline.deepCrawl", "failed", { projectId, phase, message: errorMessage })
    await captureFailureArtifact(projectId, e)

    // Store the detailed error message so users can see what went wrong and how to fix it
    await markPipelineFailure(
      projectId,
      phase,
      phase === "plan" ? `Plan failed: ${errorMessage}` : errorMessage,
      errorMessage,
    )
  }
}
