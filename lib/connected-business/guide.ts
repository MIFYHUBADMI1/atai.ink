/**
 * The Atai Integration Guide for a connected business.
 *
 * Pure string generation so the exact text is testable and the same guide is
 * served from the preview and the download. It describes only what Atai
 * actually does on this path: no repository import, no rebuild, no hosting or
 * database migration. The only credential it can carry is a scoped connection
 * key, and only in the downloadable copy.
 */

export const INTEGRATION_GUIDE_VERSION = "1.0"

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
  generatedAt?: number
}

const PLACEHOLDER_KEY = "atai_production_<your-key>"

function bullet(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n")
}

export function buildIntegrationGuide(input: IntegrationGuideInput): string {
  const generatedAt = new Date(input.generatedAt ?? Date.now()).toISOString()
  const apiBase = input.apiBaseUrl.replace(/\/+$/, "")
  const key = input.keySecret ?? PLACEHOLDER_KEY
  const host = input.verifiedHostname ?? (input.appUrl ? safeHost(input.appUrl) : undefined)
  const domainLine = input.verifiedHostname
    ? `Domain ownership verified: **${input.verifiedHostname}**`
    : `Domain ownership is not verified yet. Verify it on the business page before going live — Atai only trusts events from a business it can prove is yours.`

  return `# Connect ${input.businessName} to Atai

Integration guide · v${INTEGRATION_GUIDE_VERSION} · generated ${generatedAt}
Project: \`${input.projectId}\`
${input.appUrl ? `Application: ${input.appUrl}` : ""}

> This guide connects an application that already runs outside Atai.
> Atai does **not** import your repository, build your application, copy your
> code, or move your hosting or database. Nothing here changes how your
> application is built or where it runs.

## What you get

${bullet([
  "Verified product analytics for this business, stored in Atai and scoped to this project.",
  "A connection Atai can prove: the first authenticated call from your application is recorded as the handshake.",
  "No third-party analytics key and no provider credentials in your code — Atai handles providers behind its runtime.",
])}

## Before you start

${bullet([
  domainLine,
  "A place to store a secret on your server (environment variable or secret manager).",
  "Your coding agent, or a developer, able to deploy a small server-side change.",
])}

## Step 1 — Store the key on your server

\`\`\`bash
# .env (server-side only — never commit this file)
ATAI_API_KEY=${key}
\`\`\`

${input.keySecret ? `This key was issued for this business only (prefix \`${input.keyPrefix ?? "atai_..."}\`). It is shown once; if it leaks, revoke it in Atai → Workspace → Runtime and download this guide again.\n\n` : `Create a connection key in Atai → Workspace → Runtime, then replace the placeholder above.\n\n`}**The key is a server secret.** Atai has no browser-safe key type. Never put it
in client-side JavaScript, a mobile bundle, or a public repository. Call Atai
from your server (or a serverless function) and proxy what the browser needs.

## Step 2 — Confirm the connection

Node / TypeScript:

\`\`\`ts
import { Atai } from "@atai-group/sdk"

const atai = new Atai({ apiKey: process.env.ATAI_API_KEY! })

const health = await atai.health.check()
console.log(health.identity.projectId, health.identity.scopes)
\`\`\`

Or plain HTTP:

\`\`\`bash
curl -s ${apiBase}/api/runtime/v1/health \\
  -H "Authorization: Bearer $ATAI_API_KEY"
\`\`\`

The first successful call is Atai's proof that your application is genuinely
connected. It is recorded against this business and shown on the business page.
Run it once at boot, or from a deploy health check — not on every request.

## Step 3 — Send your first events

\`\`\`ts
await atai.analytics.track({
  events: [
    { name: "signup", visitorId: req.user.id, properties: { plan: "pro" } },
    { name: "checkout_completed", visitorId: req.user.id, properties: { value: 49 } },
  ],
})
\`\`\`

\`\`\`bash
curl -s ${apiBase}/api/runtime/v1 \\
  -H "Authorization: Bearer $ATAI_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"capability":"analytics","operation":"track","input":{"events":[{"name":"signup","visitorId":"visitor-123"}]}}'
\`\`\`

Event rules (enforced by Atai):

${bullet([
  "1–100 events per request; each name ≤ 100 characters.",
  "≤ 20 properties per event, ≤ 500 characters per value, ≤ 8 KB per event.",
  "Scalar values only (string, number, boolean). No nested objects.",
  "Never send passwords, tokens, card data or other secrets — credential-like property names are stripped.",
  "Events are retained for 90 days.",
])}

## Step 4 — Read the summary

\`\`\`ts
const summary = await atai.analytics.summary({ windowDays: 30 })
console.log(summary.totals, summary.topEvents)
\`\`\`

The same summary appears in this business's Atai workspace once events arrive.

## Working with your coding agent

Paste this section into your agent so it does not invent a different
integration:

${bullet([
  "Add one server-side module that creates the Atai client from ATAI_API_KEY.",
  "Call atai.health.check() once at startup or in the deploy health check.",
  "Send analytics events from server-side code paths you already have (signup, checkout, key actions).",
  "Keep the key in server configuration. Do not add it to client bundles or expose a proxy that forwards arbitrary capability calls.",
  "Do not restructure the application, migrate the database, or change hosting for this integration.",
  "Do not import the repository into Atai and do not create a second project for this application.",
])}

## What this key can do

This connection key is scoped to **${CONNECTION_KEY_SCOPES.join(", ")}**. Other Atai
capabilities (AI, search, email, payments and so on) exist, but they are not
granted to this key. Create a separate key with the scopes you need in
Atai → Workspace → Runtime; this connection keeps working with its own key.

## Troubleshooting

${bullet([
  "`401` — the key is missing, mistyped, revoked or expired. Issue a new one and redeploy.",
  "`403` — the key does not hold the capability scope you called.",
  "`429` — rate limit or concurrency cap. Retry with backoff; do not loop.",
  "The business page still says “Waiting for your app” — the health check has not reached Atai. Confirm outbound HTTPS from your server and that you are calling the origin above.",
  "“Waiting for domain proof” — the application called successfully, but no domain is verified yet.",
])}

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
