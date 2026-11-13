import { describe, expect, it } from "vitest"
import {
  BENCH_STEPS,
  buildPrefill,
  firstActions,
  matchChannel,
  recommendChannels,
  skippedChannels,
  type GuideContext,
} from "./beginner-guide"

const BASE: GuideContext = {
  hasLiveSite: false,
  hasSavedStrategy: false,
  strategyChannels: [],
  icp: "",
  targetUsers: [],
  positioning: "",
  businessGoal: "",
}

describe("BENCH_STEPS", () => {
  it("tells the founder that Atai never posts anything for them", () => {
    const last = BENCH_STEPS[BENCH_STEPS.length - 1]
    expect(last.detail).toContain("never post, publish, buy or place anything")
  })
})

describe("matchChannel", () => {
  it("maps the words a founder actually writes to a place", () => {
    expect(matchChannel("Facebook page")?.id).toBe("facebook")
    expect(matchChannel("IG")?.id).toBe("instagram")
    expect(matchChannel("GBP")?.id).toBe("google-business")
    expect(matchChannel("whatsapp business")?.id).toBe("whatsapp")
  })

  it("returns nothing for a place it does not know", () => {
    expect(matchChannel("carrier pigeon")).toBeNull()
    expect(matchChannel("")).toBeNull()
  })
})

describe("recommendChannels", () => {
  it("leads with the founder's own saved strategy", () => {
    const picks = recommendChannels({
      ...BASE,
      hasSavedStrategy: true,
      strategyChannels: ["TikTok", "Facebook page"],
    })
    expect(picks[0].channel.id).toBe("tiktok")
    expect(picks[0].source).toBe("your-strategy")
    expect(picks[0].why).toContain("You chose")
  })

  it("suggests a short, free starter list when nothing is saved", () => {
    const picks = recommendChannels(BASE)
    expect(picks.length).toBeLessThanOrEqual(3)
    expect(picks.map((pick) => pick.channel.id)).toContain("facebook")
    expect(picks.every((pick) => pick.channel.cost === "free")).toBe(true)
    expect(picks.every((pick) => pick.source === "starter")).toBe(true)
  })

  it("never lists the same place twice", () => {
    const picks = recommendChannels({
      ...BASE,
      hasSavedStrategy: true,
      strategyChannels: ["Facebook", "facebook page", "FB"],
    })
    const ids = picks.map((pick) => pick.channel.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("tells the founder to publish the site before pointing a listing at it", () => {
    const picks = recommendChannels(BASE)
    const google = picks.find((pick) => pick.channel.id === "google-business")
    expect(google?.why).toContain("Publish your site first")
  })
})

describe("skippedChannels", () => {
  it("explains why TikTok is not on top", () => {
    const skipped = skippedChannels(BASE)
    const tiktok = skipped.find((entry) => entry.channel.id === "tiktok")
    expect(tiktok?.why).toContain("several times a week")
  })

  it("never lists a place twice", () => {
    const skipped = skippedChannels(BASE)
    const ids = skipped.map((entry) => entry.channel.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe("firstActions", () => {
  it("puts publishing the site first when there is no live site", () => {
    const actions = firstActions(BASE)
    expect(actions[0].id).toBe("site")
    expect(actions[0].title).toContain("Publish your site")
  })

  it("asks for the link instead once the site is live", () => {
    const actions = firstActions({ ...BASE, hasLiveSite: true })
    expect(actions[0].id).toBe("link")
  })

  it("stays short enough for a beginner to finish", () => {
    expect(firstActions(BASE).length).toBeLessThanOrEqual(5)
  })
})

describe("buildPrefill", () => {
  it("takes the offer from the founder's own positioning", () => {
    const prefill = buildPrefill({
      ...BASE,
      positioning: "A neighbourhood bakery that delivers before breakfast. It also does catering.",
    })
    expect(prefill.offer).toBe("A neighbourhood bakery that delivers before breakfast.")
    expect(prefill.offerFilled).toBe(true)
  })

  it("uses the saved ideal customer before the plan's user list", () => {
    const prefill = buildPrefill({
      ...BASE,
      icp: "Office managers ordering breakfast",
      targetUsers: ["Commuters", "Offices"],
    })
    expect(prefill.audience).toBe("Office managers ordering breakfast")
  })

  it("falls back to the plan's target users when there is no saved customer", () => {
    const prefill = buildPrefill({ ...BASE, targetUsers: ["Commuters", "Offices"] })
    expect(prefill.audience).toBe("Commuters, Offices")
  })

  it("leaves both fields empty when nothing is known", () => {
    const prefill = buildPrefill(BASE)
    expect(prefill.offer).toBe("")
    expect(prefill.audience).toBe("")
    expect(prefill.offerFilled).toBe(false)
  })
})
