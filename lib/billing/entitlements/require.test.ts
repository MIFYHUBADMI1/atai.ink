import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  authorize: vi.fn(),
  operations: vi.fn(),
}))

vi.mock("./service", () => ({
  authorize: h.authorize,
  authorizeOperations: h.operations,
}))

import {
  authorizeCustomDomain,
  authorizeProductionWork,
  authorizeStorage,
  authorizeSubdomain,
  entitlementDenial,
} from "./require"

const allow = { allowed: true }
const deny = (code: string) => ({ allowed: false, code, reason: `${code} reason` })

beforeEach(() => {
  vi.clearAllMocks()
  h.operations.mockResolvedValue([allow])
})

describe("authorizeProductionWork — compound operations", () => {
  it("checks build, database provisioning and specialist teams against one snapshot", async () => {
    h.operations.mockResolvedValueOnce([allow, allow, allow])
    await expect(authorizeProductionWork("u1", "buildProduction")).resolves.toBeNull()
    expect(h.operations).toHaveBeenCalledTimes(1)
    expect(h.operations).toHaveBeenCalledWith(
      "u1",
      [{ op: "buildProduction" }, { op: "provisionDatabase" }, { op: "useSpecialistTeam" }],
      { fresh: true },
    )
  })

  it("returns the first compound denial without deploying the build", async () => {
    h.operations.mockResolvedValueOnce([allow, deny("DATABASE_NOT_INCLUDED"), allow])
    await expect(authorizeProductionWork("u1", "buildProduction")).resolves.toMatchObject({
      code: "DATABASE_NOT_INCLUDED",
    })
  })

  it("skips the subdomain check when the project already owns a production URL", async () => {
    await expect(
      authorizeProductionWork("u1", "deploy", { hasExistingSubdomain: true }),
    ).resolves.toBeNull()
    expect(h.operations).toHaveBeenCalledTimes(1)
    expect(h.operations).toHaveBeenCalledWith("u1", [{ op: "deploy" }], { fresh: true })
  })

  it("refuses when the plan cannot be resolved instead of allowing the work", async () => {
    h.operations.mockRejectedValueOnce(new Error("database unavailable"))
    await expect(authorizeProductionWork("u1", "buildProduction")).resolves.toMatchObject({
      allowed: false,
      code: "ENTITLEMENT_UNAVAILABLE",
    })
  })

  it("checks the subdomain cap for a project that has never deployed", async () => {
    h.operations
      .mockResolvedValueOnce([allow])
      .mockResolvedValueOnce([deny("SUBDOMAIN_LIMIT")])
    await expect(authorizeProductionWork("u1", "deploy")).resolves.toMatchObject({
      code: "SUBDOMAIN_LIMIT",
    })
    expect(h.operations).toHaveBeenLastCalledWith(
      "u1",
      [{ op: "connectSubdomain", ctx: undefined }],
      { fresh: true },
    )
  })
})

describe("single-operation guards", () => {
  it("does not spend a second registration on an existing custom domain", async () => {
    await expect(authorizeCustomDomain("u1", true)).resolves.toBeNull()
    expect(h.operations).not.toHaveBeenCalled()
  })

  it("checks a new custom domain against the purchased cap", async () => {
    h.operations.mockResolvedValueOnce([deny("CUSTOM_DOMAIN_LIMIT")])
    await expect(authorizeCustomDomain("u1", false)).resolves.toMatchObject({
      code: "CUSTOM_DOMAIN_LIMIT",
    })
  })

  it("lets an existing subdomain be republished", async () => {
    await expect(authorizeSubdomain("u1", true)).resolves.toBeNull()
    expect(h.operations).not.toHaveBeenCalled()
  })

  it("checks storage as its own operation", async () => {
    await authorizeStorage("u1")
    expect(h.operations).toHaveBeenCalledWith(
      "u1",
      [{ op: "useStorage", ctx: undefined }],
      { fresh: true },
    )
  })

  it("turns a denial into the shared route shape", () => {
    expect(entitlementDenial(null)).toBeNull()
    expect(entitlementDenial(allow)).toBeNull()
    expect(entitlementDenial(deny("PLAN_LIMIT"))).toEqual({
      code: "PLAN_LIMIT",
      message: "PLAN_LIMIT reason",
    })
  })
})
