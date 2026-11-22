import { randomUUID } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppError } from "@/lib/errors"
import type { BusinessIntake } from "@/lib/types/business-intake"

// In-memory project document + a collection fake that understands the dotted
// $set paths and the atomic claim filter the orchestrator actually issues.
let projectDoc: Record<string, unknown> | null = null

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), obj)
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".")
  let cursor: Record<string, unknown> = obj
  for (const key of keys.slice(0, -1)) {
    if (!cursor[key] || typeof cursor[key] !== "object") cursor[key] = {}
    cursor = cursor[key] as Record<string, unknown>
  }
  cursor[keys[keys.length - 1]] = value
}

function claimMatches(filter: Record<string, unknown>): boolean {
  if (!projectDoc || filter.id !== projectDoc.id) return false
  const or = filter.$or as Array<Record<string, Record<string, unknown>>>
  return or.some((clause) => {
    const [path, cond] = Object.entries(clause)[0]
    const value = getPath(projectDoc, path)
    if ("$ne" in cond) return value !== cond.$ne
    if ("$lt" in cond) return typeof value === "number" && value < (cond.$lt as number)
    if ("$exists" in cond) return cond.$exists ? value !== undefined : value === undefined
    return false
  })
}

const projectsColFake = {
  async findOne(filter: { id: string }) {
    if (!projectDoc || filter.id !== projectDoc.id) return null
    return projectDoc
  },
  async updateOne(filter: { id: string }, update: { $set?: Record<string, unknown> }) {
    if (!projectDoc || filter.id !== projectDoc.id) return { matchedCount: 0, modifiedCount: 0 }
    for (const [path, value] of Object.entries(update.$set ?? {})) setPath(projectDoc, path, value)
    return { matchedCount: 1, modifiedCount: 1 }
  },
  async findOneAndUpdate(filter: Record<string, unknown>, update: { $set: Record<string, unknown> }) {
    if (!claimMatches(filter)) return null
    for (const [path, value] of Object.entries(update.$set)) setPath(projectDoc!, path, value)
    return projectDoc
  },
}

vi.mock("@/lib/db/collections", () => ({
  projectsCol: vi.fn(async () => projectsColFake),
  usersCol: vi.fn(async () => ({ findOne: async () => null })),
}))
vi.mock("@/lib/store/store", () => ({
  cryptoId: () => randomUUID(),
  store: {
    getProject: vi.fn(async () => (projectDoc ? structuredClone(projectDoc) : null)),
    appendEvent: vi.fn(async () => undefined),
  },
}))
vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit: vi.fn(async () => undefined) }))
vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock("@/lib/credits/credits", () => ({
  getBusinessReadCost: vi.fn(async () => 40),
  hasSufficientCredits: vi.fn(async () => true),
  chargeBusinessReadCredits: vi.fn(async () => undefined),
}))
vi.mock("@/lib/billing/runtime-config", () => ({
  getExistingBusinessCosts: vi.fn(async () => ({ readCost: 40, assessmentCost: 60 })),
}))
vi.mock("@/lib/billing/credit-service", () => ({
  getAvailableCredits: vi.fn(async () => 1_000),
}))
vi.mock("@/lib/domain/service", () => ({
  BUSINESS_ALREADY_CONNECTED_MESSAGE:
    "This website is already connected to another Atai account. Only that account can disconnect it. If this is the business you own, contact support to recover it.",
  registerDomain: vi.fn(async () => ({
    doc: { hostname: "bakery.example", status: "pending", method: "meta_tag", canonicalHostname: "bakery.example" },
    created: true,
  })),
  listProjectDomains: vi.fn(async () => []),
  canonicalClaimFor: vi.fn(async () => null),
  canonicalHostFromInput: (value: string) => value.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""),
  reserveBusinessClaim: vi.fn(async () => ({
    state: "reserved",
    doc: {},
    created: true,
    canonicalHostname: "bakery.example",
  })),
}))
vi.mock("./website-facts", () => ({
  collectWebsiteFacts: vi.fn(),
  buildWebsiteDigest: () => "website digest",
  buildReadingSnapshot: () => ({
    capturedAt: 1,
    digest: "website digest",
    pages: [{ url: "https://bakery.example", headings: [], excerpt: "Bread, baked daily.", chars: 19 }],
    pagesRead: 3,
    charsRead: 19,
  }),
}))
vi.mock("./assessment", () => ({
  generateBusinessAssessment: vi.fn(async () => ({
    ok: true,
    assessment: { generatedAt: 1, understanding: "u", evidence: {} },
    charged: true,
  })),
}))
vi.mock("@/lib/marketing/feature-flags", () => ({
  isSeoAuditEnabledForUser: () => true,
  isGrowthTasksEnabledForUser: () => true,
  isCampaignsEnabledForUser: () => true,
  isStudioEnabledForUser: () => true,
}))

