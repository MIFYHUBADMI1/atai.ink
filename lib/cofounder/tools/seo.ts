import "server-only"

/**
 * SEO visibility audit tools (Phase 3 — W2, Slice 2).
 *
 * A credit-charging action, so it runs through the existing pending-action
 * flow: prepare() validates + prices + creates a reviewable card and changes
 * NOTHING; executeApproved() performs the crawl + audit + charge, refunding on
 * failure.
 *
 * The audited address is never model- or client-supplied. A build project is
 * audited at its recorded production URL; a connected business at the hostname
 * its founder proved. `auditableSiteUrl` is the single resolver for both, and
 * ownership/access is re-derived from the session at every step.
 */

import { createPendingAction } from "../pending-actions"
import { toToolOutcome } from "../errors"
import type { ToolDefinition, PrepareOutcome, ToolOutcome, ToolContext } from "../types"
import { runBusinessSeoAuditSchema, runSeoAuditSchema } from "../schemas"
import { ownedProject } from "./projects"
import { isSeoAuditEnabledForUser } from "@/lib/marketing/feature-flags"
import { readFeaturePreferences } from "@/lib/marketing/feature-preferences"
import { getSeoAuditCost, getSeoAuditAffordability, chargeSeoAuditCredits, refundSeoAuditCredits, type SeoRefundOutcome } from "@/lib/marketing/seo/credits"
import { scopedIntentKey } from "@/lib/billing/operation-identity"
import { runSeoAudit, markSeoAuditRefund } from "@/lib/marketing/seo/service"
import { isFirecrawlConfigured } from "@/lib/integrations/firecrawl/client"
import { auditableSiteUrl } from "@/lib/connected-business/site-url"
import { resolveBusinessAnchor } from "@/lib/connected-business/anchor"
import { store } from "@/lib/store/store"
import { AppError } from "@/lib/errors"
import { logger } from "@/lib/logging/logger"

interface AuditTarget {
  projectId: string
  projectName: string
  url: string
  /** Present only for a connected business — the address the audit belongs to. */
  businessId?: string
}

type TargetResult = { ok: true; target: AuditTarget } | { ok: false; code: string; message: string }

async function buildProjectTarget(ctx: ToolContext, projectId: string): Promise<TargetResult> {
  const project = await ownedProject(ctx, projectId)
  if (!project) {
    return { ok: false, code: "UNAUTHORIZED_PROJECT_ACCESS", message: "I couldn't access that project." }
  }
  const site = await auditableSiteUrl(project)
  if (!site) {
    return { ok: false, code: "NOT_DEPLOYED", message: "This project has no live deployment to audit yet. Deploy it first." }
  }
  return { ok: true, target: { projectId: project.id, projectName: project.name, url: site.url } }
}

async function buildBusinessTarget(ctx: ToolContext, businessId: string): Promise<TargetResult> {
  try {
    const anchor = await resolveBusinessAnchor({
      businessId,
      actor: { kind: "user", id: ctx.user.id },
      permission: "growth.read",
    })
    const project = await store.getProject(anchor.projectId)
    if (!project) {
      return { ok: false, code: "UNAUTHORIZED_BUSINESS_ACCESS", message: "I couldn't access that business." }
    }
    const site = await auditableSiteUrl(project)
    if (!site) {
      return {
        ok: false,
        code: "NOT_VERIFIED",
        message:
          "Prove your domain first — the audit reads only an address you have proved you own. Open Overview to finish the domain step.",
      }
    }
    return { ok: true, target: { projectId: project.id, projectName: project.name, url: site.url, businessId } }
  } catch {
    return { ok: false, code: "UNAUTHORIZED_BUSINESS_ACCESS", message: "I couldn't access that business." }
  }
}

