/**
 * The Atai SDK brief for a connected business.
 *
 * Pure string generation so the exact text is testable and the same brief is
 * served from the preview and the download. It describes only what Atai
 * actually does on this path: no repository import, no rebuild, no hosting or
 * database migration.
 *
 * It is written to be handed to a coding agent, so it is complete on its own:
 * every command, every file, every field name. The only credential it can carry
 * is a scoped runtime key, and only in the downloadable copy.
 */

import type { BusinessObjectiveId } from "@/lib/types/business-intake"

export const INTEGRATION_GUIDE_VERSION = "1.1"

export const CONNECTION_KEY_SCOPES = ["analytics"] as const

export interface IntegrationGuideInput {
  projectId: string
  businessName: string
  /** The live application address the founder entered. */
  appUrl?: string
  /** Present once a domain has been verified for this business. */
  verifiedHostname?: string
  /** Absolute Atai origin, e.g. https://atai.ink */
  apiBaseUrl: string
  /** Secret only in the downloadable copy; the preview uses a placeholder. */
  keySecret?: string
  keyPrefix?: string
  /** What the founder said they want. Shapes the events we ask for. */
  objectives?: readonly BusinessObjectiveId[]
  generatedAt?: number
}

const PLACEHOLDER_KEY = "atai_production_<your-key>"
const PLACEHOLDER_BROWSER_KEY = "atai_production_pk_<your-browser-key>"

export interface TrackingEvent {
  name: string
  /** When to record it, in the founder's words. */
  when: string
}

/** The events every business should record, whatever it sells. */
const BASE_EVENTS: readonly TrackingEvent[] = [
  { name: "signup", when: "a new account is created" },
  { name: "purchase", when: "a payment succeeds (send `value` and `currency`)" },
]

/** Events that make the summary answer a specific goal. */
const OBJECTIVE_EVENTS: Partial<Record<BusinessObjectiveId, readonly TrackingEvent[]>> = {
  acquire_customers: [{ name: "lead_captured", when: "someone leaves an email or asks to be contacted" }],
  increase_revenue: [{ name: "checkout_started", when: "checkout opens, before payment" }],
  improve_marketing: [{ name: "cta_clicked", when: "a visitor presses the main call to action" }],
  improve_retention: [
    { name: "login", when: "an existing customer signs in" },
    { name: "subscription_renewed", when: "a recurring payment renews" },
  ],
  automate_operations: [{ name: "job_completed", when: "a background job or import finishes" }],
  improve_finances: [{ name: "refund_issued", when: "money is returned to a customer" }],
  improve_website: [{ name: "form_submitted", when: "a form on the site is submitted" }],
}

/**
 * The events worth recording for the goals this business picked, plus the two
 * that every business needs. Never more than eight, because a long list is a
 * list nobody implements.
 */
export function trackingPlanFor(objectives: readonly BusinessObjectiveId[] = []): TrackingEvent[] {
  const plan = [...BASE_EVENTS]
  for (const objective of objectives) {
    for (const event of OBJECTIVE_EVENTS[objective] ?? []) {
      if (!plan.some((existing) => existing.name === event.name)) plan.push(event)
    }
  }
  return plan.slice(0, 8)
}

function bullet(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n")
}

export function buildIntegrationGuide(input: IntegrationGuideInput): string {
  const generatedAt = new Date(input.generatedAt ?? Date.now()).toISOString()
  const apiBase = input.apiBaseUrl.replace(/\/+$/, "")
  const key = input.keySecret ?? PLACEHOLDER_KEY
  const host = input.verifiedHostname ?? (input.appUrl ? safeHost(input.appUrl) : undefined)
  const plan = trackingPlanFor(input.objectives)
  const domainLine = input.verifiedHostname
    ? `Domain ownership verified: **${input.verifiedHostname}**`
    : `Domain ownership is not verified yet. Verify it on the business page before going live — Atai only trusts events from a business it can prove is yours.`

  return `# Connect ${input.businessName} to Atai — brief for your coding agent

SDK brief · v${INTEGRATION_GUIDE_VERSION} · generated ${generatedAt}
Project: \`${input.projectId}\`
${input.appUrl ? `Application: ${input.appUrl}\n` : ""}
> **How to use this file.** Give it to your coding agent and say: "follow this
> brief". It is complete: every command, file and field name is below, and no
> other document is needed. Work through the steps in order.

> This brief connects an application that already runs outside Atai. Atai does
> **not** import your repository, build your application, copy your code, or
> move your hosting or database. Nothing here changes how your application is
> built or where it runs.

## What you get

${bullet([
  "Product analytics for this business — page views, journeys, clicks and the events you send — stored in Atai and scoped to this project.",
  "A connection Atai can prove: the first authenticated call from your application is recorded as the handshake.",
  "No third-party analytics account and no provider credentials in your code: Atai handles providers behind its runtime.",
])}

## Before you start

${bullet([
  domainLine,
  "A place to store a secret on your server (environment variable or secret manager).",
  "Your coding agent, or a developer, able to deploy a small server-side change.",
])}

## Two keys, two jobs — do not mix them up

| Key | Where it lives | What it can do |
| --- | --- | --- |
| **Runtime key** \`atai_production_…\` | your server only (environment variable) | call the Atai Runtime API: \`analytics.track\`, \`health.check\`, and any other capability you grant it |
| **Publishable key** \`atai_production_pk_…\` | public: it ships in the page | record page views, clicks and journeys from the browser. Nothing else — it cannot call a provider, read data or spend a credit |

The runtime key is a **secret**: never in client-side JavaScript, a mobile
bundle or a public repository. The publishable key is meant to be public; it
only ever writes analytics events for this one project.

## Step 1 — Install the SDK (server side)

\`\`\`bash
npm install @atai-group/sdk
# pnpm add @atai-group/sdk
# yarn add @atai-group/sdk
\`\`\`

Node 18 or newer. TypeScript types ship with the package — no \`@types\` package.
If your application is not Node/TypeScript, skip to "Plain HTTP" in the
reference at the end: every call is a single \`POST\`.

## Step 2 — Store the runtime key on your server

\`\`\`bash
# .env — server side only, never committed
ATAI_API_KEY=${key}
\`\`\`

${input.keySecret ? `This key was issued for this business only (prefix \`${input.keyPrefix ?? "atai_…"}\`). It is shown once; if it leaks, revoke it in Atai and download this brief again.\n` : `Create a runtime key in Atai → Workspace → Runtime, then replace the placeholder above.\n`}

## Step 3 — Create the client, once

\`\`\`ts
// lib/atai.ts — one module, imported everywhere else
import { Atai } from "@atai-group/sdk"

export const atai = new Atai({ apiKey: process.env.ATAI_API_KEY! })
\`\`\`

## Step 4 — Confirm the connection

\`\`\`ts
const health = await atai.health.check()
console.log(health.identity.projectId, health.identity.scopes)
\`\`\`

The first successful call is Atai's proof that your application is genuinely
connected. It is recorded against this business and shown on the business page.
Run it once at boot, or from a deploy health check — not on every request.

## Step 5 — Record the events that matter for this business

${plan.map((event) => `- \`${event.name}\` — ${event.when}`).join("\n")}