import { checkRateLimit } from "@/lib/auth/rate-limit"
import { chargeBusinessReadCredits, hasSufficientCredits } from "@/lib/credits/credits"
import { getExistingBusinessCosts } from "@/lib/billing/runtime-config"
import { getAvailableCredits } from "@/lib/billing/credit-service"
import { registerDomain, listProjectDomains, canonicalClaimFor, reserveBusinessClaim } from "@/lib/domain/service"
import { collectWebsiteFacts } from "./website-facts"
import { generateBusinessAssessment } from "./assessment"
import {
  STALE_RUN_MS,
  buildIntakeRecord,
  claimIntakeRun,
  intakeProgress,
  runBusinessIntake,
  sanitizeIntakeInput,
  startIntakeRun,
} from "./intake"

const rateMock = vi.mocked(checkRateLimit)
const chargeMock = vi.mocked(chargeBusinessReadCredits)
const costsMock = vi.mocked(getExistingBusinessCosts)
const availableMock = vi.mocked(getAvailableCredits)
const affordableMock = vi.mocked(hasSufficientCredits)
const registerMock = vi.mocked(registerDomain)
const claimMock = vi.mocked(canonicalClaimFor)
const reserveMock = vi.mocked(reserveBusinessClaim)
const domainsMock = vi.mocked(listProjectDomains)
const websiteMock = vi.mocked(collectWebsiteFacts)
const assessmentMock = vi.mocked(generateBusinessAssessment)

const websiteFacts = {
  hostname: "bakery.example",
  normalizedUrl: "https://bakery.example",
  pagesCrawled: 3,
  fromCache: false,
}

function seedProject(intake?: BusinessIntake) {
  projectDoc = {
    id: "proj-1",
    userId: "user-1",
    name: "Corner Bakery",
    mode: "scratch",
    startingPoint: "existing_business",
    state: "created",
    intake:
      intake ??
      buildIntakeRecord({
        description: "A bakery serving local offices.",
        websiteUrl: "https://bakery.example",
        objectives: ["acquire_customers"],
      }),
  }
}

function stages(): BusinessIntake {
  return structuredClone(projectDoc!.intake) as BusinessIntake
}

beforeEach(() => {
  vi.clearAllMocks()
  seedProject()
  websiteMock.mockResolvedValue({ facts: websiteFacts } as Awaited<ReturnType<typeof collectWebsiteFacts>>)
  assessmentMock.mockResolvedValue({
    ok: true,
    assessment: { generatedAt: 1, understanding: "u", evidence: {} },
    charged: true,
  } as Awaited<ReturnType<typeof generateBusinessAssessment>>)
  affordableMock.mockResolvedValue(true)
  availableMock.mockResolvedValue(1_000)
  costsMock.mockResolvedValue({ readCost: 40, assessmentCost: 60 })
  rateMock.mockResolvedValue(undefined as never)
  domainsMock.mockResolvedValue([])
  registerMock.mockResolvedValue({
    doc: { hostname: "bakery.example", status: "pending", method: "meta_tag", canonicalHostname: "bakery.example" },
    created: true,
  } as Awaited<ReturnType<typeof registerDomain>>)
  claimMock.mockResolvedValue(null)
  reserveMock.mockResolvedValue({
    state: "reserved",
    doc: {},
    created: true,
    canonicalHostname: "bakery.example",
  } as Awaited<ReturnType<typeof reserveBusinessClaim>>)
})

