# Runtime, SDK & API access

Atai can build a complete, working app for you — and you can run it without touching any code. This page covers the technical side in plain language: the shared connection that powers every Atai app (the "Runtime"), the optional developer toolkit (the "SDK"), and how to keep your access safe.

If you're not a developer, you can read the first two sections and stop. Everything after that is for people writing their own code.

> **New to Atai?** Start with the [Getting Started guide](/docs/onboarding), [create an account](/register), or [sign in](/login).

## 1. What the Runtime is

Every app Atai builds needs a handful of common abilities. Depending on what your business does, it may need to:

- talk to an AI model (for chat, writing, summaries, or recommendations),
- take payments and manage subscriptions,
- show maps and locations,
- send email or text messages,
- let people sign in,
- search through data,
- and store and read information.

Instead of wiring up a dozen separate services — each with its own account, key, and quirks — Atai gives your app one unified connection: the **Runtime**. It reaches all of these through a single, consistent interface.

| Ability | What it's for |
|---|---|
| **AI** | Chat, writing, summaries, and other model-powered features |
| **Payments** | Charges, subscriptions, payouts, refunds |
| **Maps** | Locations, addresses, and directions |
| **Messaging** | Email and text messages |
| **Sign-in** | Verifying who a user is |
| **Search** | Finding things in your data |
| **Data** | Reading and writing your app's information |

### Why it matters

- **One connection, many abilities.** You don't manage a separate integration for each service.
- **Consistency.** Every capability works the same way, so your app is simpler to build and maintain.
- **Security.** Atai handles the sensitive parts — you don't store provider secrets in your app.
- **No setup for built apps.** If Atai generated your app, the connection is already configured for you.

You don't need to know which underlying services are used. Atai manages that for you and keeps it consistent.

### The trade-off, stated honestly

A unified interface means you get sensible defaults rather than total control. For most apps that's a win — you ship faster and you don't have to babysit five integrations. If you need a very specific configuration that only the underlying provider exposes, the Runtime may not cover it, and you'd integrate that one service yourself.

## 2. Who this page is for

This page is for **developers and technical users** who want to understand or use the Runtime from their own code. If you're not technical, you can skip it entirely — everything here is handled for you automatically when Atai builds your app.

Two situations where this page is useful:

- You want to add a feature to an Atai-built app that needs custom code.
- You're building your own app (on any host) and want to use Atai's capabilities.

## 3. Three words to know

Before the code, three terms that make the rest easier:

- **Capability** — a whole area of ability, like `ai` or `payments`. You pick the capability first.
- **Operation** — one action inside a capability, like "chat" or "create a charge". You call an operation.
- **Key** — the credential that proves your app is allowed to make the call. Covered in section 5.

So a request reads as: *"using capability X, do operation Y, with these inputs."* That's the whole mental model. Every capability follows it.

## 4. The Atai SDK (optional)

If you (or a developer you work with) want to call Atai's capabilities from your own code, there's an optional toolkit called the **Atai SDK**. It gives you a clean, typed way to make requests from your app.

You don't have to use it — the Runtime works over plain HTTP too. The SDK just saves you from writing the same boilerplate repeatedly, and gives you better error messages when something is wrong.

### Install

```bash
npm install @atai-group/sdk
```

### Initialize

```ts
import { Atai } from "@atai-group/sdk"

const atai = new Atai({ apiKey: process.env.ATAI_API_KEY! })
```

Create the client once, near where your app starts, and reuse it. Creating a new client on every request wastes time and can make rate limiting worse.

### Your first call

```ts
const reply = await atai.ai.chat({
  messages: [{ role: "user", content: "Write a short welcome message for my store." }],
})
console.log(reply.content)
```

If that prints a message, everything is wired correctly. If it throws, jump to section 9 — the error text will tell you which of the three words above went wrong.

### Recommended: call it from your server

Keep your key on the server, never in the browser. A simple pattern is a small server endpoint that your front end calls:

```ts
// server-side only — the key never reaches the browser
import { Atai } from "@atai-group/sdk"

const atai = new Atai({ apiKey: process.env.ATAI_API_KEY! })

export async function POST(req: Request) {
  const { message } = await req.json()
  const reply = await atai.ai.chat({
    messages: [{ role: "user", content: message }],
  })
  return Response.json({ reply: reply.content })
}
```

If Atai generated your app, you don't need to do any of this — the connection is already in place.

