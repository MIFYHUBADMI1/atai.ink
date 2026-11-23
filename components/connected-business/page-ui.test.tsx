import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { Globe } from "lucide-react"

import { Chip, EmptyPanel, PageHero, SectionCard, StatTile } from "./page-ui"

/**
 * The operate surface is built from four pieces; these tests pin the things
 * that make it feel like one product — a hero names the page, a section carries
 * its icon and title, an empty state offers an action — and the responsive
 * guarantees that keep a phone from scrolling sideways.
 */

describe("PageHero", () => {
  it("renders the eyebrow, title, support line and chips", () => {
    const html = renderToStaticMarkup(
      <PageHero
        eyebrow="Growth"
        title="Turn the read into customers"
        description="Everything comes from what Atai read."
        meta={<Chip tone="success">Domain proved</Chip>}
      />,
    )

    expect(html).toContain("Growth")
    expect(html).toContain("Turn the read into customers")
    expect(html).toContain("Everything comes from what Atai read.")
    expect(html).toContain("Domain proved")
  })

  it("keeps a long title inside the page", () => {
    const html = renderToStaticMarkup(<PageHero eyebrow="Money" title={"A".repeat(200)} />)

    expect(html).toContain("break-words")
    expect(html).toContain("text-balance")
  })
})

describe("SectionCard", () => {
  it("renders the icon, title, description and body", () => {
    const html = renderToStaticMarkup(
      <SectionCard icon={Globe} title="What Atai read" description="The copy from your site.">
        <p>Body content</p>
      </SectionCard>,
    )

    expect(html).toContain("What Atai read")
    expect(html).toContain("The copy from your site.")
    expect(html).toContain("Body content")
    expect(html).toContain("bg-primary/10")
  })

  it("omits the body separator when there is no body", () => {
    const html = renderToStaticMarkup(<SectionCard title="Create & publish" />)

    expect(html).not.toContain("border-t")
  })
})

describe("EmptyPanel", () => {
  it("renders a title, explanation and the action that changes the state", () => {
    const html = renderToStaticMarkup(
      <EmptyPanel icon={Globe} title="No audit yet" description="Run the first one." action={<button>Run audit</button>} />,
    )

    expect(html).toContain("No audit yet")
    expect(html).toContain("Run the first one.")
    expect(html).toContain("Run audit")
    expect(html).toContain("border-dashed")
  })
})

describe("StatTile", () => {
  it("renders the number with tabular figures so columns line up", () => {
    const html = renderToStaticMarkup(<StatTile label="Applications" value={3} hint="Two verified" />)

    expect(html).toContain("Applications")
    expect(html).toContain(">3<")
    expect(html).toContain("Two verified")
    expect(html).toContain("tabular-nums")
  })
})

describe("Chip", () => {
  it("uses the requested tone and defaults to muted", () => {
    expect(renderToStaticMarkup(<Chip tone="danger">2 to improve</Chip>)).toContain("bg-red-500/10")
    expect(renderToStaticMarkup(<Chip>neutral</Chip>)).toContain("bg-muted")
  })
})