describe("buildIntakeRecord", () => {
  it("seeds a pending website stage and a pending assessment", () => {
    const record = buildIntakeRecord({
      description: "desc",
      websiteUrl: "https://bakery.example",
      objectives: ["acquire_customers", "acquire_customers"],
    })
    expect(record.website).toEqual({ status: "pending", url: "https://bakery.example" })
    expect(record.assessment.status).toBe("pending")
    expect(record.run).toMatchObject({ status: "idle" })
    expect(record.objectives).toEqual(["acquire_customers"])
  })

  it("skips the website when not supplied — the assessment still runs", () => {
    const record = buildIntakeRecord({ description: "just words" })
    expect(record.website.status).toBe("skipped")
    expect(record.assessment.status).toBe("pending")
  })

  it("records no repository stage at all — this path never reads code", () => {
    const record = buildIntakeRecord({ description: "desc", websiteUrl: "https://bakery.example" })
    expect(record).not.toHaveProperty("repo")
  })

  it("trims and caps founder text", () => {
    const record = buildIntakeRecord({
      displayName: `  ${"n".repeat(200)}  `,
      description: "d".repeat(5_000),
      targetCustomers: "   ",
    })
    expect(record.displayName).toHaveLength(120)
    expect(record.description).toHaveLength(4_000)
    expect(record.targetCustomers).toBeUndefined()
  })
})

describe("intakeProgress", () => {
  const stage = (status: string) => ({ status }) as BusinessIntake["website"]

  it("is pending with no record", () => {
    expect(intakeProgress(undefined).status).toBe("pending")
  })

  it("is skipped when every stage was skipped", () => {
    const intake = { website: stage("skipped"), assessment: stage("skipped") } as BusinessIntake
    expect(intakeProgress(intake).status).toBe("skipped")
  })

  it("is completed when every stage completed", () => {
    const intake = { website: stage("completed"), assessment: stage("completed") } as BusinessIntake
    expect(intakeProgress(intake)).toMatchObject({ status: "completed", completed: 2, skipped: 0 })
  })

  it("is partially_completed when something was learned and something failed", () => {
    const intake = { website: stage("failed"), assessment: stage("completed") } as BusinessIntake
    expect(intakeProgress(intake).status).toBe("partially_completed")
  })

  it("is processing while any stage is still running, even with completions", () => {
    const intake = { website: stage("completed"), assessment: stage("processing") } as BusinessIntake
    expect(intakeProgress(intake).status).toBe("processing")
  })

  it("is failed only when nothing was learned", () => {
    const intake = { website: stage("failed"), assessment: stage("failed") } as BusinessIntake
    expect(intakeProgress(intake).status).toBe("failed")
  })
})

describe("sanitizeIntakeInput", () => {
  it("drops unknown objective ids, dedupes and caps the closed list", () => {
    const cleaned = sanitizeIntakeInput({
      objectives: ["acquire_customers", "not_an_objective", "acquire_customers", 42, "improve_marketing"],
    })
    expect(cleaned.objectives).toEqual(["acquire_customers", "improve_marketing"])
  })

  it("trims strings and rejects non-strings", () => {
    const cleaned = sanitizeIntakeInput({ displayName: "  Bakery  ", description: 7, websiteUrl: " https://x.example " })
    expect(cleaned.displayName).toBe("Bakery")
    expect(cleaned.description).toBeUndefined()
    expect(cleaned.websiteUrl).toBe("https://x.example")
  })

  it("handles an empty body", () => {
    const cleaned = sanitizeIntakeInput({})
    expect(cleaned.objectives).toEqual([])
    expect(cleaned.websiteUrl).toBeUndefined()
  })
})