> **Why the server matters.** Anything in code that runs in a browser can be read by anyone who opens developer tools. A key placed there is effectively public the moment your site is live. The proxy pattern above means the browser only ever talks to *your* server, and your server holds the key.

### Handling failures properly

Network calls fail. The difference between a hobby project and a real app is what happens next.

```ts
try {
  const reply = await atai.ai.chat({
    messages: [{ role: "user", content: message }],
  })
  return Response.json({ reply: reply.content })
} catch (error) {
  // Log the detail for you, show something friendly to the user.
  console.error("ai.chat failed", error)
  return Response.json(
    { error: "We couldn't generate that just now. Please try again." },
    { status: 502 },
  )
}
```

Two rules: **log the detail, show the summary.** Users can't act on a stack trace; you can't debug a friendly message.

## 5. API keys: what they are

An API key is like a password that lets your app talk to Atai on your behalf. It identifies your app and controls what it's allowed to do.

- **Treat it like a password.** Anyone with the key can act as your app.
- **Keep it secret.** Never share it, post it publicly, or put it in code that runs in a browser.
- **Use one per environment.** A separate key for testing and for your live app keeps problems contained.
- **Scope it narrowly.** If a part of your app only needs one ability, give it a key that only has that ability.

### Why one key per environment

If testing and production share a key, a test run can touch real data, real charges, and real messages — and when you rotate the key to fix one, you break the other. Two keys costs you nothing and prevents an entire category of incident.

A workable naming habit: `web-prod`, `web-staging`, `script-backfill`, `mobile-ios`. The name should tell you where it lives and what it does, so revoking the right one later is obvious.

### What a key is not

A key is **not** a user login. It identifies your *app*, not a person. Deciding who a person is — and what they're allowed to see — is a separate concern handled by sign-in inside your app. Don't use an API key as a substitute for authentication.

## 6. Create, rotate, and revoke keys

You manage keys in your project's settings, in the **developer / API** area.

### Create a key

1. Open your project, then go to Settings → Developer / API.
2. Click **Create key**, give it a clear name (for example, "website-backend"), and choose what it can access.
3. Copy the full key immediately — for security, it's shown only once.
4. Store it in your app's secret settings (environment variables), not in your code.

If you lose a key before saving it, you can't recover it — create a new one and revoke the old.

### Rotate a key

Rotating replaces a key with a new one. Do this on a schedule, and immediately if you suspect a leak. After rotating, update your app's secret settings so it uses the new key.

A rotation without a redeploy is the most common cause of "it broke after I rotated" — the old key is revoked, but your running app still holds it in memory. Rotate, update the secret, redeploy, then confirm with one test request.

### Revoke a key

If a key is no longer needed — or if it may have been exposed — revoke it. Anything using that key will stop working, so make sure nothing still depends on it.

Before revoking, ask: *what would break?* Search your repositories and hosting settings for the key's name. If you can't be sure, create the replacement first, deploy it, confirm it works, and *then* revoke.

## 7. Keep your keys safe

A short checklist that prevents most problems:

- [ ] Keys are stored in environment variables or a secret manager — never in source code.
- [ ] Keys never appear in a browser, a mobile app, or a public repository.
- [ ] You use a separate key for testing and for production.
- [ ] Each key has only the access it needs.
- [ ] You rotate keys periodically and after any suspected leak.
- [ ] You never paste keys into chat, screenshots, support tickets, or issue trackers.
- [ ] Atai will never ask you to share your key with another person.

### If you think a key leaked

Act first, investigate second:

1. **Revoke** the key in Settings → Developer / API.
2. **Create** a replacement.
3. **Deploy** it to your app's secret settings.
4. **Check** your usage for anything you don't recognise.
5. **Find** the leak — a commit, a screenshot, a pasted log — and remove it.

A revoked key is worthless to an attacker within seconds. The expensive mistake is hesitating because you're not sure.

### A note on repositories

Deleting a key from a file does not remove it from your git history. If a key was ever committed, treat it as leaked and rotate it — don't rely on a later commit to hide it.

## 8. Using the Runtime from your app

A few simple rules keep your integration healthy:

- **Call from the server.** Put the key on your backend, not in client-side code.
- **Read from the environment.** Load the key from an environment variable so it isn't hard-coded.
- **Handle errors gracefully.** Show a friendly message instead of a raw error, and log enough detail to debug.
- **Respect limits.** If you get "rate limited," slow down and retry after a moment.
- **Keep dependencies current.** Update the SDK occasionally to get fixes and improvements.

