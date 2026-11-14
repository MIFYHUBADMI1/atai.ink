# Growth & marketing playbook

Building the product is half the work — getting customers is the other half. Atai ships a **growth toolkit** so a non‑marketer can research the market, publish content, run ads, audit SEO, and learn what to do next, all from the workspace. This playbook maps every growth surface, what each one does, how features are gated, and fixes for the common "why is this greyed out / coming soon" problems.

> Short version: most growth tools live **inside a project** at [https://atai.ink/project/PROJECT_ID/market](https://atai.ink/project/PROJECT_ID/market). The top‑level /market, /ads, /competition pages are placeholders — use the project‑level tools. Some features are opt‑in and gated (see Feature gating).

## 1. Where the growth tools live

**Project‑level (the real tools)** — open a project first, then:

| Tool | URL |
|---|---|
| Growth overview | [https://atai.ink/project/PROJECT_ID/market](https://atai.ink/project/PROJECT_ID/market) |
| Content Studio | [https://atai.ink/project/PROJECT_ID/studio](https://atai.ink/project/PROJECT_ID/studio) |
| Ads | [https://atai.ink/project/PROJECT_ID/ads](https://atai.ink/project/PROJECT_ID/ads) |
| Campaigns | [https://atai.ink/project/PROJECT_ID/campaigns](https://atai.ink/project/PROJECT_ID/campaigns) |
| SEO audit | [https://atai.ink/project/PROJECT_ID/seo](https://atai.ink/project/PROJECT_ID/seo) |

Replace `PROJECT_ID` with your project's id.

**Top‑level (directory / placeholder pages)**

| Page | URL | Notes |
|---|---|---|
| Ads directory | [https://atai.ink/ads](https://atai.ink/ads) | Discovery; real work is project‑level |
| Market | [https://atai.ink/market](https://atai.ink/market) | Coming‑soon placeholder |
| Competition | [https://atai.ink/competition](https://atai.ink/competition) | Coming‑soon placeholder |
| Referrals | [https://atai.ink/referrals](https://atai.ink/referrals) | Earn free credits |
| Resources | [https://atai.ink/resources](https://atai.ink/resources) | Guides, playbooks, tutorials |
| Lessons | [https://atai.ink/lessons](https://atai.ink/lessons) | Business lessons & paths |

## 2. The growth overview (`/market`)

The growth overview at [https://atai.ink/project/PROJECT_ID/market](https://atai.ink/project/PROJECT_ID/market) is the command center: it pulls together market research, competitors, launch status, and the next recommended actions. The AI co‑founder exposes the same data through its `get_growth_overview` tool, so you can also ask the co‑founder "what should I do to grow this week?" and get a prioritized list.

## 3. Content Studio

The Studio ([https://atai.ink/project/PROJECT_ID/studio](https://atai.ink/project/PROJECT_ID/studio)) is where you produce the content that feeds growth:

- **Brand** — generate a consistent voice and asset kit.
- **Calendar** — plan and schedule posts.
- **Library** — store reusable assets and copy.
- **Campaigns / Promote** — assemble and push campaigns.

Treat Studio as your content engine: draft in Studio, then promote through the ads/campaigns surfaces.

## 4. SEO audit (`/seo`)

The SEO audit at [https://atai.ink/project/PROJECT_ID/seo](https://atai.ink/project/PROJECT_ID/seo) analyzes your published site for search‑engine readiness and gives a prioritized fix list (titles, meta, structure, speed signals). Run it after every meaningful change to the site.

## 5. Ads & campaigns

- **Ads** ([https://atai.ink/project/PROJECT_ID/ads](https://atai.ink/project/PROJECT_ID/ads), plus the top‑level [https://atai.ink/ads](https://atai.ink/ads)) — create and manage ad creatives and placements.
- **Campaigns** ([https://atai.ink/project/PROJECT_ID/campaigns](https://atai.ink/project/PROJECT_ID/campaigns)) — sequence multiple ads into a coordinated push with a calendar and goals.

Start with one small campaign, measure, then scale — don't launch everything at once.

## 6. Market & competition research

The growth overview includes market and competitor research. Use it to answer "who is this for, what do competitors charge, and what's my angle?" before spending on ads. The top‑level [https://atai.ink/competition](https://atai.ink/competition) and [https://atai.ink/market](https://atai.ink/market) are placeholders — do the real research from the project overview.

## 7. Referrals (earn free credits)

[https://atai.ink/referrals](https://atai.ink/referrals) gives you a link to share; when people sign up through it you earn free credits. It's the cheapest way to extend your credit balance without paying.

## 8. Learning: Resources & Lessons

- **Resources** ([https://atai.ink/resources](https://atai.ink/resources)) — founder guides, playbooks, tutorials, roadmaps, templates, documents, images, and videos.
- **Lessons** ([https://atai.ink/lessons](https://atai.ink/lessons)) — structured business lessons and learning paths.

Both are free to browse and are the fastest way to level up on a specific growth topic.

## 9. Feature gating — why something is "coming soon" or off

Several growth features are **opt‑in and gated**, which is the most common source of confusion. Three layers control visibility:

1. **Operator kill switch (env var).** If an env flag is `false`/`0` (e.g. `SEO_AUDIT_ENABLED=false`, `GROWTH_TASKS_ENABLED=false`, `CAMPAIGNS_ENABLED=false`, `LESSONS_ENABLED=false`, `LESSONS_AI_ENABLED=false`, or `GROWTH_OVERVIEW_ENABLED=false`), the feature is **unreachable for everyone** — the settings page locks the toggle honestly and you cannot override it.
2. **Founder switch.** When no kill switch is set, you control the feature from [https://atai.ink/settings/features](https://atai.ink/settings/features). Turning a switch off hides that tool.
3. **Rollout percent.** `GROWTH_OVERVIEW_ENABLED` can be unset and governed by `GROWTH_OVERVIEW_ROLLOUT_PERCENT` (default 100). If it's below 100, only a cohort of users sees the overview.

**Takeaway:** if a growth tool is greyed out, "Soon", or a "coming soon" page — check [https://atai.ink/settings/features](https://atai.ink/settings/features) first. If the toggle is locked, an operator kill switch is temporarily in effect and you cannot enable it yourself.

## 10. Common problems

### A growth tool is greyed out / shows "Soon"
- *Cause:* an operator kill switch or your [https://atai.ink/settings/features](https://atai.ink/settings/features) switch is off.
- *Fix:* open Settings → Features and enable it. If the toggle is locked/off‑grey, an env kill switch is active — it can't be overridden; wait for it to be lifted or ask support.

### Top‑level /market or /competition shows "coming soon"
- *Cause:* those are placeholder pages by design.
- *Fix:* use the **project‑level** tools at [https://atai.ink/project/PROJECT_ID/market](https://atai.ink/project/PROJECT_ID/market) (and the SEO/ads/campaigns routes under your project). The real functionality is per‑project.

### SEO audit won't run
- *Cause:* `SEO_AUDIT_ENABLED` kill switch is off, or the project isn't published yet (there's no live URL to audit).
- *Fix:* confirm the project is deployed (see the publishing guide), enable SEO in [https://atai.ink/settings/features](https://atai.ink/settings/features), and retry at [https://atai.ink/project/PROJECT_ID/seo](https://atai.ink/project/PROJECT_ID/seo).

### "Growth overview" is missing entirely
- *Cause:* `GROWTH_OVERVIEW_ENABLED=false`, or your rollout bucket is outside `GROWTH_OVERVIEW_ROLLOUT_PERCENT`.
- *Fix:* check the kill switch status; if rollout‑gated, it's a cohort thing and will appear when the rollout includes you, or ask an operator to raise the percent.

### Studios / campaigns produce nothing useful
- *Cause:* the project description or plan is thin, so the AI has little to work with.
- *Fix:* improve your plan in the workspace (Collaborate) with a clearer offer, audience, and pricing before generating content; the Studio uses that context.

### Referral credits didn't arrive
- *Cause:* the referred user hasn't verified email, or the link wasn't used.
- *Fix:* confirm the signup used your exact referral link and the new user verified email (welcome credits/referral credits grant on verification). See [https://atai.ink/referrals](https://atai.ink/referrals).