describe("claimIntakeRun", () => {
  it("claims an idle run", async () => {
    expect(await claimIntakeRun("proj-1")).toBe(true)
    expect(stages().run).toMatchObject({ status: "processing" })
  })

  it("refuses a second writer while a fresh run is processing", async () => {
    await claimIntakeRun("proj-1")
    expect(await claimIntakeRun("proj-1")).toBe(false)
  })

  it("reclaims a processing stamp older than the stale window", async () => {
    await claimIntakeRun("proj-1", Date.now() - STALE_RUN_MS - 1_000)
    expect(await claimIntakeRun("proj-1")).toBe(true)
  })

  it("claims a project with no run record at all", async () => {
    delete (projectDoc!.intake as BusinessIntake).run
    expect(await claimIntakeRun("proj-1")).toBe(true)
  })
})

describe("runBusinessIntake — gates", () => {
  it("reports NOT_FOUND for a missing project", async () => {
    projectDoc = null
    expect(await runBusinessIntake("proj-1")).toMatchObject({ ok: false, code: "NOT_FOUND" })
  })

  it("reports FORBIDDEN for another user", async () => {
    expect(await runBusinessIntake("proj-1", { userId: "user-2" })).toMatchObject({ ok: false, code: "FORBIDDEN" })
  })

  it("reports NOT_ELIGIBLE for a business not initialized as existing", async () => {
    delete projectDoc!.startingPoint
    expect(await runBusinessIntake("proj-1")).toMatchObject({ ok: false, code: "NOT_ELIGIBLE" })
  })

  it("short-circuits a completed intake without re-charging anything", async () => {
    seedProject({
      ...buildIntakeRecord({ description: "d" }),
      website: { status: "completed" },
      assessment: { status: "completed" },
    } as BusinessIntake)
    const result = await runBusinessIntake("proj-1")
    expect(result).toMatchObject({ ok: true, status: "completed", assessmentCompleted: true })
    expect(rateMock).not.toHaveBeenCalled()
    expect(websiteMock).not.toHaveBeenCalled()
    expect(assessmentMock).not.toHaveBeenCalled()
  })

  it("refuses to start when the balance cannot cover the whole journey, and says by how much", async () => {
    availableMock.mockResolvedValue(35)
    const result = await runBusinessIntake("proj-1")
    expect(result).toMatchObject({
      ok: false,
      code: "INSUFFICIENT_CREDITS",
      meta: { readCost: 40, assessmentCost: 60, required: 100, available: 35, shortfall: 65 },
    })
    // Nothing is crawled, assessed or claimed for a journey that cannot finish.
    expect(websiteMock).not.toHaveBeenCalled()
    expect(assessmentMock).not.toHaveBeenCalled()
  })

  it("prices only what is still unpaid — a finished read is not charged twice", async () => {
    seedProject({
      ...buildIntakeRecord({ description: "d", websiteUrl: "https://bakery.example" }),
      website: { status: "completed", url: "https://bakery.example" },
      assessment: { status: "failed", errorMessage: "nope" },
    } as BusinessIntake)
    availableMock.mockResolvedValue(59)
    const result = await runBusinessIntake("proj-1")
    expect(result).toMatchObject({
      ok: false,
      code: "INSUFFICIENT_CREDITS",
      meta: { required: 60, available: 59, shortfall: 1 },
    })
  })

  it("maps rate limiting to a stable code", async () => {
    rateMock.mockRejectedValue(new AppError("RATE_LIMITED", "slow down", 429))
    expect(await runBusinessIntake("proj-1")).toMatchObject({ ok: false, code: "RATE_LIMITED" })
  })

  it("refuses to run alongside a fresh processing run", async () => {
    ;(projectDoc!.intake as BusinessIntake).run = { status: "processing", at: Date.now() }
    expect(await runBusinessIntake("proj-1")).toMatchObject({ ok: false, code: "INTAKE_IN_PROGRESS" })
    expect(websiteMock).not.toHaveBeenCalled()
  })
})