async function prepareAudit(
  ctx: ToolContext,
  toolName: string,
  target: AuditTarget,
  description: string,
): Promise<PrepareOutcome> {
  try {
    const prefs = await readFeaturePreferences(ctx.user.id)
    if (!isSeoAuditEnabledForUser(ctx.user.id, prefs)) {
      return { ok: false, error: { code: "FEATURE_DISABLED", message: "SEO visibility audits are switched off. The founder can turn them on in Settings → Feature switches.", fatal: true } }
    }
    if (!isFirecrawlConfigured()) {
      return { ok: false, error: { code: "FIRECRAWL_UNAVAILABLE", message: "The website analyzer isn't connected right now.", fatal: true } }
    }
    const { cost, available, affordable } = await getSeoAuditAffordability(ctx.user.id)
    if (!affordable) {
      return { ok: false, error: { code: "INSUFFICIENT_CREDITS", message: `This audit costs ${cost} credits and you have ${available}.`, fatal: true } }
    }
    const action = await createPendingAction({
      userId: ctx.user.id,
      toolName,
      // Server-written target: the approval path re-resolves and re-authorises
      // from this id, never from anything the model supplied.
      parameters: target.businessId ? { businessId: target.businessId } : { projectId: target.projectId },
      risk: "CONFIRM",
      description,
      cost: { amount: cost, creditsAvailable: available, label: "SEO visibility audit" },
      conversationId: ctx.conversationId,
    })
    return { ok: true, pending: action }
  } catch (e) {
    logger.warn("cofounder.tool.seo", "prepare failed", { message: e instanceof Error ? e.message : String(e) })
    return { ok: false, error: { code: "VALIDATION", message: "I couldn't set up that audit." } }
  }
}

async function executeAudit(ctx: ToolContext, target: AuditTarget): Promise<ToolOutcome> {
  let charged = false
  let chargedAmount = 0
  let failedAuditId: string | null = null
  let refundStatus: SeoRefundOutcome | null = null
  let intentKey: string | undefined
  try {
    const prefs = await readFeaturePreferences(ctx.user.id)
    if (!isSeoAuditEnabledForUser(ctx.user.id, prefs)) {
      return { success: false, error: { code: "FEATURE_DISABLED", message: "SEO visibility audits are switched off. The founder can turn them on in Settings → Feature switches.", fatal: true } }
    }

    chargedAmount = await getSeoAuditCost()
    // The approved pending-action id is a stable, server-derived single-use
    // identifier — but still an identifier, not a scoped one. `scopedIntentKey`
    // binds it to the session user and the ownership-checked project so the
    // ledger key cannot be aliased by another caller, and the SAME key is
    // reused for the refund below.
    intentKey = scopedIntentKey(ctx.pendingActionId, {
      userId: ctx.user.id,
      operation: "seo_audit",
      projectId: target.projectId,
    })
    charged = await chargeSeoAuditCredits(ctx.user.id, target.projectId, intentKey)
    if (!charged) {
      return { success: false, error: { code: "INSUFFICIENT_CREDITS", message: "You don't have enough credits for this audit.", fatal: true } }
    }

    const outcome = await runSeoAudit({
      userId: ctx.user.id,
      projectId: target.projectId,
      url: target.url,
      creditsCharged: chargedAmount,
      projectName: target.projectName,
      onFailedAuditPersisted: (auditId) => {
        failedAuditId = auditId
      },
    })

    return {
      success: true,
      type: "seo_audit",
      data: {
        auditId: outcome.auditId,
        // A business surface never sees the anchor project id.
        ...(target.businessId ? { businessId: target.businessId } : { projectId: target.projectId }),
        url: outcome.url,
        score: outcome.score,
        pagesCrawled: outcome.pagesCrawled,
        findings: outcome.findings.map((f) => ({ id: f.id, label: f.label, status: f.status, ...(f.observed ? { observed: f.observed } : {}), ...(f.note ? { note: f.note } : {}) })),
        note: "Deterministic on-page findings from a bounded crawl. No rankings, traffic, or conversion are measured or implied.",
      },
      ...(target.businessId ? {} : { navigation: { target: "market" as const, projectId: target.projectId } }),
      ...(ctx.pendingActionId ? { pendingActionId: ctx.pendingActionId } : {}),
    }
  } catch (e) {
    if (charged) {
      // Reverse exactly what was charged and stamp the stored failed row so
      // the history reflects the real refund outcome.
      refundStatus = await refundSeoAuditCredits(ctx.user.id, target.projectId, chargedAmount, intentKey)
      if (failedAuditId) {
        await markSeoAuditRefund(target.projectId, failedAuditId, refundStatus, chargedAmount)
      }
    }
    const refundNote =
      refundStatus === "failed"
        ? "We couldn't reverse the credits automatically — please contact support."
        : "Any credits were refunded."
    if (e instanceof AppError && e.code === "FIRECRAWL_UNAVAILABLE") {
      return { success: false, error: { code: "FIRECRAWL_UNAVAILABLE", message: `The website analyzer couldn't reach that site. ${refundNote}` } }
    }
    logger.warn("cofounder.tool.seo", "executeApproved failed", { message: e instanceof Error ? e.message : String(e) })
    return toToolOutcome(e, `The audit failed. ${refundNote}`)
  }
}

