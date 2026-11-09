import { describe, expect, it } from "vitest"

import {
  BUILD_STAGES,
  getBuildMessages,
  getStageMessage,
  getStageMessages,
  stageForProgress,
  stageForServerStage,
} from "./build-messages"

const ctx = {
  projectName: "Insight Flow",
  projectPurpose: "Helps product teams turn messy meeting notes into decisions owners can track.",
  sourceUrl: "https://notion.so/product-updates",
}

const corpus = getBuildMessages(ctx)

describe("build message corpus", () => {
  it("stays large enough that a long build never repeats", () => {
    expect(corpus.length).toBeGreaterThan(3000)
  })

  it("carries the 5000+ words the build screen was built around", () => {
    const words = corpus.reduce((total, message) => total + message.split(/\s+/).length, 0)
    expect(words).toBeGreaterThan(5000)
  })

  it("attributes the work to a team, never to a faceless AI or a first-person we", () => {
    const offenders = corpus.filter((message) =>
      /\b(the AI|our AI|AIs|we|our|us|I)\b/i.test(message.replace(/\bminus\b/gi, "")),
    )
    expect(offenders).toEqual([])
  })
})

describe("stage pools", () => {
  it("gives every visible stage its own vocabulary", () => {
    for (const stage of BUILD_STAGES) {
      const pool = getStageMessages(stage.id, ctx)
      expect(pool.length, stage.id).toBeGreaterThan(30)
      expect(new Set(pool).size, stage.id).toBe(pool.length)
    }
  })

  it("wraps around instead of running out mid-build", () => {
    const first = getStageMessage("backend", 0, ctx)
    const wrapped = getStageMessage("backend", getStageMessages("backend", ctx).length, ctx)
    expect(wrapped).toBe(first)
  })

  it("names the project in stage messages", () => {
    expect(getStageMessage("release", 0, ctx)).toContain("Insight Flow")
  })
})

describe("stage resolution", () => {
  it("advances as progress advances", () => {
    expect(stageForProgress(0).id).toBe("research")
    expect(stageForProgress(35).id).toBe("interface")
    expect(stageForProgress(100).id).toBe("release")
  })

  it("follows the server's own event stage", () => {
    expect(stageForServerStage("analyze").id).toBe("research")
    expect(stageForServerStage("specify").id).toBe("architecture")
    expect(stageForServerStage("deploy").id).toBe("release")
    expect(stageForServerStage("mystery", 85).id).toBe("optimization")
    expect(stageForServerStage(undefined, 50).id).toBe("backend")
  })
})
