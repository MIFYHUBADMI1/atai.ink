import { describe, expect, it } from "vitest"
import { createPlanUpdateFilter } from "@/lib/analysis/plan-update-stream"

function drain(chunks: string[]): string {
  const filter = createPlanUpdateFilter()
  const emitted: string[] = []
  for (const chunk of chunks) {
    const out = filter.push(chunk)
    if (out) emitted.push(out)
  }
  const rest = filter.flush()
  if (rest) emitted.push(rest)
  return emitted.join("")
}

const PROSE = "Here is a draft."
const BLOCK = "<plan-update>" + '{"section":"pricingTiers","proposedValue":"A|B","reason":"Sharper"}' + "</plan-update>"

describe("plan-update stream filter", () => {
  it("passes ordinary prose straight through", () => {
    expect(drain(["Your pricing ", "page needs tiers."])).toBe("Your pricing page needs tiers.")
  })

  it("cuts the protocol block out of the transcript", () => {
    expect(drain([PROSE + "\n\n" + BLOCK.slice(0, 13), BLOCK.slice(13)])).toBe(PROSE + "\n\n")
  })

  it("holds a tag that arrives split across frames", () => {
    // "<plan" must not be shown yet: the next frame could complete the tag.
    expect(drain(["Look: <plan", '-update>{"section":"vision"}</plan-update>'])).toBe("Look: ")
  })

  it("releases held-back text that turns out to be ordinary prose", () => {
    expect(drain(["The <plan", "ning is simple."])).toBe("The <planning is simple.")
  })

  it("suppresses everything after an unclosed tag", () => {
    expect(drain([PROSE + " <plan-update>" + '{"section":'])).toBe(PROSE + " ")
  })
})
