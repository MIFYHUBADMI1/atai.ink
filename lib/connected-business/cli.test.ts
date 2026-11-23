import { describe, expect, it } from "vitest"

import { CliUsageError, flagValue, flagValues, limitOf, parseMode, requireRunId, resolveRunId } from "./cli"

const generate = () => "generated-id"

describe("migration arguments", () => {
  it("defaults to dry-run unless the operator says apply", () => {
    expect(parseMode(["node", "script"])).toBe("dry-run")
    expect(parseMode(["node", "script", "apply"])).toBe("apply")
    expect(parseMode(["node", "script", "APPLY"])).toBe("dry-run")
  })

  it("collects repeatable flags", () => {
    const argv = ["node", "script", "apply", "--project=p1", "--project=p2", "--user=u1"]
    expect(flagValues(argv, "project")).toEqual(["p1", "p2"])
    expect(flagValues(argv, "user")).toEqual(["u1"])
    expect(flagValues(argv, "missing")).toEqual([])
  })

  it("ignores an empty or malformed limit", () => {
    expect(limitOf(["node", "s", "--limit=10"])).toBe(10)
    expect(limitOf(["node", "s", "--limit="])).toBeUndefined()
    expect(limitOf(["node", "s", "--limit=0"])).toBeUndefined()
    expect(limitOf(["node", "s", "--limit=-3"])).toBeUndefined()
    expect(limitOf(["node", "s", "--limit=abc"])).toBeUndefined()
  })
})

describe("run ids", () => {
  it("refuses an apply without an explicit run id", () => {
    expect(() => resolveRunId({ mode: "apply", generate })).toThrow(CliUsageError)
    expect(() => resolveRunId({ mode: "apply", generate })).toThrow(/--run-id/)
  })

  it("generates one for a dry run, which writes nothing", () => {
    expect(resolveRunId({ mode: "dry-run", generate })).toBe("generated-id")
  })

  it("keeps the id the operator chose", () => {
    expect(resolveRunId({ mode: "apply", explicit: "2026-11-23-a", generate })).toBe("2026-11-23-a")
  })

  it("requires a run id for rollback in either mode", () => {
    expect(() => requireRunId(["node", "s", "dry-run"])).toThrow(CliUsageError)
    expect(requireRunId(["node", "s", "apply", "--run-id=run-1"])).toBe("run-1")
    expect(flagValue(["node", "s", "--run-id=run-1"], "run-id")).toBe("run-1")
  })
})
