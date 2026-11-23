import { beforeEach, describe, expect, it, vi } from "vitest"

const { state } = vi.hoisted(() => ({ state: { fail: false } }))

vi.mock("@/lib/db/collections", async () => {
  const { fakeCollection } = await import("@/lib/business/testing/fake-collections")
  const rollout = fakeCollection()
  return {
    businessRolloutCol: async () => {
      if (state.fail) throw new Error("database down")
      return rollout
    },
    __fakes: { rollout },
  }
})

import type { BusinessRolloutDoc } from "@/lib/types/business"
import type { FakeCollection } from "@/lib/business/testing/fake-collections"
import * as db from "@/lib/db/collections"
import {
  BUSINESS_ROLLOUT_ID,
  businessWorkspaceMode,
  clearBusinessRollout,
  getBusinessRollout,
  isBusinessWorkspaceEnabled,
  normaliseCohort,
  parseBusinessWorkspaceMode,
  resetBusinessRolloutCacheForTests,
  updateBusinessRollout,
} from "./flags"

const fakes = (db as unknown as { __fakes: { rollout: FakeCollection<BusinessRolloutDoc> } }).__fakes

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv("CONNECTED_WORKSPACE_V2", "")
  vi.stubEnv("CONNECTED_WORKSPACE_COHORT", "")
  fakes.rollout.docs.length = 0
  state.fail = false
  resetBusinessRolloutCacheForTests()
})

describe("mode parsing", () => {
  it("only accepts the two widening modes", () => {
    expect(parseBusinessWorkspaceMode("internal")).toBe("internal")
    expect(parseBusinessWorkspaceMode(" ALL ")).toBe("all")
    expect(parseBusinessWorkspaceMode("yes-please")).toBe("off")
    expect(parseBusinessWorkspaceMode("")).toBe("off")
    expect(parseBusinessWorkspaceMode(undefined)).toBe("off")
  })

  it("normalises the cohort: trimmed, de-duplicated, sorted", () => {
    expect(normaliseCohort([" u2", "u1", "u2", "", "  "])).toEqual(["u1", "u2"])
  })
})

describe("effective rollout", () => {
  it("is off with no admin setting and no env", async () => {
    const rollout = await getBusinessRollout()
    expect(rollout.mode).toBe("off")
    expect(rollout.source).toBe("default")
    expect(await isBusinessWorkspaceEnabled("u1")).toBe(false)
  })

  it("uses the deployment env vars while no admin has saved a setting", async () => {
    vi.stubEnv("CONNECTED_WORKSPACE_V2", "internal")
    vi.stubEnv("CONNECTED_WORKSPACE_COHORT", "u1, u2")

    const rollout = await getBusinessRollout()
    expect(rollout.mode).toBe("internal")
    expect(rollout.source).toBe("env")
    expect(await isBusinessWorkspaceEnabled("u2")).toBe(true)
    expect(await isBusinessWorkspaceEnabled("u3")).toBe(false)
  })

  it("lets the admin setting win over the env vars", async () => {
    vi.stubEnv("CONNECTED_WORKSPACE_V2", "all")
    fakes.rollout.docs.push({ id: BUSINESS_ROLLOUT_ID, mode: "off", cohort: [], updatedAt: 1 })

    const rollout = await getBusinessRollout()
    expect(rollout.mode).toBe("off")
    expect(rollout.source).toBe("admin")
    expect(await isBusinessWorkspaceEnabled("anyone")).toBe(false)
  })

  it("admits only the cohort in internal mode", async () => {
    fakes.rollout.docs.push({ id: BUSINESS_ROLLOUT_ID, mode: "internal", cohort: ["u1"], updatedAt: 1 })

    expect(await isBusinessWorkspaceEnabled("u1")).toBe(true)
    expect(await isBusinessWorkspaceEnabled("u2")).toBe(false)
    expect(await businessWorkspaceMode()).toBe("internal")
  })

  it("treats an unrecognised stored mode as off", async () => {
    fakes.rollout.docs.push({
      id: BUSINESS_ROLLOUT_ID,
      mode: "everyone-please" as BusinessRolloutDoc["mode"],
      cohort: ["u1"],
      updatedAt: 1,
    })

    expect(await isBusinessWorkspaceEnabled("u1")).toBe(false)
  })

  it("falls back to env, never open, when the read fails", async () => {
    state.fail = true
    expect(await isBusinessWorkspaceEnabled("u1")).toBe(false)

    vi.stubEnv("CONNECTED_WORKSPACE_V2", "internal")
    vi.stubEnv("CONNECTED_WORKSPACE_COHORT", "u1")
    resetBusinessRolloutCacheForTests()
    expect(await isBusinessWorkspaceEnabled("u1")).toBe(true)
  })

  it("serves repeated reads from the short-lived cache", async () => {
    fakes.rollout.docs.push({ id: BUSINESS_ROLLOUT_ID, mode: "internal", cohort: ["u1"], updatedAt: 1 })
    expect(await isBusinessWorkspaceEnabled("u1")).toBe(true)

    fakes.rollout.docs[0].mode = "off"
    expect(await isBusinessWorkspaceEnabled("u1")).toBe(true)

    resetBusinessRolloutCacheForTests()
    expect(await isBusinessWorkspaceEnabled("u1")).toBe(false)
  })
})

