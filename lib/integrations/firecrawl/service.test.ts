import { beforeEach, describe, expect, it, vi } from "vitest"

const scrapeMock = vi.fn()
const mapMock = vi.fn()

vi.mock("./client", () => ({
  scrapeUrl: (...args: unknown[]) => scrapeMock(...args),
  mapUrl: (...args: unknown[]) => mapMock(...args),
  crawlSiteUrl: vi.fn(),
  isFirecrawlConfigured: () => true,
  searchWeb: vi.fn(),
}))

vi.mock("@/lib/db/collections", () => ({
  firecrawlCacheCol: async () => ({ findOne: async () => null, updateOne: async () => ({}) }),
}))

const { crawlWebsite } = await import("./service")

function page(markdown: string, sourceURL?: string) {
  return { data: { markdown, metadata: sourceURL ? { sourceURL } : {} } }
}

beforeEach(() => {
  vi.clearAllMocks()
  mapMock.mockResolvedValue({ links: [] })
  scrapeMock.mockResolvedValue(page("root"))
})

describe("crawlWebsite — redirects", () => {
  it("follows the site it actually lands on, instead of reading one page", async () => {
    scrapeMock.mockImplementation(async (url: string) =>
      url === "https://preview.example-app.test"
        ? page("landing", "https://study.example.com/")
        : page(`text of ${url}`),
    )
    mapMock.mockResolvedValue({
      links: ["https://study.example.com/courses", "https://study.example.com/about"],
    })

    const evidence = await crawlWebsite("https://preview.example-app.test", { maxPages: 4 })

    expect(evidence.sourceUrl).toBe("https://preview.example-app.test")
    expect(evidence.finalUrl).toBe("https://study.example.com")
    expect(evidence.pages.map((p) => p.url)).toEqual([
      "https://study.example.com",
      "https://study.example.com/about",
      "https://study.example.com/courses",
    ])
  })

  it("does not treat a sibling subdomain on a shared platform as the same site", async () => {
    scrapeMock.mockImplementation(async (url: string) => page(`text of ${url}`))
    mapMock.mockResolvedValue({
      links: ["https://b.vercel.app/pricing", "https://a.vercel.app/about"],
    })

    const evidence = await crawlWebsite("https://a.vercel.app", { maxPages: 4 })

    expect(evidence.pages.map((p) => p.url)).toEqual(["https://a.vercel.app", "https://a.vercel.app/about"])
  })

  it("treats apex and www as one site", async () => {
    scrapeMock.mockImplementation(async (url: string) => page(`text of ${url}`))
    mapMock.mockResolvedValue({ links: ["https://www.example.com/pricing"] })

    const evidence = await crawlWebsite("https://example.com", { maxPages: 4 })

    expect(evidence.pages.map((p) => p.url)).toContain("https://www.example.com/pricing")
  })
})