\`\`\`ts
await atai.analytics.track({
  events: [
    { name: "signup", visitorId: userId, path: "/signup" },
    { name: "purchase", visitorId: userId, properties: { value: 49, currency: "USD" } },
  ],
})
\`\`\`

Rules Atai enforces: 1–100 events per call · name ≤ 100 characters · ≤ 20
properties per event · ≤ 500 characters per value · ≤ 8 KB per event · scalar
values only (string, number, boolean) · never send passwords, tokens or card
data — credential-like property names are stripped · events are kept 90 days.

## Step 6 — Measure the pages in the browser

Page views, route changes, clicks and time on page come from a small script,
using the **publishable** key:

\`\`\`html
<script defer src="${apiBase}/atai-analytics.js" data-atai-key="${PLACEHOLDER_BROWSER_KEY}"></script>
\`\`\`

Create the key in Atai → this business → Settings → **Measure your site**, then
paste it in place of the placeholder. Add the line to the \`<head>\` of every
page — one layout or template file is enough in most frameworks.

What it records: page views (including single-page-app route changes), clicks
with a readable label, and time on page. What it does not do: cookies for
cross-site tracking, anything with personal data, or any call that could cost
you credits.

## Step 7 — Check it arrived

\`\`\`ts
const summary = await atai.analytics.summary({ windowDays: 7 })
console.log(summary.totalEvents, summary.uniqueVisitors, summary.topEvents)
\`\`\`

The same numbers appear in this business's Atai workspace (Growth → Product
analytics) once events land — usually within a minute.

## Working with your coding agent

${bullet([
  "Add one server-side module that creates the Atai client from `ATAI_API_KEY` (Step 3).",
  "Call `atai.health.check()` once at startup or in the deploy health check (Step 4).",
  "Send the events in Step 5 from code paths you already have — do not add new tracking infrastructure.",
  "Add the browser snippet from Step 6 to the page layout, with the publishable key.",
  "Keep the runtime key in server configuration. Do not add it to client bundles, and do not expose a proxy that forwards arbitrary capability calls.",
  "Do not restructure the application, migrate the database, or change hosting for this integration.",
  "Do not import the repository into Atai and do not create a second project for this application.",
])}

## Troubleshooting

${bullet([
  "`401` on the Runtime API — the runtime key is missing, mistyped, revoked or expired. Issue a new one and redeploy.",
  "`401` from `/api/analytics/collect` — the snippet is using the runtime key. It needs the publishable key from Settings.",
  "`403` — the key does not hold the capability scope you called.",
  "`429` — rate limit or concurrency cap. Retry with backoff; do not loop.",
  "The business page still says “Waiting for your app” — the health check has not reached Atai. Confirm outbound HTTPS from your server and that you are calling the origin above.",
  "“Waiting for domain proof” — the application called successfully, but no domain is verified yet.",
])}

## Reference

- SDK docs and the full capability list: ${apiBase}/sdk
- Runtime API: \`POST ${apiBase}/api/runtime/v1\` with \`{ "capability": "analytics", "operation": "track", "input": { "events": [...] } }\`
- Health: \`GET ${apiBase}/api/runtime/v1/health\`
- Plain HTTP, no SDK:

\`\`\`bash
curl -s ${apiBase}/api/runtime/v1 \\
  -H "Authorization: Bearer $ATAI_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"capability":"analytics","operation":"track","input":{"events":[{"name":"signup","visitorId":"visitor-123"}]}}'
\`\`\`

## What this key can do

This connection key is scoped to **${CONNECTION_KEY_SCOPES.join(", ")}**. Other Atai
capabilities (AI, search, email, payments and so on) exist, but they are not
granted to this key. Issue a separate key with the scopes you need from your
Atai workspace; this connection keeps working with its own key.

## What Atai will never ask for

${bullet([
  "Your repository, or an import of your source code.",
  "Access to your hosting, database or CI.",
  "A rebuild of your application inside Atai.",
])}

If anything asks for those on this path, it is not this integration.

— Atai
${host ? `\nBusiness domain: ${host}` : ""}
`
}

function safeHost(url: string): string | undefined {
  try {
    return new URL(url).hostname
  } catch {
    return undefined
  }
}
