import { describe, expect, it } from "vitest"

import {
  RECOVERY_BATCH,
  STALE_BUILD_MS,
  hasRecoverableBuild,
  isOrphanedBuild,
  isStaleBuild,
  selectOrphanedBuilds,
} from "./build-recovery"

const NOW = 1_800_000_000_000
const MIN = 60_000

function build(overrides: Partial<Parameters<typeof isOrphanedBuild>[0]> = {}) {
  return {
    state: "building" as const,
    totalumProjectId: "provider-build-1",
    lastPolledAt: NOW - 30 * MIN,
    updatedAt: NOW - 40 * MIN,
    ...overrides,
  }
}

describe("recognising an abandoned build", () => {
  it("only counts a build the provider can still be asked about", () => {
    expect(hasRecoverableBuild(build())).toBe(true)
    expect(hasRecoverableBuild(build({ totalumProjectId: undefined }))).toBe(false)
  })

  it("covers building and deploying, and nothing past them", () => {
    expect(hasRecoverableBuild(build({ state: "deploying" }))).toBe(true)
    expect(hasRecoverableBuild(build({ state: "ready" }))).toBe(false)
    expect(hasRecoverableBuild(build({ state: "build_failed" }))).toBe(false)
  })

  it("treats a build nobody polled for five minutes as interrupted", () => {
    expect(isStaleBuild(build(), NOW)).toBe(true)
    expect(isStaleBuild(build({ lastPolledAt: NOW - MIN }), NOW)).toBe(false)
  })

  it("never calls a build abandoned before it was ever polled", () => {
    expect(isStaleBuild(build({ lastPolledAt: undefined }), NOW)).toBe(false)
  })

  it("falls back to the project's own clock for builds predating poll tracking", () => {
    const untracked = build({ lastPolledAt: undefined, updatedAt: NOW - 20 * MIN })
    expect(isOrphanedBuild(untracked, NOW)).toBe(true)
    expect(isOrphanedBuild(build({ lastPolledAt: undefined, updatedAt: NOW - MIN }), NOW)).toBe(false)
  })

  it("respects the shared staleness window", () => {
    expect(isOrphanedBuild(build({ lastPolledAt: NOW - STALE_BUILD_MS + MIN }), NOW)).toBe(false)
    expect(isOrphanedBuild(build({ lastPolledAt: NOW - STALE_BUILD_MS - MIN }), NOW)).toBe(true)
  })
})

describe("batching recovery probes", () => {
  it("returns only abandoned builds, newest first", () => {
    const abandoned = build({ totalumProjectId: "old-build" })
    const fresher = build({ totalumProjectId: "new-build", lastPolledAt: NOW - 10 * MIN, updatedAt: NOW - 12 * MIN })
    const watched = build({ totalumProjectId: "live-build", lastPolledAt: NOW - 20_000 })
    const finished = build({ totalumProjectId: "done-build", state: "ready" })
    const unclaimed = build({ totalumProjectId: undefined })

    const picked = selectOrphanedBuilds([abandoned, finished, watched, fresher, unclaimed], NOW)

    expect(picked.map((p) => p.totalumProjectId)).toEqual(["new-build", "old-build"])
  })

  it("caps the probes so a big portfolio cannot stampede the builder", () => {
    const many = Array.from({ length: RECOVERY_BATCH + 4 }, (_, i) =>
      build({ totalumProjectId: `build-${i}`, updatedAt: NOW - (i + 1) * MIN }),
    )
    expect(selectOrphanedBuilds(many, NOW)).toHaveLength(RECOVERY_BATCH)
  })
})
