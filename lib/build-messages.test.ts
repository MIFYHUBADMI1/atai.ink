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
const bareCorpus = getBuildMessages({})

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

/**
 * The build screen narrates work the squads genuinely do. It must never claim a
 * measurement, a study, or an outcome that was never produced — that was audit
 * finding G. These guards keep the removed classes of claim from creeping back.
 */
describe("build message honesty guards", () => {
  const FORBIDDEN: Array<{ claim: string; pattern: RegExp }> = [
    { claim: "fabricated counts of users, tests or interviews", pattern: /\b\d[\d,]*\+?\s+(real\s+|potential\s+)?(users|customers|respondents|interviews|edge cases|test cases)\b/i },
    { claim: "invented research speed", pattern: /in 0?\.\d+\s?(seconds|ms|milliseconds)/i },
    { claim: "invented throughput", pattern: /\d[\d,]*\s?(lines per second|words per minute)\b/i },
    { claim: "claimed competitor war-gaming", pattern: /war-gam/i },
    { claim: "claimed profit or revenue outcome", pattern: /profitable at scale|will be profitable|guaranteed (sales|revenue|customers|income|profit)/i },
    { claim: "invented market sizing", pattern: /\bTAM\b|\$\s?\d+(\.\d+)?\s?(B|bn|billion|million)\b/i },
    { claim: "invented uptime or SLA figure", pattern: /9\d\.\d+\s?%|zero single points of failure/i },
    { claim: "claimed completed live testing", pattern: /tested with (real|live) (card|user|traffic)/i },
    { claim: "claimed a benchmark it did not run", pattern: /metrics don'?t lie|exceeds (them )?in every category|better than most shipped apps\. (verified|confirmed)/i },
    { claim: "claims work the platform cannot verify", pattern: /\b(200 real users|closed two leaks|47 times|3 days on)\b/i },
  ]

  const allMessages = [...corpus, ...bareCorpus]

  for (const { claim, pattern } of FORBIDDEN) {
    it(`never contains ${claim}`, () => {
      const offenders = allMessages.filter((message) => pattern.test(message))
      expect(offenders, offenders.join("\n")).toEqual([])
    })
  }

  it("keeps the three audit-named sentences out of the corpus for good", () => {
    for (const phrase of ["200 real users", "unit economics — profitable", "war-gamed"]) {
      expect(corpus.some((message) => message.includes(phrase)), phrase).toBe(false)
    }
  })
})