export const runSeoAuditTool: ToolDefinition = {
  name: "run_seo_audit",
  description:
    "Run a bounded, read-only SEO visibility audit of a project's OWN live deployed URL (on-page title, description, headings, links, content, HTTPS). This consumes credits and creates a confirmation card first — nothing runs or is charged until the founder approves. Use when the founder wants to check how search-engine-friendly their live site is. Cannot run on undeployed projects.",
  risk: "CONFIRM",
  requiresConfirmation: true,
  inputSchema: runSeoAuditSchema,
  async prepare(input, ctx): Promise<PrepareOutcome> {
    const parsed = runSeoAuditSchema.safeParse(input)
    if (!parsed.success) return { ok: false, error: { code: "VALIDATION", message: "I need to know which project to audit." } }
    const gate = await buildProjectTarget(ctx, parsed.data.projectId)
    if (!gate.ok) return { ok: false, error: { code: gate.code, message: gate.message, fatal: true } }
    return prepareAudit(
      ctx,
      "run_seo_audit",
      gate.target,
      `Run an SEO visibility audit of ${gate.target.projectName}'s live site (${await getSeoAuditCost()} credits).`,
    )
  },
  async executeApproved(input, ctx): Promise<ToolOutcome> {
    const parsed = runSeoAuditSchema.safeParse(input)
    if (!parsed.success) return { success: false, error: { code: "VALIDATION", message: "That audit target is no longer valid." } }
    const gate = await buildProjectTarget(ctx, parsed.data.projectId)
    if (!gate.ok) return { success: false, error: { code: gate.code, message: gate.message, fatal: true } }
    return executeAudit(ctx, gate.target)
  },
}

export const runBusinessSeoAuditTool: ToolDefinition = {
  name: "run_business_seo_audit",
  description:
    "Run a bounded, read-only SEO visibility audit of the connected business the founder is working in, at the address they proved. This consumes credits and creates a confirmation card first — nothing runs or is charged until the founder approves. Use when the founder wants to check how search-engine-friendly their live site is. Requires a proved domain.",
  risk: "CONFIRM",
  requiresConfirmation: true,
  inputSchema: runBusinessSeoAuditSchema,
  async prepare(input, ctx): Promise<PrepareOutcome> {
    // The target is the current business, never a model-supplied id.
    const businessId = ctx.activeBusinessId
    if (!businessId) {
      return { ok: false, error: { code: "VALIDATION", message: "Open a business first, then ask me to audit it." } }
    }
    const gate = await buildBusinessTarget(ctx, businessId)
    if (!gate.ok) return { ok: false, error: { code: gate.code, message: gate.message, fatal: true } }
    return prepareAudit(
      ctx,
      "run_business_seo_audit",
      gate.target,
      `Run an SEO visibility audit of ${gate.target.projectName}'s site (${await getSeoAuditCost()} credits).`,
    )
  },
  async executeApproved(input, ctx): Promise<ToolOutcome> {
    const parsed = runBusinessSeoAuditSchema.safeParse(input)
    if (!parsed.success) return { success: false, error: { code: "VALIDATION", message: "That audit target is no longer valid." } }
    const gate = await buildBusinessTarget(ctx, parsed.data.businessId)
    if (!gate.ok) return { success: false, error: { code: gate.code, message: gate.message, fatal: true } }
    return executeAudit(ctx, gate.target)
  },
}
