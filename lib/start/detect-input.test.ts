import { describe, expect, it } from "vitest"
import {
  combineLinkPrompt,
  detectStartMode,
  extractGithubRepo,
  extractWebsiteUrl,
  promptForStart,
  splitLinkPrompt,
  suggestProjectTitle,
  validateProjectTitle,
  validateStartInput,
} from "./detect-input"

describe("extractGithubRepo", () => {
  it("reads full URLs and owner/repo shorthand", () => {
    expect(extractGithubRepo("https://github.com/vercel/next.js")).toBe("https://github.com/vercel/next.js")
    expect(extractGithubRepo("vercel/next.js")).toBe("vercel/next.js")
  })
})

describe("extractWebsiteUrl", () => {
  it("reads http URLs and ignores GitHub links", () => {
    expect(extractWebsiteUrl("Analyze https://linear.app for my clinic")).toBe("https://linear.app/")
    expect(extractWebsiteUrl("https://github.com/vercel/next.js")).toBeNull()
  })
})

describe("detectStartMode", () => {
  it("does not assume idea from ordinary text", () => {
    expect(detectStartMode("A booking app for clinics")).toBeNull()
    expect(detectStartMode("https://linear.app")).toBe("url")
    expect(detectStartMode("github.com/vercel/next.js")).toBe("github")
  })
})

describe("promptForStart", () => {
  it("keeps the original request for every mode", () => {
    expect(promptForStart("idea", "A booking app for clinics")).toBe("A booking app for clinics")
    expect(promptForStart("url", "Look at https://linear.app please")).toBe("Look at https://linear.app please")
  })
})

describe("splitLinkPrompt / combineLinkPrompt", () => {
  it("splits a website URL from the instructions around it", () => {
    expect(splitLinkPrompt("url", "https://linear.app — help me understand the offer")).toEqual({
      url: "https://linear.app",
      notes: "help me understand the offer",
    })
    expect(splitLinkPrompt("url", "look at https://linear.app for my clinic").url).toBe("https://linear.app")
    expect(splitLinkPrompt("url", "just an idea")).toEqual({ url: "", notes: "just an idea" })
  })
  it("splits a GitHub URL and adds the scheme when missing", () => {
    expect(splitLinkPrompt("github", "github.com/vercel/next.js productize this")).toEqual({
      url: "https://github.com/vercel/next.js",
      notes: "productize this",
    })
    expect(splitLinkPrompt("github", "vercel/next.js")).toEqual({ url: "vercel/next.js", notes: "" })
  })
  it("recombines so downstream extraction still finds the URL", () => {
    const combined = combineLinkPrompt("https://linear.app", "help me plan a rival")
    expect(extractWebsiteUrl(combined)).toBe("https://linear.app/")
    expect(validateStartInput("url", combined)).toBeNull()
    expect(splitLinkPrompt("idea", "no link here")).toEqual({ url: "", notes: "no link here" })
  })
})

describe("validateStartInput", () => {
  it("asks for a URL in URL/mirror modes", () => {
    expect(validateStartInput("url", "just an idea")).toMatch(/valid website URL/i)
    expect(validateStartInput("github", "not a repo")).toMatch(/GitHub repository/i)
    expect(validateStartInput("idea", "")).toMatch(/build first/i)
  })
})

describe("suggestProjectTitle", () => {
  it("drafts a short title from the idea words", () => {
    expect(suggestProjectTitle("idea", "A booking platform for small clinics that handles payments")).toBe(
      "A Booking Platform For Small Clinics",
    )
  })
  it("uses the repository name for GitHub intent", () => {
    expect(suggestProjectTitle("github", "https://github.com/vercel/next.js productize this")).toBe("Next.Js")
  })
  it("drops the URL when only a website is pasted", () => {
    expect(suggestProjectTitle("url", "https://linear.app")).toBe("")
  })
})

describe("validateProjectTitle", () => {
  it("blocks empty, short, and over-long names", () => {
    expect(validateProjectTitle("")).toMatch(/name first/i)
    expect(validateProjectTitle("  ")).toMatch(/name first/i)
    expect(validateProjectTitle("ab")).toMatch(/at least 3/i)
    expect(validateProjectTitle("x".repeat(81))).toMatch(/under 80/i)
    expect(validateProjectTitle("Clinic Booking")).toBeNull()
  })
})