describe("admin writes", () => {
  it("changes the mode without touching the cohort", async () => {
    await updateBusinessRollout({ mode: "internal", cohort: ["u1", "u2"] }, "admin-1")

    const rollout = await updateBusinessRollout({ mode: "all" }, "admin-2")

    expect(rollout.mode).toBe("all")
    expect(rollout.cohort).toEqual(["u1", "u2"])
    expect(rollout.updatedBy).toBe("admin-2")
  })

  it("edits the cohort without touching the mode", async () => {
    await updateBusinessRollout({ mode: "internal", cohort: ["u1"] }, "admin-1")

    const rollout = await updateBusinessRollout({ cohort: ["u3", "u3", " u2 "] }, "admin-1")

    expect(rollout.mode).toBe("internal")
    expect(rollout.cohort).toEqual(["u2", "u3"])
  })

  it("keeps the env mode when a cohort is added before any admin setting exists", async () => {
    vi.stubEnv("CONNECTED_WORKSPACE_V2", "internal")
    vi.stubEnv("CONNECTED_WORKSPACE_COHORT", "u1")

    // The first admin write is a cohort edit, so the document does not exist
    // yet. It must not fall back to "off" just because it was created by an
    // edit that never mentioned the mode.
    const rollout = await updateBusinessRollout({ cohort: ["u1", "u2"] }, "admin-1")

    expect(rollout.mode).toBe("internal")
    expect(rollout.cohort).toEqual(["u1", "u2"])
    expect(await isBusinessWorkspaceEnabled("u2")).toBe(true)
  })

  it("keeps the env cohort when the mode is set before any admin setting exists", async () => {
    vi.stubEnv("CONNECTED_WORKSPACE_V2", "internal")
    vi.stubEnv("CONNECTED_WORKSPACE_COHORT", "u1")

    const rollout = await updateBusinessRollout({ mode: "all" }, "admin-1")

    expect(rollout.cohort).toEqual(["u1"])
    expect(await isBusinessWorkspaceEnabled("anyone")).toBe(true)
  })

  it("takes effect immediately, not after the cache window", async () => {
    expect(await isBusinessWorkspaceEnabled("u1")).toBe(false)

    await updateBusinessRollout({ mode: "internal", cohort: ["u1"] }, "admin-1")

    expect(await isBusinessWorkspaceEnabled("u1")).toBe(true)
  })

  it("clearing returns control to the deployment env vars", async () => {
    await updateBusinessRollout({ mode: "all" }, "admin-1")
    expect((await getBusinessRollout()).source).toBe("admin")

    vi.stubEnv("CONNECTED_WORKSPACE_V2", "off")
    const rollout = await clearBusinessRollout()

    expect(rollout.source).toBe("env")
    expect(rollout.mode).toBe("off")
    expect(fakes.rollout.docs).toHaveLength(0)
  })
})