### Retrying without making things worse

Not every failure should be retried. Roughly:

- **Rate limited** — yes, retry, but wait. Retrying instantly makes it worse.
- **Unauthorized** — no. Retrying a bad key will never succeed; fix the key.
- **Invalid configuration** — no. Same reason.
- **Timeout or network error** — yes, once or twice, with a growing delay.

A simple backoff: wait 1 second, then 2, then 4. Stop after three attempts and surface a real error. Infinite retries turn a small blip into an outage.

### Idempotency, in one paragraph

If you retry something that *creates* a thing — a charge, an order, a message — a retry can create it twice. Where a capability supports it, pass a unique reference for the request so a repeat with the same reference is treated as the same request. If you're unsure whether a capability supports this, assume it doesn't, and check the result before retrying.

### Logging that helps later

Log the capability, the operation, the outcome, and a request id — never the key and never full user content. When something goes wrong at 2 a.m., those four fields are the difference between a five-minute fix and a two-hour hunt.

## 9. Understanding common errors

When something goes wrong, the error usually falls into one of a few buckets.

### "Unauthorized"
Your app's key is missing, wrong, or no longer active. Check that the key is set in the environment where your code runs, and that it's still valid in your project's developer / API settings.

The most common cause isn't a bad key — it's a key that exists locally but was never added to the live environment.

### "Rate limited"
Your app is sending more requests than your plan allows in a short time. Slow down, retry after a moment, and check your usage if it keeps happening.

If it happens constantly under normal use, you probably have a loop or a retry without a delay. Fix the loop before asking for a higher limit.

### "Invalid configuration"
The SDK couldn't start because something is missing — usually an empty or undefined key. Make sure you're passing a non-empty key from your environment.

A classic: the variable exists in `.env.local` but the deploy target doesn't have it, so it reads as `undefined` at runtime.

### "Not found" or "unknown operation"
The capability or action you asked for doesn't exist or is spelled differently. Double-check the name, and make sure you're using a capability your key is allowed to access.

### Timeouts
The request took too long. Retry once with a short delay. If it repeats, the operation may be doing more work than you think — consider splitting it.

### A short decision tree

| What you see | Look at first |
|---|---|
| Unauthorized | Is the key set in *this* environment? |
| Rate limited | Loops, retry delay, request volume |
| Invalid configuration | Is the key empty or `undefined` at startup? |
| Unknown operation | Spelling of the capability and operation |
| Timeout | Request size, retry, network |

## 10. Common problems

### My app says "Unauthorized"
- *Cause:* the key is missing, incorrect, or has been revoked.
- *Fix:* check that the key is set in your app's secret settings and is still active in your project's developer / API settings. If you're unsure, rotate the key and update your app.

### The key works on my computer but not on my live site
- *Cause:* the live environment doesn't have the key.
- *Fix:* add the key to your hosting provider's secret / environment settings, then redeploy.

### I'm being "rate limited"
- *Cause:* your app is sending more requests than your plan allows in a short time.
- *Fix:* slow down and retry after a moment. Check your usage and plan in your project settings if it keeps happening.

### I can't find where to manage keys
- *Fix:* open your project, then go to Settings → Developer / API. Keys are managed there.

### The SDK says my configuration is invalid
- *Cause:* the key is missing or empty.
- *Fix:* make sure you're passing a non-empty key from your environment.

### I think my key leaked
- *Fix:* revoke it immediately in Settings → Developer / API, create a new one, update your app's secret settings, and redeploy. Then review where the old key might have been exposed.

### It broke right after I rotated the key
- *Cause:* the new key is in your settings, but your running app still has the old one.
- *Fix:* redeploy so the new value is loaded, then send one test request to confirm.

### My calls work but return empty results
- *Cause:* usually a filter or an empty table rather than an auth problem.
- *Fix:* check the inputs you're sending, and confirm the table you're querying has records.

### Everything is slow
- *Cause:* creating a new client per request, or retrying without a delay.
- *Fix:* create the client once and reuse it; add a backoff between retries.

## 11. Related guides

- **[Getting Started guide](/docs/onboarding)** — the full, plain-language walkthrough.
- **[Database Manager guide](/docs/database-manager)** — where your app's data lives.
- **[Troubleshooting & common problems](/docs/troubleshooting)** — quick fixes.
- **[Growth & marketing playbook](/docs/growth-marketing)** — growing after launch.
- **[SDK reference](/sdk)** and the **[developer hub](/developers)** for more technical detail.
