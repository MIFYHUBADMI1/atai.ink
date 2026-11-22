import { describe, expect, it, vi } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { IntakeView } from "@/lib/existing-business/view"
import { CONNECTION_STATUS_LABEL, businessConnectionStatus } from "@/lib/connected-business/status"
import { ConnectionCard } from "./connection-card"

vi.mock("@/lib/client/api", () => ({ postJson: vi.fn(), deleteJson: vi.fn() }))

type Connection = IntakeView["connection"]

function connection(overrides: Partial<Connection> = {}): Connection {
  return { status: "not_connected", label: CONNECTION_STATUS_LABEL.not_connected, ...overrides }
}

function render(props: { connection: Connection; domainVerified: boolean }) {
  return renderToStaticMarkup(
    createElement(ConnectionCard, {
      projectId: "p1",
      connection: props.connection,
      domainVerified: props.domainVerified,
      hostname: "bakery.example",
      onChanged: () => {},
    }),
  )
}

/**
 * The card is the only place a founder learns why their business is not
 * "connected" yet, so each half-finished state must name what is missing —
 * and "Connected" must never appear without the app having called Atai.
 */
describe("ConnectionCard", () => {
  it("explains both required halves before anything is done", () => {
    const html = render({ connection: connection(), domainVerified: false })

    expect(html).toContain(CONNECTION_STATUS_LABEL.not_connected)
    // The missing half must be named, not implied.
    expect(html).toContain("Go back a step — the connection cannot verify without it.")
    expect(html).not.toContain("Disconnect")
  })

  it("waits for the application after the domain is proven", () => {
    const status = businessConnectionStatus({
      connection: { guideIssuedAt: 1 },
      domainVerified: true,
    })
    const html = render({
      connection: connection({ status, label: CONNECTION_STATUS_LABEL[status], guideIssuedAt: 1 }),
      domainVerified: true,
    })

    expect(html).toContain(CONNECTION_STATUS_LABEL.awaiting_app)
    expect(html).toContain("That first authenticated call is the handshake Atai records.")
    expect(html).not.toContain("Disconnect")
    // The call happens outside this page, so the founder needs a way to ask
    // again without reloading the tab.
    expect(html).toContain("Check now")
    expect(html).toContain("no need to reload the page")
  })

  it("reports Connected only once a call was recorded, and states Atai builds nothing", () => {
    const seen = Date.now() - 60_000
    const status = businessConnectionStatus({
      connection: { firstSeenAt: seen, lastSeenAt: seen },
      domainVerified: true,
    })
    const html = render({
      connection: connection({ status, label: CONNECTION_STATUS_LABEL[status], firstSeenAt: seen, lastSeenAt: seen }),
      domainVerified: true,
    })

    expect(html).toContain(CONNECTION_STATUS_LABEL.verified)
    expect(html).toContain("Recorded — this is the proof Atai trusts.")
    expect(html).toContain("Disconnect")
    // Nothing is left to check once the handshake is recorded.
    expect(html).not.toContain("Check now")
  })
})