describe("startIntakeRun — the answer the retry button depends on", () => {
  /** The state the founder was stuck in: pages read, assessment failed. */
  function seedFailedAssessment() {
    seedProject({
      ...buildIntakeRecord({ description: "d", websiteUrl: "https://bakery.example" }),
      website: { status: "completed" },
      assessment: { status: "failed", attemptedAt: Date.now(), errorCode: "ASSESSMENT_FAILED", errorMessage: "x" },
    } as BusinessIntake)
  }

  it("accepts a retry after a failed assessment instead of reporting a finished run", async () => {
    seedFailedAssessment()
    const result = await startIntakeRun("proj-1", { userId: "user-1" })
    expect(result).toMatchObject({ ok: true, started: true })
    // A partially completed intake is not a completed one: the retry must run.
    expect(rateMock).toHaveBeenCalled()
  })

  it("says why a start was refused instead of always answering started", async () => {
    seedFailedAssessment()
    rateMock.mockRejectedValue(new AppError("RATE_LIMITED", "slow down", 429))
    expect(await startIntakeRun("proj-1", { userId: "user-1" })).toMatchObject({
      ok: false,
      code: "RATE_LIMITED",
      message: expect.stringContaining("Too many attempts"),
    })
  })

  it("reports a run already in flight rather than starting a second one", async () => {
    seedFailedAssessment()
    ;(projectDoc!.intake as BusinessIntake).run = { status: "processing", at: Date.now() }
    expect(await startIntakeRun("proj-1", { userId: "user-1" })).toMatchObject({
      ok: false,
      code: "INTAKE_IN_PROGRESS",
    })
    expect(websiteMock).not.toHaveBeenCalled()
  })

  it("reports a finished intake as not started, without spending anything", async () => {
    seedProject({
      ...buildIntakeRecord({ description: "d" }),
      website: { status: "completed" },
      assessment: { status: "completed" },
    } as BusinessIntake)
    expect(await startIntakeRun("proj-1", { userId: "user-1" })).toMatchObject({ ok: true, started: false })
    expect(assessmentMock).not.toHaveBeenCalled()
  })
})

