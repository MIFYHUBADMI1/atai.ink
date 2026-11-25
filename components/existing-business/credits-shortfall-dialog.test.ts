import { describe, expect, it } from "vitest"
import { describeShortfall } from "./credits-shortfall-dialog"

const short = { readCost: 40, assessmentCost: 60, required: 100, available: 35, shortfall: 65 }

describe("describeShortfall", () => {
  it("names the business, the gap and what the credits buy", () => {
    const copy = describeShortfall(short, "Corner Bakery")
    expect(copy.headline).toBe("You are 65 credits short of finishing Corner Bakery")
    expect(copy.lead).toContain("costs 100 credits")
    expect(copy.lead).toContain("You have 35 credits today")
    expect(copy.rows.map((r) => [r.label, r.value])).toEqual([
      ["Reading your live site", 40],
      ["Your co-founder's first read", 60],
      ["Total to connect", 100],
      ["Your balance", 35],
      ["Still needed", 65],
    ])
    expect(copy.cta).toBe("Add 65 credits")
  })

  it("falls back to a neutral name and never divides by a zero price", () => {
    const copy = describeShortfall({ readCost: 0, assessmentCost: 0, required: 0, available: 0, shortfall: 0 }, "")
    expect(copy.headline).toContain("your business")
    expect(copy.coveredPct).toBe(0)
  })

  it("shows the founder's engine as its own line, named", () => {
    const copy = describeShortfall(
      { readCost: 40, assessmentCost: 60, engineCost: 5, engineName: "Ember", required: 105, available: 100, shortfall: 5 },
      "Corner Bakery",
    )
    expect(copy.rows.map((r) => [r.label, r.value])).toEqual([
      ["Reading your live site", 40],
      ["Your co-founder's first read", 60],
      ["Your engine — Ember", 5],
      ["Total to connect", 105],
      ["Your balance", 100],
      ["Still needed", 5],
    ])
  })

  it("keeps the old three lines when the engine is free", () => {
    const copy = describeShortfall({ ...short, engineCost: 0 }, "Bakery")
    expect(copy.rows.some((r) => r.label.startsWith("Your engine"))).toBe(false)
  })

  it("counts a single credit without pluralising it", () => {
    expect(describeShortfall({ ...short, shortfall: 1 }, "Bakery").cta).toBe("Add 1 credit")
  })
})

describe("describeShortfall — co-founder message", () => {
  const message = { readCost: 0, assessmentCost: 5, required: 5, available: 2, shortfall: 3 }

  it("prices the message, not a journey", () => {
    const copy = describeShortfall(message, "", "message")
    expect(copy.headline).toBe("You are 3 credits short of your next message")
    expect(copy.lead).toContain("A message costs 5 credits")
    expect(copy.lead).not.toContain("Connecting")
    expect(copy.rows.map((r) => [r.label, r.value])).toEqual([
      ["Your next message", 5],
      ["Your balance", 2],
      ["Still needed", 3],
    ])
    expect(copy.cta).toBe("Add 3 credits")
  })

  it("never shows a site-read row", () => {
    const copy = describeShortfall(message, "Bakery", "message")
    expect(copy.rows.some((r) => r.label.includes("live site"))).toBe(false)
  })

  it("defaults to the connect journey", () => {
    expect(describeShortfall(short, "Bakery").headline).toContain("finishing Bakery")
  })
})
