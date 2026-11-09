import { describe, expect, it } from "vitest"
import {
  chunkForSpeech,
  normalizeMarkdown,
  plainTextFromMarkdown,
  speechTextFromMarkdown,
} from "./speech-text"

describe("plainTextFromMarkdown — the copy button", () => {
  it("keeps the words, the shape and the link target", () => {
    const md = [
      "## Where you stand",
      "",
      "Your **pricing** is unclear — see [the plan](https://example.com/p).",
      "",
      "- Free tier",
      "- Paid tier",
    ].join("\n")
    expect(plainTextFromMarkdown(md)).toBe(
      "Where you stand\n\nYour pricing is unclear — see the plan (https://example.com/p).\n\n- Free tier\n- Paid tier",
    )
  })

  it("keeps code content without its fence", () => {
    expect(plainTextFromMarkdown("```ts\nconst a = 1\n```")).toBe("const a = 1")
  })

  it("drops table rules but keeps the cells", () => {
    const md = "| Tier | Price |\n| --- | --- |\n| Free | $0 |"
    expect(plainTextFromMarkdown(md)).toBe("| Tier | Price |\n| Free | $0 |")
  })

  it("handles the heading shapes the replies actually arrive in", () => {
    expect(plainTextFromMarkdown("##Pricing\n### Plan ###")).toBe("Pricing\nPlan")
  })

  it("leaves a bare number sign alone", () => {
    expect(plainTextFromMarkdown("#1 is the launch week")).toBe("#1 is the launch week")
  })
})

describe("speechTextFromMarkdown — the read-aloud", () => {
  it("reads prose, not markup", () => {
    expect(speechTextFromMarkdown("**Ship the MVP.** Then *iterate*.")).toBe(
      "Ship the MVP. Then iterate.",
    )
  })

  it("silences code blocks instead of reading them out", () => {
    const md = "Use this helper:\n\n```ts\nfunction add(a, b) { return a + b }\n```\n"
    expect(speechTextFromMarkdown(md)).toBe("Use this helper:")
  })

  it("spells what a voice would mangle", () => {
    expect(speechTextFromMarkdown("Targets e.g. solo founders — price & promote.")).toBe(
      "Targets for example solo founders, price and promote.",
    )
    expect(speechTextFromMarkdown("Visit https://example.com/pricing now")).toBe("Visit a link now")
    expect(speechTextFromMarkdown("Churn is 50%")).toBe("Churn is 50 percent")
  })

  it("turns list items into sentences without their markers", () => {
    expect(speechTextFromMarkdown("- First step\n* Second step\n1. Third step")).toBe(
      "First step. Second step. Third step",
    )
    expect(speechTextFromMarkdown("\t• Deep step\n   · Deeper step")).toBe(
      "Deep step. Deeper step",
    )
  })

  it("says nothing when a reply is only code", () => {
    expect(speechTextFromMarkdown("```sql\nselect 1\n```")).toBe("")
    expect(speechTextFromMarkdown("   ")).toBe("")
  })

  // The reported defect: the voice read the hash marks out loud.
  it("never says a markdown character, however sloppy the reply is", () => {
    const md = [
      "##Pricing##",
      "",
      "Your **price** is unclear (`40%` of signups bounce) ###",
      "",
      "  - first step",
      "\t• second step",
      "1. third step",
      "",
      "Rank #1, then 2 * 3 units __now__ ~~later~~.",
    ].join("\n")
    const spoken = speechTextFromMarkdown(md)
    expect(spoken).toBe(
      "Pricing. Your price is unclear (40 percent of signups bounce). first step. second step. third step. Rank number 1, then 2 times 3 units now later.",
    )
    for (const mark of ["#", "*", "_", "~", "`", "|"]) expect(spoken).not.toContain(mark)
  })

  it("keeps a heading's words and drops its hashes", () => {
    expect(speechTextFromMarkdown("##Title")).toBe("Title")
    expect(speechTextFromMarkdown("### Plan ###")).toBe("Plan")
    expect(speechTextFromMarkdown("#1 pick: ship")).toBe("number 1 pick: ship")
  })

  it("reads html as the words behind it", () => {
    expect(speechTextFromMarkdown("Price &amp; ship<br>Plan #2")).toBe(
      "Price and ship. Plan number 2",
    )
  })

  // The reported defect: the voice said "backslash n" out loud.
  it("turns written-out escapes back into breaks", () => {
    expect(speechTextFromMarkdown("Ship the MVP\\n\\nThen iterate")).toBe(
      "Ship the MVP. Then iterate",
    )
    expect(speechTextFromMarkdown("Price /n/n Promote")).toBe("Price. Promote")
    expect(speechTextFromMarkdown("First\\tsecond")).toBe("First. second")
  })

  it("does not mistake a path or a slash for an escape", () => {
    expect(speechTextFromMarkdown("Read the config/n file")).toBe("Read the config/n file")
    expect(speechTextFromMarkdown("a \\ b")).toBe("a b")
  })
})

describe("normalizeMarkdown — the renderer", () => {
  it("repairs the shapes CommonMark renders literally", () => {
    expect(normalizeMarkdown("##Title")).toBe("## Title")
    expect(normalizeMarkdown("### Plan ###")).toBe("### Plan")
    expect(normalizeMarkdown("  ##Nested")).toBe("  ## Nested")
  })

  it("never rewrites inside a code fence", () => {
    const md = "```py\n# comment\n##Title\n```"
    expect(normalizeMarkdown(md)).toBe(md)
  })

  it("leaves prose that only looks like markup", () => {
    expect(normalizeMarkdown("Built in C#")).toBe("Built in C#")
    expect(normalizeMarkdown("#1 is the launch week")).toBe("#1 is the launch week")
  })
})

describe("chunkForSpeech", () => {
  it("keeps whole sentences together until the limit", () => {
    const chunks = chunkForSpeech("Short one. Short two.", 40)
    expect(chunks).toEqual(["Short one. Short two."])
  })

  it("splits past the limit on sentence boundaries", () => {
    const text = "Alpha sentence here. Beta sentence too. Gamma ends it."
    const chunks = chunkForSpeech(text, 35)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join(" ")).toBe(text)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(35)
  })

  it("breaks a single over-long sentence on words", () => {
    const chunks = chunkForSpeech("word ".repeat(80).trim(), 60)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(60)
  })
})