describe("runBusinessIntake — sources and billing", () => {
  it("reads the website, claims the domain, assesses, and releases the run", async () => {
    const result = await runBusinessIntake("proj-1")
    expect(result).toMatchObject({ ok: true, status: "completed", assessmentCompleted: true })
    expect(websiteMock).toHaveBeenCalledWith("https://bakery.example")
    expect(chargeMock).toHaveBeenCalledTimes(1)
    expect(registerMock).toHaveBeenCalledWith(expect.objectContaining({ rawUrl: "https://bakery.example" }))
    expect(assessmentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        evidence: expect.objectContaining({
          website: expect.objectContaining({ hostname: "bakery.example", pagesCrawled: 3 }),
          domainVerified: false,
        }),
      }),
      expect.anything(),
    )
    expect(stages().run?.status).toBe("completed")
    expect(stages().website?.status).toBe("completed")
    expect(stages().assessment?.status).toBe("completed")
  })

  it("keeps a copy of the read so the founder can inspect it", async () => {
    await runBusinessIntake("proj-1")
    expect(stages().website?.reading).toMatchObject({
      digest: "website digest",
      pagesRead: 3,
      pages: [{ url: "https://bakery.example", excerpt: "Bread, baked daily." }],
    })
  })

  it("bills a read at the standard rate even when the project was created heavy", async () => {
    projectDoc = { ...projectDoc!, pipelineMode: "heavy" }
    await runBusinessIntake("proj-1")
    expect(chargeMock).toHaveBeenCalledWith("user-1", "proj-1")
  })

  it("never pays for a crawl served from the cache", async () => {
    websiteMock.mockResolvedValue({ facts: { ...websiteFacts, fromCache: true } } as Awaited<ReturnType<typeof collectWebsiteFacts>>)
    await runBusinessIntake("proj-1")
    expect(chargeMock).not.toHaveBeenCalled()
    expect(stages().website?.status).toBe("completed")
  })

  it("marks the website failed on insufficient credits but still assesses from the owner's words", async () => {
    affordableMock.mockResolvedValue(false)
    const result = await runBusinessIntake("proj-1")
    expect(result).toMatchObject({ ok: true, assessmentCompleted: true })
    expect(websiteMock).not.toHaveBeenCalled()
    expect(stages().website?.errorCode).toBe("INSUFFICIENT_CREDITS")
    const evidence = assessmentMock.mock.calls[0][0].evidence
    expect(evidence.website).toBeUndefined()
    expect(evidence.ownerDescription).toContain("bakery")
  })

  it("a failed website read does not void the assessment or claim the domain", async () => {
    websiteMock.mockResolvedValue({ failure: { code: "UNREACHABLE", message: "down" } } as Awaited<ReturnType<typeof collectWebsiteFacts>>)
    const result = await runBusinessIntake("proj-1")
    expect(result).toMatchObject({ ok: true, status: "partially_completed", assessmentCompleted: true })
    expect(stages().website?.status).toBe("failed")
    expect(stages().website?.errorCode).toBe("UNREACHABLE")
    expect(registerMock).not.toHaveBeenCalled()
    expect(chargeMock).not.toHaveBeenCalled()
    expect(assessmentMock.mock.calls[0][0].evidence.website).toBeUndefined()
  })

  it("passes website evidence and verified-domain truth to the assessment", async () => {
    seedProject(buildIntakeRecord({ description: "d", websiteUrl: "https://bakery.example", objectives: [] }))
    domainsMock.mockResolvedValue([{ status: "verified" }] as Awaited<ReturnType<typeof listProjectDomains>>)
    await runBusinessIntake("proj-1")
    const evidence = assessmentMock.mock.calls[0][0].evidence
    expect(evidence.website).toMatchObject({ hostname: "bakery.example" })
    expect(evidence).not.toHaveProperty("repo")
    expect(evidence.domainVerified).toBe(true)
  })

  it("a business held by another account stops the run before the assessment", async () => {
    registerMock.mockRejectedValue(Object.assign(new Error("taken"), { code: "DOMAIN_TAKEN" }))
    const result = await runBusinessIntake("proj-1")
    expect(result).toMatchObject({ ok: false, code: "BUSINESS_ALREADY_CONNECTED" })
    if (!result.ok) expect(result.message).not.toContain("user-2")
    expect(assessmentMock).not.toHaveBeenCalled()
    expect(stages().run?.status).toBe("failed")
    expect(stages().claim).toMatchObject({ state: "held_by_other" })
  })

  it("never fails the run when only the same-site redirect target is held by another account", async () => {
    websiteMock.mockResolvedValue({
      // A sibling subdomain: the same site under another name, unlike a
      // www alias, which `registerDomain` already folds into the primary.
      facts: { ...websiteFacts, normalizedUrl: "https://shop.bakery.example/" },
    } as Awaited<ReturnType<typeof collectWebsiteFacts>>)
    registerMock
      .mockResolvedValueOnce({
        doc: { hostname: "bakery.example", status: "pending", method: "meta_tag", canonicalHostname: "bakery.example" },
        created: false,
      } as Awaited<ReturnType<typeof registerDomain>>)
      .mockRejectedValueOnce(Object.assign(new Error("taken"), { code: "DOMAIN_TAKEN" }))

    const result = await runBusinessIntake("proj-1")

    expect(result).toMatchObject({ ok: true })
    expect(registerMock).toHaveBeenCalledTimes(2)
    expect(assessmentMock).toHaveBeenCalled()
    expect(stages().claim).toMatchObject({ state: "yours", hostname: "bakery.example" })
  })

  it("reads a cross-site redirect but never claims the site it redirects to", async () => {
    websiteMock.mockResolvedValue({
      facts: { ...websiteFacts, hostname: "platform.example", normalizedUrl: "https://platform.example/landing", redirectedFrom: "https://bakery.example" },
    } as Awaited<ReturnType<typeof collectWebsiteFacts>>)

    const result = await runBusinessIntake("proj-1")

    expect(result).toMatchObject({ ok: true })
    // Only the address the founder typed is claimed.
    expect(registerMock).toHaveBeenCalledTimes(1)
    expect(registerMock).toHaveBeenCalledWith(expect.objectContaining({ rawUrl: "https://bakery.example" }))
    expect(assessmentMock).toHaveBeenCalled()
  })

  it("refuses before the crawl when another account holds the business", async () => {
    claimMock.mockResolvedValue({
      doc: { userId: "user-2", projectId: "proj-2", hostname: "bakery.example" },
      canonicalHostname: "bakery.example",
    } as Awaited<ReturnType<typeof canonicalClaimFor>>)
    const result = await runBusinessIntake("proj-1")
    expect(result).toMatchObject({ ok: false, code: "BUSINESS_ALREADY_CONNECTED" })
    expect(websiteMock).not.toHaveBeenCalled()
    expect(assessmentMock).not.toHaveBeenCalled()
    expect(stages().claim).toMatchObject({ state: "held_by_other" })
  })

  it("reserves the business on the first run of a project created before claims existed", async () => {
    const result = await runBusinessIntake("proj-1")
    expect(result).toMatchObject({ ok: true })
    expect(reserveMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", projectId: "proj-1", rawUrl: "https://bakery.example" }),
    )
    expect(stages().claim).toMatchObject({ state: "yours" })
  })

  it("records which engine ran the read, and why it failed", async () => {
    assessmentMock.mockResolvedValue({
      ok: false,
      code: "ASSESSMENT_FAILED",
      message: "The co-founder could not produce a dependable assessment this time.",
      detail: "No reply from nvidia/nemotron-3-ultra-550b-a55b:free after 91s (timeout).",
      reason: "timeout",
    } as Awaited<ReturnType<typeof generateBusinessAssessment>>)

    await runBusinessIntake("proj-1")

    // The read runs on the founder's engine, so the failure can name it.
    const passed = assessmentMock.mock.calls[0][0].engine
    expect(passed).toMatchObject({ tierId: expect.any(String), tierName: expect.any(String), modelId: expect.any(String) })
    expect(stages().assessment).toMatchObject({
      status: "failed",
      errorReason: "timeout",
      engine: { tierId: passed?.tierId, tierName: passed?.tierName, modelId: passed?.modelId },
    })
  })

  it("an assessment failure keeps the collected evidence and reports partial completion", async () => {
    assessmentMock.mockResolvedValue({ ok: false, code: "AI_UNAVAILABLE", message: "no key" } as Awaited<ReturnType<typeof generateBusinessAssessment>>)
    const result = await runBusinessIntake("proj-1")
    expect(result).toMatchObject({ ok: true, status: "partially_completed", assessmentCompleted: false })
    expect(stages().website?.status).toBe("completed")
    expect(stages().assessment?.status).toBe("failed")
    expect(stages().assessment?.errorCode).toBe("AI_UNAVAILABLE")
  })

  it("clears a stale stage error when a retry succeeds", async () => {
    seedProject({
      ...buildIntakeRecord({ description: "d", websiteUrl: "https://bakery.example" }),
      website: { status: "failed", url: "https://bakery.example", errorCode: "UNREACHABLE", errorMessage: "down" },
    } as BusinessIntake)
    await runBusinessIntake("proj-1")
    expect(stages().website?.status).toBe("completed")
    expect(stages().website?.errorCode).toBeNull()
    expect(stages().website?.errorMessage).toBeNull()
  })

  it("releases the run as failed and reports INTAKE_FAILED on an unexpected throw", async () => {
    websiteMock.mockRejectedValue(new Error("boom"))
    const result = await runBusinessIntake("proj-1")
    expect(result).toMatchObject({ ok: false, code: "INTAKE_FAILED" })
    expect(stages().run?.status).toBe("failed")
    if (!result.ok) expect(result.message).not.toContain("boom")
  })
})