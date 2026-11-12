import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { parseCalendarDays, slotFileBase } from "@/lib/marketing/launch-kit-view"
import { LaunchKitDraftView } from "@/components/marketing/launch-kit-draft-view"

const DAY = (n: number, idea: string, channel: string, cta: string) =>
  `Day ${n} — ${idea} — ${channel} — ${cta}`

const calendarBody = [
  "Post daily for the first two weeks — announce, prove, then invite.",
  DAY(1, "Launch announcement short video — warm narration of the new ordering experience", "Instagram Reel", "'Tap the link in bio to place your first custom cake request today'"),
  DAY(2, "Founder story carousel from home kitchen to neighborhood bakery", "Instagram Feed", "Open the app to start your own celebration story"),
  DAY(3, "How it works carousel breaking down the four-step flow", "Instagram Feed", "Save this guide then open the app"),
  DAY(4, "Behind the scenes short video of morning batter mixing", "Instagram Reel", "Tap to order a cake made with this same care"),
].join("\n\n")

describe("launch kit calendar parsing", () => {
  it("splits day lines into idea, channel, and call to action without dropping content", () => {
    const parsed = parseCalendarDays(calendarBody)
    expect(parsed).not.toBeNull()
    expect(parsed?.days).toHaveLength(4)
    expect(parsed?.notes).toEqual(["Post daily for the first two weeks — announce, prove, then invite."])
    const first = parsed?.days[0]
    expect(first?.day).toBe(1)
    // The idea itself contains an em-dash — it must survive intact — and the
    // CTA arrives quote-wrapped like real drafts, so it unwraps for display.
    expect(first?.idea).toBe(
      "Launch announcement short video — warm narration of the new ordering experience",
    )
    expect(first?.channel).toBe("Instagram Reel")
    expect(first?.cta).toBe("Tap the link in bio to place your first custom cake request today")
    expect(first?.raw).toContain("Day 1 —")
  })

  it("keeps short lines readable and returns null for bodies that are not calendar-shaped", () => {
    expect(parseCalendarDays("Just a paragraph about posting.")).toBeNull()
    expect(parseCalendarDays("Day 1 — one idea only\nDay 2 — another")).toBeNull()
    const parsed = parseCalendarDays(`${DAY(1, "A simple day", "X", "Do it")}\n\n${DAY(2, "Another day", "X", "Do it")}\n\n${DAY(3, "Third day", "X", "Do it")}`)
    expect(parsed?.days[0].channel).toBe("X")
    expect(parsed?.notes).toEqual([])
  })

  it("builds a safe download filename from a slot label", () => {
    expect(slotFileBase("Launch post · X (Twitter)")).toBe("launch-post-x-twitter")
    expect(slotFileBase("///")).toBe("launch-kit-draft")
  })
})

describe("launch kit draft view rendering", () => {
  const item = { id: "i1", title: "14-day content calendar", body: calendarBody, creditsCharged: 3, createdAt: 1700000000000 }

  it("renders the calendar as day cards with progress and a per-day checklist", () => {
    const html = renderToStaticMarkup(
      <LaunchKitDraftView projectId="p1" slot="content-calendar" label="14-day content calendar" item={item} />,
    )
    expect(html).toContain("0 of 4 days done")
    expect(html).toContain("Day 1")
    expect(html).toContain("Instagram Reel")
    expect(html).toContain("Tap the link in bio")
    expect(html).toContain('role="checkbox"')
    expect(html).toContain('aria-checked="false"')
    expect(html).toContain("Post daily for the first two weeks")
    // The working-copy editor is opt-in; SSR stays deterministic.
    expect(html).not.toContain("Working copy —")
    expect(html).toContain("Copy")
    expect(html).toContain("Download")
  })

  it("renders other slots as formatted markdown with safe links", () => {
    const html = renderToStaticMarkup(
      <LaunchKitDraftView
        projectId="p1"
        slot="announcement-x"
        label="Launch post · X"
        item={{ ...item, body: "## Launch day\n\n- **Plain words** lead\n\n[Try it](https://example.com)\n\n<script>alert(1)</script>" }}
      />,
    )
    expect(html).toContain("<h2")
    expect(html).toContain("<strong")
    expect(html).toContain("https://example.com")
    expect(html).not.toContain("<script>")
  })
})
