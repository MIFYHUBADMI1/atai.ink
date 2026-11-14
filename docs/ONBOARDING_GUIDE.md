# Atai — The Complete Onboarding Guide (Extended Documentation)

**The long-form, end-to-end manual for new owners of an Atai business.**
Everything here is grounded in the actual product at **https://atai.ink**. Every link is a real address you can open.

> **Who this is for:** You just created an Atai account (or you are about to) and you want to know *what Atai is, what every button does, where every page lives, and what to do when something goes wrong*. No coding knowledge assumed.
>
> **How to use it:** Read [Part 0](#part-0-orientation-what-atai-is) once, then use the ["I want to…" lookup table](#05-the-i-want-to-lookup-table-exact-urls) and [Part 10](#part-10-common-problems-and-how-to-solve-them) as a reference manual. Every chapter is independent.
>
> **URL convention:** `PROJECT_ID` in a URL means your own project's ID — copy it from your browser address bar when you are inside a project (for example `https://atai.ink/project/abc123/collaborate`). Project pages only work while you are signed in and only for projects you own.

---

## Table of contents

| Part | What it covers |
|---|---|
| [0](#part-0-orientation-what-atai-is) | Orientation: what Atai is, the vocabulary, the site map, the "I want to…" URL lookup |
| [1](#part-1-start-detailed-step-by-step) | START: account, verification, onboarding, choosing a starting point, modes |
| [2](#part-2-plan-detailed-step-by-step) | PLAN: project lifecycle, Collaborate, editing the plan, approving the build |
| [3](#part-3-build-detailed-step-by-step) | BUILD: what gets built, costs, monitoring, recovery |
| [4](#part-4-run-launch-detailed-step-by-step) | RUN & LAUNCH: publishing, domains, database, secrets, source, GitHub, runtime |
| [5](#part-5-operate-manage-detailed-step-by-step) | OPERATE & MANAGE: dashboard, co-founder, edits, versions, finances, settings |
| [6](#part-6-grow-detailed-step-by-step) | GROW: market, ads, campaigns, SEO, studio, lessons, resources, referrals |
| [7](#part-7-scale-detailed-step-by-step) | SCALE: runtime control center, developer portal, SDK, upgrades, admin |
| [8](#part-8-billing-credits-complete-reference) | BILLING & CREDITS: where the billing page is, plans, packs, full cost tables |
| [9](#part-9-complete-url-directory) | Complete URL directory (every page grouped by area) |
| [10](#part-10-common-problems-and-how-to-solve-them) | Common problems and exactly how to solve them |
| [11](#part-11-checklists-and-quick-reference) | Checklists: first 10 minutes, first day, weekly operations, scaling |
| [12](#part-12-glossary-and-where-to-learn-more) | Glossary and where to learn more |

---

## Part 0 — Orientation: what Atai is

## 0.1 What Atai is (and what it is not)

**Atai** stands for **Advanced Technologies and AI Enterprises**. It is an AI business-building platform at [https://atai.ink](https://atai.ink). Its purpose is to help a person **start, run, manage, and grow their own online business with specialized AI teams** — not merely to generate a website.

The distinction matters. Building a website is one step. Hosting it, serving customers, storing records, handling payments, running daily operations, and marketing what you sell are the actual purpose. Atai gives you an AI co-founder, planning agents, a build system, hosting, a database, a runtime API, and growth tools in one workspace.

**What you can do here:**

- Describe the business you want to run, in plain language
- Collaborate on a plan for customers, offer, and pricing **before any build spend**
- Create and host the website or digital product the business needs
- Operate customers, records, payments, and growth from one workspace
- Call AI, payments, maps, messaging, auth, search, and data services through one API key using the [Atai SDK](https://atai.ink/sdk)

**What Atai is not:** It is not a get-rich-quick promise. It does not promise income, customers, or business success. It is not a code playground for its own sake, and it is not a replacement for your own decisions about what to sell and to whom. It also does not require you to know how to code, hire a technical co-founder, or assemble a team.

**The company:** Atai was founded by Masereka Adorable Kimulya, a self-taught programmer from Kasese, Uganda. That story is at [https://atai.ink/founder](https://atai.ink/founder). The mission is to make economic opportunity less dependent on being able to afford a whole team.

**Support and contact (real, verified channels):**

| Channel | Address |
|---|---|
| Email | [support@atai.ink](mailto:support@atai.ink) |
| Phone / WhatsApp | [+256761819885](tel:+256761819885) |
| YouTube | [https://www.youtube.com/@mirrorsiteai](https://www.youtube.com/@mirrorsiteai) |
| WhatsApp community (token drops, discounts, competitions) | [https://chat.whatsapp.com/CB3zVz7UnsQLfDjjk04gt1](https://chat.whatsapp.com/CB3zVz7UnsQLfDjjk04gt1) |
| In-product feedback | Thumbs up/down at the bottom of every section on [https://atai.ink/docs](https://atai.ink/docs) |
| Feature requests & voting | [https://atai.ink/feature-requests](https://atai.ink/feature-requests) |
| Questions, legal, privacy | [https://atai.ink/privacy](https://atai.ink/privacy) · [https://atai.ink/terms](https://atai.ink/terms) · [https://atai.ink/refund-policy](https://atai.ink/refund-policy) · [https://atai.ink/database-terms](https://atai.ink/database-terms) |

## 0.2 The five jobs Atai does for you

Atai's own footer describes the platform in five words: **Planning, Building, Hosting, Operations, Marketing**. The product is organized around a single journey:

```
Imagine  →  Plan  →  Build  →  Launch  →  Operate  →  Grow  →  Scale
   /new    /.../collaborate   /.../progress   /.../hosting   /dashboard   /.../market   /.../runtime
```

1. **Plan** — Turn an idea, a reference website, or an existing GitHub repository into a structured product plan you can read and edit in plain business language.
2. **Build** — Generate a working application: UI, navigation, backend, database, user accounts, API layer, responsive layout, and deployment configuration.
3. **Host** — Publish to a free subdomain or your own domain, with HTTPS and global hosting.
4. **Operate** — Manage records in a visual Database Manager, watch your team's progress, iterate with plain-language instructions, and track finances.
5. **Grow / Scale** — Market research, ads, campaigns, SEO audits, business lessons, referrals, and a metered Runtime API with keys, limits, usage and health.

## 0.3 The vocabulary you need

| Term | Meaning |
|---|---|
| **Business / Project** | Atai calls your business a "project" in URLs and a "business" in the UI. Same thing. Each has an ID, e.g. `abc123`. |
| **Workspace** | The home page of one business: `https://atai.ink/project/PROJECT_ID`. Shows live state, build controls, preview, deployment history. |
| **Plan** | A plain-language blueprint: what is being built, for whom, key features, data, user flows, how users sign in, and Runtime & Integrations. |
| **Collaborate** | `https://atai.ink/project/PROJECT_ID/collaborate` — split view: plan on the left, AI chat on the right. Where you refine before building. |
| **Build** | The credit-consuming step that turns the approved plan into a real application. |
| **Deploy / Publish** | A **separate** credit-consuming step that puts the built app on production hosting. Building ≠ publishing. |
| **Credits** | Atai's internal currency. Spent on analysis, planning, building, deploying, chat, and growth actions. See [Part 8](#part-8-billing-credits-complete-reference). |
| **AI co-founder** | A chat panel available from the logged-in header ("Ask your AI co-founder") that can answer questions, propose actions, and navigate you to the right page. |
| **Standard / Pro (legacy / heavy)** | Two pipeline modes. Standard is fast and cheap; Pro runs a 7-stage quality pipeline and costs more. Chosen when you create a project. |
| **Relevant Info / Deep Crawl** | Website analysis depth. Relevant Info reads the most important pages; Deep Crawl crawls up to 50 pages of the whole site. |
| **Runtime API** | `https://atai.ink/api/runtime/v1` — the infrastructure endpoint your generated app calls for AI, payments, maps, messaging, auth, search, and data. |
| **Totalum** | The underlying application platform that supplies the generated app's database, deployment, and free `*.totalum-project.com` subdomain. |
| **Dodo Payments** | The payment processor for subscriptions and credit packs. **Not Stripe** — older notes that say Stripe are outdated. |

## 0.4 The site map at a glance

```
Public site (no login needed)
├── /                       Home
├── /docs                   Documentation (the short version)
├── /docs/onboarding        THIS GUIDE (the extended version)
├── /sdk                    Atai SDK & Runtime API reference
├── /developers             Developer portal
├── /pricing                Plans, credit packs, build costs
├── /modes-comparison       Standard vs Pro
├── /resources              Founder library (guides, playbooks, roadmaps…)
├── /about  /founder        Mission and founder story
├── /explore                Discover public businesses
├── /login  /register       Auth
└── /llms.txt               Machine-readable index for AI assistants

Signed-in area
├── /dashboard              Command center
├── /projects               All your businesses
├── /new                    Create a business
├── /notifications          Inbox
├── /finances               Business finances across projects
├── /settings               Account, credits, connected services
├── /referrals              Refer & Earn
├── /feature-requests       Vote on roadmap
└── /project/PROJECT_ID/…   One business (see Part 9)
```

**Top navigation bar (public site):** Home ([https://atai.ink/](https://atai.ink/)), Pricing, Resources, Docs, SDK & API, Developers, About, Explore, Dashboard (when signed in). On the home page the **"Your business"** dropdown contains: How Atai works, Plan your business, Start a business idea ([/new/idea](https://atai.ink/new/idea)), Start with inspiration ([/new/website](https://atai.ink/new/website)), Bring an existing codebase ([/new/github](https://atai.ink/new/github)), Explore businesses ([/explore](https://atai.ink/explore)).

**Logged-in app header:** "Ask your AI co-founder" button, Explore ([/explore](https://atai.ink/explore)), Feature requests ([/feature-requests](https://atai.ink/feature-requests)), a live credit meter that links to [https://atai.ink/settings/billing](https://atai.ink/settings/billing), theme toggle, and your avatar menu.

**Avatar (account) menu:** Account / profile → [https://atai.ink/account](https://atai.ink/account) (redirects to [/settings/profile](https://atai.ink/settings/profile)), Refer & Earn → [/referrals](https://atai.ink/referrals), Admin panel → [/admin](https://atai.ink/admin) (admins only), Settings → [/settings](https://atai.ink/settings), Appearance → [/settings/appearance](https://atai.ink/settings/appearance), Sign out.

**Dashboard left sidebar:** Home [/dashboard](https://atai.ink/dashboard), Businesses [/projects](https://atai.ink/projects), Finances [/finances](https://atai.ink/finances), Notifications [/notifications](https://atai.ink/notifications), New business [/new](https://atai.ink/new); Discover: Explore, Feature requests; bottom: Settings and **Ask Atai** (opens Collaborate for your active project), and a **Help** link to [/docs](https://atai.ink/docs) in the header.

**Inside a business, the sidebar splits into three groups:** Project tools (Workspace, Team progress, Collaborate, Plan, Edit app, Source, Runtime, Database, Environment, Hosting, Export snapshot), Application intelligence (Intelligence), and Grow your business (Market & grow, Ads & Growth, Campaigns, Business finances, Business lessons, Resources, Competition). Exact URLs in [Part 9](#part-9-complete-url-directory).

## 0.5 The "I want to…" lookup table (exact URLs)

This is the fastest way to find anything. Bookmark it.

| I want to… | Go to |
|---|---|
| **See my billing page / balance / plan / invoices** | **[https://atai.ink/settings/billing](https://atai.ink/settings/billing)** |
| Buy credits / top up | [https://atai.ink/settings/billing](https://atai.ink/settings/billing) → "Buy Permanent Credits" |
| Compare plans and prices | [https://atai.ink/pricing](https://atai.ink/pricing) |
| Change or cancel my subscription | [https://atai.ink/settings/billing](https://atai.ink/settings/billing) → Subscription Plans |
| See my credit transaction history / ledger | [https://atai.ink/settings/billing](https://atai.ink/settings/billing) → Credit History; also [https://atai.ink/admin/ledger](https://atai.ink/admin/ledger) (admins) |
| Change my name, avatar, email | [https://atai.ink/settings/profile](https://atai.ink/settings/profile) |
| Change password, manage sessions | [https://atai.ink/settings/security](https://atai.ink/settings/security) |
| Change dark/light/glass theme | [https://atai.ink/settings/appearance](https://atai.ink/settings/appearance) or the theme icon in the top bar |
| Turn SEO audits / growth tasks / campaigns / lessons on | [https://atai.ink/settings/features](https://atai.ink/settings/features) |
| All settings in one place | [https://atai.ink/settings](https://atai.ink/settings) |
| See all my businesses | [https://atai.ink/projects](https://atai.ink/projects) |
| Start a new business | [https://atai.ink/new](https://atai.ink/new) |
| Start from an idea | [https://atai.ink/new/idea](https://atai.ink/new/idea) |
| Start from a website | [https://atai.ink/new/website](https://atai.ink/new/website) |
| Start from a GitHub repo | [https://atai.ink/new/github](https://atai.ink/new/github) |
| Review/refine my plan before building | [https://atai.ink/project/PROJECT_ID/collaborate](https://atai.ink/project/PROJECT_ID/collaborate) |
| See the raw plan | [https://atai.ink/project/PROJECT_ID/plan](https://atai.ink/project/PROJECT_ID/plan) |
| Watch build progress | [https://atai.ink/project/PROJECT_ID/progress](https://atai.ink/project/PROJECT_ID/progress) and [/tasks](https://atai.ink/project/PROJECT_ID/tasks) |
| Change the app after it is built | [https://atai.ink/project/PROJECT_ID/edit](https://atai.ink/project/PROJECT_ID/edit) |
| Publish / connect a domain / see deployments | [https://atai.ink/project/PROJECT_ID/hosting](https://atai.ink/project/PROJECT_ID/hosting) (or the Publish button in the Workspace) |
| Browse/edit my app's data | [https://atai.ink/project/PROJECT_ID/database](https://atai.ink/project/PROJECT_ID/database) |
| See source code / files | [https://atai.ink/project/PROJECT_ID/source](https://atai.ink/project/PROJECT_ID/source), [/tree](https://atai.ink/project/PROJECT_ID/tree), [/repo-code](https://atai.ink/project/PROJECT_ID/repo-code), [/readme](https://atai.ink/project/PROJECT_ID/readme) |
| Download my whole project | [https://atai.ink/api/projects/PROJECT_ID/export](https://atai.ink/api/projects/PROJECT_ID/export) ("Export snapshot" in the sidebar) |
| Manage environment variables / secrets | [https://atai.ink/project/PROJECT_ID/env](https://atai.ink/project/PROJECT_ID/env) |
| Monitor runtime health, keys, limits, models, requests, usage | [https://atai.ink/project/PROJECT_ID/runtime](https://atai.ink/project/PROJECT_ID/runtime) (+ `/health`, `/keys`, `/limits`, `/models`, `/requests`, `/usage`) |
| Market research / Studio / SEO / promote | [https://atai.ink/project/PROJECT_ID/market](https://atai.ink/project/PROJECT_ID/market), [/studio](https://atai.ink/project/PROJECT_ID/studio), [/market/seo](https://atai.ink/project/PROJECT_ID/market/seo), [/promote](https://atai.ink/project/PROJECT_ID/promote) |
| Ads, campaigns, competition | [https://atai.ink/project/PROJECT_ID/ads](https://atai.ink/project/PROJECT_ID/ads), [/campaigns](https://atai.ink/project/PROJECT_ID/campaigns), [/competition](https://atai.ink/project/PROJECT_ID/competition) |
| Business finances | [https://atai.ink/finances](https://atai.ink/finances) (all projects) or [/project/PROJECT_ID/finances](https://atai.ink/project/PROJECT_ID/finances) |
| Business lessons & paths | [https://atai.ink/lessons](https://atai.ink/lessons) (paths are listed here; each path opens at `/lessons/paths/SLUG`) |
| Founder guides, playbooks, templates | [https://atai.ink/resources](https://atai.ink/resources) |
| Invite friends and earn credits | [https://atai.ink/referrals](https://atai.ink/referrals) |
| Request a feature or vote | [https://atai.ink/feature-requests](https://atai.ink/feature-requests) |
| Discover / fork other people's businesses | [https://atai.ink/explore](https://atai.ink/explore), [https://atai.ink/public/ID](https://atai.ink/public/ID) |
| Ask the AI co-founder anything | Click **"Ask your AI co-founder"** in the logged-in header (a panel, not a URL) |
| Developer API keys / playground / usage | [https://atai.ink/developers/keys](https://atai.ink/developers/keys), [/developers/playground](https://atai.ink/developers/playground), [/developers/usage](https://atai.ink/developers/usage) |
| SDK & Runtime API reference | [https://atai.ink/sdk](https://atai.ink/sdk) |
| Standard vs Pro comparison | [https://atai.ink/modes-comparison](https://atai.ink/modes-comparison) |
| Read the short docs | [https://atai.ink/docs](https://atai.ink/docs) |
| Read THIS extended guide | [https://atai.ink/docs/onboarding](https://atai.ink/docs/onboarding) |
| Machine-readable docs for AI tools | [https://atai.ink/llms.txt](https://atai.ink/llms.txt), [https://atai.ink/llms-full.txt](https://atai.ink/llms-full.txt) |
| Report a problem to a human | [support@atai.ink](mailto:support@atai.ink), WhatsApp [+256761819885](tel:+256761819885) |

> ⚠️ **One important correction:** `https://atai.ink/billing` **has no page** — old bookmarks, search results and some external references still use it. The real billing page is **[https://atai.ink/settings/billing](https://atai.ink/settings/billing)**. `https://atai.ink/billing/top-up` correctly redirects there. See [Problem 10.3](#103-billing-link-does-not-open).

---

## Part 1 — START (detailed step-by-step)

## 1.1 Step 1 — Create your account

1. Open [https://atai.ink/register](https://atai.ink/register) (or click **Start my business** anywhere on the site).
2. Sign up with **email + password**, or use **Sign in with Google** (OAuth). The Google callback is `https://atai.ink/api/auth/google/callback` — you never type it manually.
3. If you already have an account, use [https://atai.ink/login](https://atai.ink/login). Forgot your password? [https://atai.ink/forgot-password](https://atai.ink/forgot-password) → follow the emailed link → [https://atai.ink/reset-password](https://atai.ink/reset-password).
4. Atai sends a verification email. Open [https://atai.ink/verify-email](https://atai.ink/verify-email) or click the link in the email.
5. **Verify your email before anything else.** The onboarding screen says it plainly: *"Verify your email to unlock Atai… Until you verify, your account stays locked and bonus credits won't apply."* The **500 welcome credits** are granted on email verification, not on signup.

**Authentication details worth knowing:** sessions are JWTs in an httpOnly cookie, server-side, roughly 30 days. Changing the platform's auth secret invalidates all sessions (you would simply log in again). Email changes are confirmed at [https://atai.ink/confirm-email-change](https://atai.ink/confirm-email-change). Account deletion is a soft delete that preserves billing history; request it in settings or by emailing [support@atai.ink](mailto:support@atai.ink).

## 1.2 Step 2 — The onboarding "first mission"

Right after signup, Atai runs a short guided conversation (about 30 seconds). It is a full-screen flow with a progress indicator ("Step X of Y"). In order, you will be asked:

1. **"What are you building?"** — one sentence is enough. Examples Atai suggests: *"An AI platform that helps small businesses manage their finances"*, *"A marketplace connecting local farmers directly with restaurants"*, *"I have a website but I want to turn it into a real product"*, *"I want to build something around this GitHub project"*.
2. **A context follow-up** — depends on the mode; e.g. for a website: *"What do you want this to become?"*; for GitHub: *"What are you trying to build or change?"*; plus an optional audience field (*"Who are you building this for?"*).
3. **"How did you find Atai?"**
4. **"What best describes you?"**
5. **"What does winning look like?"**
6. **"Who are you trying to reach?"**
7. **"How hard are you going?"**
8. **"What should Atai help with?"**
9. **"Choose how you want to start."** — the four starting-point modes: **Idea**, **Mirror**, **URL**, **GitHub**.
10. **"Verify your email to unlock Atai"** — with **Resend email**, **I've verified**, and a hint to check spam/promotions.

You can **Skip for now** on the optional beats. Your answers shape the first plan, so a specific sentence beats a vague one. If you skip everything, you can start later from [https://atai.ink/new](https://atai.ink/new).

After the mission, Atai creates your workspace via [https://atai.ink/start](https://atai.ink/start) (three statuses: *"Creating your Atai workspace"* → *"Bringing your idea into context"* → *"Ready to collaborate"*) and redirects you to:

**`https://atai.ink/project/PROJECT_ID/collaborate`**

If the workspace creation fails, the page shows **"We couldn't create your workspace yet."** with two buttons: **Try again** and **Open form** (which returns you to the relevant `/new/...` form with your input preserved).

## 1.3 Step 3 — Choose your starting point

Open [https://atai.ink/new](https://atai.ink/new) at any time. The page has a big composer at the top ("What would you like to build?") and three cards under **"Or start with"**:

| Starting point | URL | Best for |
|---|---|---|
| **An idea** — "Describe your idea" | [https://atai.ink/new/idea](https://atai.ink/new/idea) | You have a problem, vision, or business concept in plain words |
| **A website** — "Use a website" | [https://atai.ink/new/website](https://atai.ink/new/website) | You want to use a reference site to explore a business model or product experience (not to copy it) |
| **An existing codebase** — "Use a repository" (marked **Experimental**) | [https://atai.ink/new/github](https://atai.ink/new/github) | You have a GitHub repo to continue, improve, or extend |

The page also shows the four-step journey **Imagine → Plan → Build → Launch** and two reassurances: *"You review the plan before anything is built"* and *"Credits are used when the build begins."*

### Idea Mode — the Founder Form

Idea Mode uses a structured **Founder Form** rather than one free-text box, because structure produces a much more accurate plan:

| Field | Required | What to write |
|---|---|---|
| Business / product name | No | What you want to call it; you can name it later |
| **The problem you are solving** | **Yes** | The pain or gap your business addresses — this drives the whole plan |
| Your target audience | No | Freelancers, small businesses, students, restaurants… |
| **The solution** | **Yes** | How your product solves the problem, in plain language |
| Business model | No | SaaS subscription / One-time purchase / Marketplace or commission / Free with paid upgrades / Other |

> **Why the business model field matters:** it tells the AI whether to scaffold payment flows, subscription logic, marketplace commission handling, or free-tier upgrade gates. The more context you give, the better the plan.

Click **Generate app plan** → Atai takes you to Collaborate.

### Website Mode

1. Go to [https://atai.ink/new/website](https://atai.ink/new/website) (or the composer on [/new](https://atai.ink/new)).
2. Paste the website address. Atai normalizes the URL, maps the site, and picks the most important pages (pricing, features, product, about, docs/FAQ are weighted highest — random blog posts and UUID-looking paths are down-weighted).
3. Choose your analysis depth:
   - **Relevant Info** — analyzes the most important pages, understands the product, creates a custom plan. Best for most projects. Cheap and fast.
   - **Deep Crawl** — crawls the entire site (up to 50 pages, up to 15 minutes). Best when you need the whole site preserved. A dialog shows the cost before you confirm: **"Deep crawl for 500 credits"**.
4. Atai analyzes pages & navigation, design & layout, features & functionality, content & copy, and data patterns.
5. Review the plan, edit it, then build.

> If a site blocks crawlers (Netflix, banks, some JS-heavy sites), Atai automatically supplements the crawl with web searches and marks those results as coming from web search. If even that returns nothing, you will see a message that the site blocks automated analysis and the credits are refunded. Try a different URL.

### GitHub Mode

1. Go to [https://atai.ink/new/github](https://atai.ink/new/github).
2. Connect your GitHub account (from [Settings → Profile](https://atai.ink/settings/profile) → **Connected Services** → **Connect GitHub**, or directly in the project workspace via the **GitHub** button).
3. Choose a repository (public or private), and the branch (default `main`).
4. Atai reads the README and code files, analyzes the structure, generates a specification, and builds or enhances the application.
5. Two integration modes: **Push to GitHub (auto-push)** — pushes built code after each successful build, and **Build from repo (source mode)** — uses an existing repo as the input.
6. You can create a new repository from Atai, view push history and commit links, and disconnect at any time. Disconnecting stops future pushes but never deletes code already in GitHub.

## 1.4 Step 4 — Choose Standard or Pro (and understand the cost)

When creating a project you choose the **pipeline mode**. Compare them at [https://atai.ink/modes-comparison](https://atai.ink/modes-comparison).

| | **Atai Standard** (default) | **Atai Pro** (premium) |
|---|---|---|
| Processing | ~30–60 seconds | ~2–5 minutes |
| Pipeline | Single-pass specification | 7-stage quality pipeline |
| Scrape | 5 credits | 100 credits |
| Plan generation | 5 credits | 100 credits |
| Deep crawl | 500 credits | 1,000 credits |
| Build tiers | Simple 50,000 / Medium 75,000 / Complex 100,000 | ~100,000 / ~112,500 / ~133,333 |
| Best for | Prototypes and most applications | Complex apps, admin panels, analytics, payments |

**The 7 Pro stages:** 1 Understanding → 2 Research (finds missing features, security gaps, best practices) → 3 Planning (full specification) → 4 Critique (independent quality review) → 5 Repair (fixes critique findings) → 6 Validation (consistency check) → 7 Sanitization (cleanup & normalization). Research, critique, repair and validation are non-blocking: if a free AI model fails, the pipeline still produces output.

**Honest note about numbers:** all credit costs are **server-authoritative and admin-configurable**. The UI fetches them from `https://atai.ink/api/credit-costs`. The numbers above are current code defaults; the number shown in the app at the moment you click is the one that matters. Some older tables on the short [/docs](https://atai.ink/docs) page show legacy 25k/50k/75k build prices — treat the in-app figure and [/pricing](https://atai.ink/pricing) as authoritative. See [Part 8](#part-8-billing-credits-complete-reference).

## 1.5 Pre-flight checklist before you spend a credit

- [ ] Email verified, 500 welcome credits visible in the header credit meter
- [ ] You can see [https://atai.ink/dashboard](https://atai.ink/dashboard) without a redirect to login
- [ ] You have a one-sentence description of the problem and the solution (or a URL / repo)
- [ ] You know which mode you want (Standard for a first project is the sensible default)
- [ ] You have checked [https://atai.ink/pricing](https://atai.ink/pricing) and know what a build costs
- [ ] You understand: **analysis/planning credits are charged when the plan is generated; build credits are only reserved when you explicitly approve the build** on Collaborate

---

## Part 2 — PLAN (detailed step-by-step)

## 2.1 The project lifecycle (what every status means)

Every business has a state, persisted server-side. You will see these as plain-language labels in the dashboard and sidebar.

| State | Label you see | What it means / what to do |
|---|---|---|
| `created`, `pending_plan` | Getting started | Open the project or ask Atai |
| `analyzing` | Understanding | Atai is reading your website/idea. Deep crawls can take up to 15 minutes. Watch [progress](https://atai.ink/project/PROJECT_ID/progress) |
| `analysis_complete` | Ready to plan | Continue to the workspace |
| `analysis_failed` | **Understand needs attention** | Retry the Understand step from the workspace |
| `specification_ready`, `plan_ready` | **Plan ready — review before building** | Go to Collaborate, review & refine |
| `plan_failed` | **Plan needs attention** | Retry the Plan step from the workspace |
| `awaiting_build_confirmation` | Awaiting build confirmation | Click **Start building** on Collaborate |
| `building` | Building application | The build is running; a stage overlay shows progress |
| `build_complete`, `ready` | Ready / Build complete | App exists; publish or iterate |
| `build_failed` | Build failed | Retry build from the workspace — the plan stays editable |
| `deploying` | Deploying | Publishing to production |
| `deployed` | Deployed | Live |
| `deployment_failed` | Deployment failed | Republish from Hosting |

> **Important:** once the state is `building`, `deploying`, `ready`, `build_complete` or `deployment_failed`, **the plan becomes a read-only archive**. Editing it there no longer reaches the built app. All later changes go through the follow-up edit flow ([/edit](https://atai.ink/project/PROJECT_ID/edit)) or the instruction bar. `build_failed` deliberately keeps the plan editable because a retry re-sends the whole plan.

## 2.2 Step 1 — Open Collaborate

After analysis finishes, the project enters **Plan Ready**. A **Review plan** button appears in the workspace header. Click it, or go directly to:

**`https://atai.ink/project/PROJECT_ID/collaborate`**

The page is a split view:

- **Left (~60%) — Your plan**, written in plain business language: what is being built, who it is for, key features, how users will use the app, data the app manages, how users sign in, **Runtime & Integrations** (the Atai capabilities your app will use — AI, messaging, payments, and more), and your recorded project preferences.
- **Right (~40%) — AI Chat**: ask questions, request changes to features or flows, adjust the business model, add or remove functionality. The plan updates in real time.

**Collaborate costs** (defaults): **2 credits per chat message**, **10 credits per AI plan analysis run**, **8 credits per auto-completed section**. These are small, but they do add up — spend them on meaningful refinements.

**Runtime & Integrations is not just documentation.** When you describe a feature that needs AI, messaging, payments, search or maps, the AI writes it into this plan section and the build honors it: the generated app is wired to the official `@atai-group/sdk` with a project-scoped runtime API key (`ATAI_API_KEY`) provisioned automatically and injected into the app's secret store. Read the [SDK & Runtime API reference](https://atai.ink/sdk) for what your app can call.

## 2.3 Step 2 — Edit the plan

You can change anything before building:

- **Enable or disable features** — payments, admin panels, file uploads, etc.
- **Add or remove data types** — what information the app stores
- **Change the design direction** — colors, fonts, visual style
- **Modify user flows** — how users move through the app
- **Add custom instructions** — specific requirements or preferences

The full plan view is at [https://atai.ink/project/PROJECT_ID/plan](https://atai.ink/project/PROJECT_ID/plan). You can go back and forth as many times as you need. Atai updates the plan to reflect your changes.

**The plan contains:** Application type, purpose, features checklist, data model, user flows, design direction, and Runtime & Integrations.

## 2.4 Step 3 — Approve and start the build

On Collaborate, click **"Submit Plan & Start Building"** (the workspace may also show **"Start building"** when the state is `awaiting_build_confirmation`).

**The credit rule, precisely:**

- Analysis and planning credits are charged when the plan is generated.
- **No build credits are charged until you explicitly click Submit / Start Building.** Atai reserves the build cost at that moment using a reserve → execute → charge/refund pattern with idempotency keys, so a failed build refunds automatically and you can never be double-charged for one operation.
- A confirmation dialog shows the complexity tier and the credit cost before you commit.

---

## Part 3 — BUILD (detailed step-by-step)

## 3.1 What actually gets built

A complete working application, not a mockup:

- A full user interface with multiple screens and working navigation
- A backend that handles data and logic, plus an API layer connecting UI to backend
- A live database to store application data
- User accounts with sign-up and login
- Responsive design that works on phones and computers
- Deployment configuration ready to publish

Build time is usually 1–3 minutes depending on complexity; the analysis stage is 30–60 seconds (Standard) or 2–5 minutes (Pro).

## 3.2 Build cost tiers

Atai classifies your plan into a tier based on enabled features, data entities, integrations, core flows and backend requirements:

| Tier | Typical profile | Standard build | Pro (heavy) build |
|---|---|---|---|
| **Simple** | Straightforward apps, basic pages, minimal logic | 50,000 credits | ~100,000 credits |
| **Medium** | Multi-page apps with auth, data models, dashboards | 75,000 credits | ~112,500 credits |
| **Complex** | Many features, integrations, admin panels, payments | 100,000 credits | ~133,333 credits |

Follow-up agent edits are charged at the same tier cost as the initial build (50k / 75k / 100k). This is why it is worth getting the plan right *before* you build — every later "add a settings page" instruction costs a full tier build.

The live cost table is served from [https://atai.ink/api/credit-costs](https://atai.ink/api/credit-costs) and can be adjusted by operators at [/admin/billing/configuration](https://atai.ink/admin/billing/configuration) and [/admin/runtime/pricing](https://atai.ink/admin/runtime/pricing). **The number displayed in the confirmation dialog is the authoritative one.**

## 3.3 Monitor the build

1. Stay on the Workspace: `https://atai.ink/project/PROJECT_ID` — a **Build stage overlay** shows stages as they complete.
2. [https://atai.ink/project/PROJECT_ID/progress](https://atai.ink/project/PROJECT_ID/progress) — **Team progress**, the AI team's activity timeline.
3. [https://atai.ink/project/PROJECT_ID/tasks](https://atai.ink/project/PROJECT_ID/tasks) — task list.
4. The UI polls `GET /api/projects/PROJECT_ID/status` roughly every 2 seconds for live state and events. If it stops updating, hard-refresh.
5. Admins can inspect full pipeline execution logs at [/admin/planning-runs](https://atai.ink/admin/planning-runs) and project health at [/admin/infrastructure](https://atai.ink/admin/infrastructure).

## 3.4 When the build fails

Atai has several built-in recovery paths. From the Workspace:

- **Retry build** — re-sends the whole plan to the builder (`POST /api/projects/PROJECT_ID/retry`).
- **Recover** — recovers a build that died without reporting (`/api/projects/PROJECT_ID/recover`); Atai detects orphaned builds and offers recovery automatically.
- **Auto-complete** — finishes missing plan sections (`/api/projects/PROJECT_ID/auto-complete`).
- **Restart server** — `/api/projects/PROJECT_ID/server/restart`.
- **Analyze plan** — `/api/projects/PROJECT_ID/analyze-plan` for a fresh plan analysis.
- Ask the **AI co-founder** (header button) — it can propose and trigger actions.

If a build produced an empty or poor specification, the Pro pipeline's Research / Critique / Repair / Validation stages exist precisely to prevent that. Switching to Pro on a new project is the strongest quality lever. See [Problem 10.5](#105-analysis-plan-and-build-problems).

## 3.5 After a successful build — workspace tour

The Workspace at `https://atai.ink/project/PROJECT_ID` gives you:

- **Live preview** of the running app
- **Source code viewer** — browse the generated code
- **Instruction bar** — describe changes in plain language
- **Database manager** — view and manage records
- **Deployment controls** — Publish / Republish / deployment history
- **Build cost display** — current tier and cost

Example instructions that work well: *"Add a search bar to the dashboard"*, *"Change the color scheme to blue and white"*, *"Add a settings page where users can update their profile"*, *"Create a report page that shows monthly sales data"*, *"Add email notifications when a new order comes in"*. One instruction is capped at **12,000 characters**.

---

## Part 4 — RUN & LAUNCH (detailed step-by-step)

## 4.1 Publishing — the exact flow

**Critical concept: Building and publishing are two different, separately charged actions.** A built app is not live until you publish it. Publishing costs **500 credits** per production deployment.

1. Open [https://atai.ink/project/PROJECT_ID/hosting](https://atai.ink/project/PROJECT_ID/hosting) — or click **Publish** in the Workspace.
2. If the app has not been built yet, the Hosting page says: *"Nothing to host yet. Finish the plan and start the first build from the workspace."*
3. Once built, the **Publish Menu** appears. Click **Publish** → **"Publish to Production"**.
4. Choose one of two options:

   **Option A — Free Subdomain (recommended for your first launch)**
   - Address format: **`PROJECT_NAME.totalum-project.com`**
   - Instant deploy, no DNS configuration, HTTPS included, free forever
   - Click **Publish Now** (or **Republish** if already live)

   **Option B — Custom Domain**
   - Enter a hostname such as `app.yourdomain.com`
   - Atai deploys first (if not already deployed), then registers the domain
   - A **DNS instructions** screen lists the exact records to add at your domain provider, with copy buttons
   - Add those records at your registrar; propagation may take **up to 24 hours**; status updates automatically once validated
   - Removing a custom domain: use the remove action, confirm (the app stays on the free subdomain), and you can re-add later

5. Watch the **Deployments** list on the Hosting page for status (`success`, `deploying`, failed) and production URLs.

> Custom-domain and source-code-download features are plan-gated. The Free plan does **not** include "Use your own domain", "Download source code", "Sync with GitHub", or the built-in code editor — those start at Explorer / Starter. See [Part 8.2](#82-subscription-plans).

## 4.2 Database Manager — step by step

Every built app comes with a live database. No SQL, no code.

1. Open [https://atai.ink/project/PROJECT_ID/database](https://atai.ink/project/PROJECT_ID/database) (or click **Database** in the project sidebar).
2. You see all tables with field schemas, relations, and record counts.
3. Click a table → `https://atai.ink/project/PROJECT_ID/database/TABLE_NAME` → paginated record grid.
4. **View / filter / sort** by any field, either direction.
5. **Create** a record with the "new record" form — all field types supported.
6. **Edit** by clicking a row; changes save immediately to the live database.
7. **Delete** with a confirmation step.

**Field types shown with their own colour/icon:** `string`, `number`, `date`, `boolean`, `options`, `file`, `long-string`, `objectReference`. Schema View shows field names, types and relationships.

Backing APIs: `/api/projects/PROJECT_ID/database/tables`, `/records`, `/records/RECORD_ID`, `/records/RECORD_ID/link`, and `/database/query`.

Legal note: the [Database terms](https://atai.ink/database-terms) govern the database feature.

## 4.3 Environment & secrets

- [https://atai.ink/project/PROJECT_ID/env](https://atai.ink/project/PROJECT_ID/env) — Environment variables for the app.
- Secrets API: `/api/projects/PROJECT_ID/secrets` and `/secrets/SECRET_ID`.
- Atai automatically injects a project-scoped Runtime API key as `ATAI_API_KEY` when the plan includes Runtime capabilities. Never paste that key into public client-side code or commit it to a repository.

## 4.4 Source code, export and GitHub

| Action | Where |
|---|---|
| Browse source | [https://atai.ink/project/PROJECT_ID/source](https://atai.ink/project/PROJECT_ID/source) |
| File tree | [https://atai.ink/project/PROJECT_ID/tree](https://atai.ink/project/PROJECT_ID/tree) |
| Repo code | [https://atai.ink/project/PROJECT_ID/repo-code](https://atai.ink/project/PROJECT_ID/repo-code) |
| README | [https://atai.ink/project/PROJECT_ID/readme](https://atai.ink/project/PROJECT_ID/readme) |
| **Download whole project** | Sidebar **Export snapshot** → [https://atai.ink/api/projects/PROJECT_ID/export](https://atai.ink/api/projects/PROJECT_ID/export) |
| Versions / diff | `GET /api/projects/PROJECT_ID/versions` and `/version-diff` |
| Fork someone else's app | [https://atai.ink/explore](https://atai.ink/explore) → public project → fork |

Fork pricing (defaults): Simple 15,000 · Medium 45,000 · Complex 50,000 credits, with the original owner receiving a royalty (5,000 / 10,000 / 15,000).

**GitHub integration** (connect at [Settings → Profile](https://atai.ink/settings/profile) → Connected Services → **Connect GitHub**, or the project's **GitHub** button): auto-push after each successful build, build from an existing repo, version history, team collaboration, external deployment to Vercel/Netlify. You need a free GitHub account ([https://github.com/signup](https://github.com/signup)). Private repos are supported. Disconnecting stops future pushes but does not delete existing code or history.

## 4.5 Runtime — monitoring and keys

The Runtime section is the control center for the infrastructure your app consumes:

| Page | URL |
|---|---|
| Runtime overview | [https://atai.ink/project/PROJECT_ID/runtime](https://atai.ink/project/PROJECT_ID/runtime) |
| Health | [https://atai.ink/project/PROJECT_ID/runtime/health](https://atai.ink/project/PROJECT_ID/runtime/health) |
| API keys (create / rotate) | [https://atai.ink/project/PROJECT_ID/runtime/keys](https://atai.ink/project/PROJECT_ID/runtime/keys) |
| Limits | [https://atai.ink/project/PROJECT_ID/runtime/limits](https://atai.ink/project/PROJECT_ID/runtime/limits) |
| Models | [https://atai.ink/project/PROJECT_ID/runtime/models](https://atai.ink/project/PROJECT_ID/runtime/models) |
| Requests | [https://atai.ink/project/PROJECT_ID/runtime/requests](https://atai.ink/project/PROJECT_ID/runtime/requests) |
| Request detail | [https://atai.ink/project/PROJECT_ID/runtime/requests/REQUEST_ID](https://atai.ink/project/PROJECT_ID/runtime/requests/REQUEST_ID) |
| Usage | [https://atai.ink/project/PROJECT_ID/runtime/usage](https://atai.ink/project/PROJECT_ID/runtime/usage) |

Runtime API: `POST https://atai.ink/api/runtime/v1` with header `Authorization: Bearer $ATAI_API_KEY` and a JSON body `{ "capability": "...", "operation": "...", "input": { ... } }`. Health check: `GET https://atai.ink/api/runtime/v1/health`. Developer API keys live at [https://atai.ink/developers/keys](https://atai.ink/developers/keys) (rotate via `/api/runtime/keys/KEY_ID/rotate`).

---

## Part 5 — OPERATE & MANAGE (detailed step-by-step)

## 5.1 The daily command center

- [https://atai.ink/dashboard](https://atai.ink/dashboard) — **Home**: status of your active business, attention items, activity timeline, and the next recommended action for each state.
- [https://atai.ink/projects](https://atai.ink/projects) — **Businesses**: all projects with state, thumbnails, and quick links.
- [https://atai.ink/notifications](https://atai.ink/notifications) — notification inbox.
- [https://atai.ink/finances](https://atai.ink/finances) — "Your whole business in numbers: runtime API spend, attributed earnings, and estimates — across every project."
- [https://atai.ink/project/PROJECT_ID/finances](https://atai.ink/project/PROJECT_ID/finances) — same view scoped to one business.

The dashboard sidebar can be collapsed with the button at the bottom; on mobile use the hamburger menu. The header has a **Find a business** search box (top-level pages only) and a **Help** link to [/docs](https://atai.ink/docs).

## 5.2 The AI co-founder

Click **"Ask your AI co-founder"** in the logged-in header (or **"Ask Atai"** in the dashboard sidebar). It opens a panel — not a page — where you can chat, use voice input, and receive **action cards** including navigation actions that take you straight to the right page. It can call tools such as `get_growth_overview` and trigger project actions. The panel is rendered globally on the app header and dashboard shell, so it is available from almost any signed-in page.

Backend: `/api/cofounder` and `/api/cofounder/actions/ACTION_ID`. Chat messages are also available inside each project at [/collaborate](https://atai.ink/project/PROJECT_ID/collaborate) and via `/api/projects/PROJECT_ID/chats`.

## 5.3 Iterating on a live app

1. Go to [https://atai.ink/project/PROJECT_ID/edit](https://atai.ink/project/PROJECT_ID/edit) (**Edit app**) or use the Workspace instruction bar.
2. Write one clear instruction (max 12,000 characters). One change per instruction works better than a paragraph of mixed requests.
3. Confirm the credit cost (same tier as the initial build: 50k / 75k / 100k).
4. The agent implements it; watch the build overlay. The agent can be stopped mid-run via `/api/projects/PROJECT_ID/agent/stop`, and the full conversation is retrievable via `/agent/full-conversation`.
5. Review versions and diffs via `/api/projects/PROJECT_ID/versions` and `/version-diff`.

Other management controls: `/api/projects/PROJECT_ID/visibility` (private/public), `/api/projects/PROJECT_ID/settings`, `/api/projects/PROJECT_ID/like`, `/api/projects/PROJECT_ID/activity`, `/api/projects/PROJECT_ID/logs`, `/api/projects/PROJECT_ID/assets`, and `/api/projects/PROJECT_ID/analytics-consent`.

## 5.4 Account & settings — every page

| Page | URL | What you can do |
|---|---|---|
| Settings home | [https://atai.ink/settings](https://atai.ink/settings) | Name, email, auth provider, live credit balance, **+ Top Up**, **View history**, links to Profile / Security / Appearance, Feature switches, and (admins) admin links |
| Profile | [https://atai.ink/settings/profile](https://atai.ink/settings/profile) | Name, avatar, connected services (GitHub), account deletion |
| Security | [https://atai.ink/settings/security](https://atai.ink/settings/security) | Change password, active sessions, change email |
| **Billing** | **[https://atai.ink/settings/billing](https://atai.ink/settings/billing)** | Balance, plan, plans grid, credit packs, credit history, cancel subscription |
| Appearance | [https://atai.ink/settings/appearance](https://atai.ink/settings/appearance) | Full preview of the five themes |
| Feature switches | [https://atai.ink/settings/features](https://atai.ink/settings/features) | SEO visibility audits, Growth tasks, Campaign planning, Business lessons |
| Account (alias) | [https://atai.ink/account](https://atai.ink/account) | Redirects to `/settings/profile` — this is intentional |

**Themes (5):** System (default, follows your OS), Dark, Light, Light Blue, Glass (glassmorphism with backdrop blur). Change from the theme icon in the top bar — applies instantly, no reload. Saved to `atai:theme` in localStorage immediately and synced to your account when signed in, so it follows you across devices.

**Feature switches are OFF by default.** If a growth page looks empty, first check [https://atai.ink/settings/features](https://atai.ink/settings/features). Note that an operator-level kill switch can temporarily lock a switch; in that case the toggle is disabled and the API honestly refuses the change.

---

## Part 6 — GROW (detailed step-by-step)

## 6.1 The growth toolkit (project-level — this is where the real tools live)

| Tool | URL | What it does |
|---|---|---|
| Market & grow | [https://atai.ink/project/PROJECT_ID/market](https://atai.ink/project/PROJECT_ID/market) | Growth overview, market research, competitors, marketing playbook, action plan, launch kit, ads kit, competition snapshot |
| Market / SEO | [https://atai.ink/project/PROJECT_ID/market/seo](https://atai.ink/project/PROJECT_ID/market/seo) | SEO visibility audits (feature-switch gated) |
| Studio | [https://atai.ink/project/PROJECT_ID/studio](https://atai.ink/project/PROJECT_ID/studio) | Content studio: brand, calendar, library, refine, variations, generated visuals |
| Promote | [https://atai.ink/project/PROJECT_ID/promote](https://atai.ink/project/PROJECT_ID/promote) | Promote wizard — a **request for review** for Atai to promote your business through its real channels |
| Ads & Growth | [https://atai.ink/project/PROJECT_ID/ads](https://atai.ink/project/PROJECT_ID/ads) | Ad strategy, ad requests, campaign analytics |
| Campaigns | [https://atai.ink/project/PROJECT_ID/campaigns](https://atai.ink/project/PROJECT_ID/campaigns) | Campaign planning and recorded results (feature-switch gated) |
| Competition | [https://atai.ink/project/PROJECT_ID/competition](https://atai.ink/project/PROJECT_ID/competition) | Competitor research |
| Intelligence | [https://atai.ink/project/PROJECT_ID/intelligence](https://atai.ink/project/PROJECT_ID/intelligence) | Application intelligence |
| Business lessons | [https://atai.ink/project/PROJECT_ID/lessons](https://atai.ink/project/PROJECT_ID/lessons) | Lessons matched to your project stage |
| Resources | [https://atai.ink/project/PROJECT_ID/resources](https://atai.ink/project/PROJECT_ID/resources) | Project-scoped resources |
| Business finances | [https://atai.ink/project/PROJECT_ID/finances](https://atai.ink/project/PROJECT_ID/finances) | Revenue, spend, estimates for this business |

Behind these: `/api/projects/PROJECT_ID/resources/market-research`, `/competitors`, `/marketing-playbook`, `/action-plan`, `/market/launch-kit`, `/market/ads-kit`, `/market/competition-snapshot`, `/market/studio`, `/seo-audits`, `/content-studio`, `/generate-visual`, `/studio/brand`, `/studio/calendar`, `/studio/library`, `/studio/refine`, `/studio/variations`, `/campaigns`, `/ads/strategy`, `/ads/requests`, `/economics`.

> Growth features are deliberately opt-in: **SEO visibility audits, Growth tasks, Campaign planning, Business lessons** each have a switch at [https://atai.ink/settings/features](https://atai.ink/settings/features). If a page shows a "Coming soon" placeholder, check the switch first. Some **top-level** pages — `/market`, `/competition`, `/hosting` — are genuinely placeholder/coming-soon pages; use the **project-level** equivalents listed above instead.

## 6.2 Learning, community and discovery

| Resource | URL | Notes |
|---|---|---|
| Resource library | [https://atai.ink/resources](https://atai.ink/resources) | Guides, playbooks, tutorials, roadmaps, templates, documents, images, videos |
| Categories | [https://atai.ink/resources/start](https://atai.ink/resources/start), [/build](https://atai.ink/resources/build), [/launch](https://atai.ink/resources/launch), [/grow](https://atai.ink/resources/grow), [/ai](https://atai.ink/resources/ai), [/atai](https://atai.ink/resources/atai), [/templates](https://atai.ink/resources/templates), [/glossary](https://atai.ink/resources/glossary) | Eight categories: Start, Build, Launch, Grow, AI, Atai, Templates, Glossary |
| Individual resource | [https://atai.ink/resources/CATEGORY/SLUG](https://atai.ink/resources/CATEGORY/SLUG) | Full article / video / download |
| Lessons | [https://atai.ink/lessons](https://atai.ink/lessons) | Stage-based business lessons (feature-switch gated) |
| Learning paths | Listed on [https://atai.ink/lessons](https://atai.ink/lessons); each path opens at `https://atai.ink/lessons/paths/SLUG` | Curated paths with progress (there is no `/lessons/paths` index page — open one from the Lessons library) |
| Lesson detail | [https://atai.ink/lessons/SLUG](https://atai.ink/lessons/SLUG) | Full lesson |
| Explore | [https://atai.ink/explore](https://atai.ink/explore) | Discover public businesses; fork one to start faster |
| Public business page | [https://atai.ink/public/ID](https://atai.ink/public/ID) | Shareable public profile of a business |
| Refer & Earn | [https://atai.ink/referrals](https://atai.ink/referrals) | Your referral link and stats; **500 credits** for a verified referral, **1,500** milestone reward |
| Feature requests | [https://atai.ink/feature-requests](https://atai.ink/feature-requests) | Submit and vote on roadmap items |
| WhatsApp community | [https://chat.whatsapp.com/CB3zVz7UnsQLfDjjk04gt1](https://chat.whatsapp.com/CB3zVz7UnsQLfDjjk04gt1) | Monthly token drops, discount codes, competitions |
| YouTube | [https://www.youtube.com/@mirrorsiteai](https://www.youtube.com/@mirrorsiteai) | Video walkthroughs |

---

## Part 7 — SCALE (detailed step-by-step)

## 7.1 The Runtime control center

Once your app has real users, use the Runtime pages in [Part 4.5](#45-runtime-monitoring-and-keys) plus:

- **Keys** — create project-scoped keys and **rotate** them at [/runtime/keys](https://atai.ink/project/PROJECT_ID/runtime/keys) or `/api/runtime/keys/KEY_ID/rotate`. Rotate immediately if a key leaks.
- **Limits** — set usage caps at [/runtime/limits](https://atai.ink/project/PROJECT_ID/runtime/limits) to control spend.
- **Usage** — meter and export consumption at [/runtime/usage](https://atai.ink/project/PROJECT_ID/runtime/usage) (`/api/projects/PROJECT_ID/runtime/usage/export`).
- **Requests** — inspect individual calls and errors.
- **Health** — `GET https://atai.ink/api/runtime/v1/health`.
- **Models** — see which AI models back your capabilities.

## 7.2 Developer portal & SDK

| Page | URL |
|---|---|
| Developer portal | [https://atai.ink/developers](https://atai.ink/developers) |
| API keys | [https://atai.ink/developers/keys](https://atai.ink/developers/keys) |
| Playground | [https://atai.ink/developers/playground](https://atai.ink/developers/playground) |
| Usage & health | [https://atai.ink/developers/usage](https://atai.ink/developers/usage) |
| SDK & Runtime API reference | [https://atai.ink/sdk](https://atai.ink/sdk) |
| Cal.com console (admins only) | [https://atai.ink/developers/calcom](https://atai.ink/developers/calcom) |

Install the SDK with `npm install @atai-group/sdk`, set `ATAI_API_KEY` (keys look like `atai_proj_...` / `atai_<environment>_<secret>`), and call `https://atai.ink/api/runtime/v1`. **Generated Atai apps do not need manual setup** — the key is provisioned and injected automatically at build time. Non-generated apps obtain a key from the developer portal.

## 7.3 Upgrading your plan

1. Check current balance and plan at [https://atai.ink/settings/billing](https://atai.ink/settings/billing).
2. Compare plans at [https://atai.ink/pricing](https://atai.ink/pricing).
3. Choose a subscription plan or a permanent credit pack; checkout goes through **Dodo Payments**.
4. You are returned to `/settings/billing` with the subscription synced. If credits do not appear, see [Problem 10.4](#104-credits-payments).

Higher tiers unlock: built-in code editor, AI code fixes, visual editing, source download, GitHub sync, custom domains, priority builds, direct support.

## 7.4 Admin panel (only if your account is an admin)

Admins see an extra **Admin panel** entry in the avatar menu → [https://atai.ink/admin](https://atai.ink/admin). Useful sections: [/admin/users](https://atai.ink/admin/users), [/admin/billing](https://atai.ink/admin/billing), [/admin/billing/configuration](https://atai.ink/admin/billing/configuration), [/admin/billing/plans](https://atai.ink/admin/billing/plans), [/admin/billing/credit-packs](https://atai.ink/admin/billing/credit-packs), [/admin/billing/subscriptions](https://atai.ink/admin/billing/subscriptions), [/admin/billing/webhooks](https://atai.ink/admin/billing/webhooks), [/admin/billing/reconciliation](https://atai.ink/admin/billing/reconciliation), [/admin/ledger](https://atai.ink/admin/ledger), [/admin/transactions](https://atai.ink/admin/transactions), [/admin/payments](https://atai.ink/admin/payments), [/admin/planning-runs](https://atai.ink/admin/planning-runs), [/admin/infrastructure](https://atai.ink/admin/infrastructure), [/admin/runtime/pricing](https://atai.ink/admin/runtime/pricing), [/admin/feature-requests](https://atai.ink/admin/feature-requests), [/admin/feedback](https://atai.ink/admin/feedback), [/admin/referrals](https://atai.ink/admin/referrals), [/admin/lessons](https://atai.ink/admin/lessons), [/admin/resources](https://atai.ink/admin/resources), [/admin/ads](https://atai.ink/admin/ads), [/admin/cancellations](https://atai.ink/admin/cancellations), [/admin/tools](https://atai.ink/admin/tools).

Admins can grant/deduct credits, reset stuck project states, inspect planning runs, and reconcile payments — useful if you are running Atai for a team.

---

## Part 8 — BILLING & CREDITS (complete reference)

## 8.1 Where the billing page actually is

> ### 🔑 **The billing page is [https://atai.ink/settings/billing](https://atai.ink/settings/billing).**

Reach it in four ways:

1. Click your **avatar → Settings → + Top Up / View history** ([https://atai.ink/settings](https://atai.ink/settings)).
2. Click the **credit meter** in the logged-in header (it shows your live balance).
3. Go directly to [https://atai.ink/settings/billing](https://atai.ink/settings/billing).
4. From the dashboard command center's billing link.

**On the page you will find:** a **Credit Balance** card (available credits and your active plan's monthly grant), **How Credits Work**, **Subscription Plans** (with checkout and plan-change dialogs), **Buy Permanent Credits**, and **Credit History** (a table of every transaction with amounts). A **Cancel subscription** button is available on your active plan, with a short cancellation-feedback flow.

**Related URLs:**

| Purpose | URL |
|---|---|
| Plans & prices (public) | [https://atai.ink/pricing](https://atai.ink/pricing) |
| Mode cost comparison | [https://atai.ink/modes-comparison](https://atai.ink/modes-comparison) |
| Old top-up page | [https://atai.ink/billing/top-up](https://atai.ink/billing/top-up) → **redirects** to `/settings/billing` (Mobile Money / MTN / Airtel top-ups are discontinued; all payments use Dodo Payments) |
| `https://atai.ink/billing` | **No page exists** — do not use it |
| Checkout API | `/api/billing/checkout` |
| Billing overview API | `/api/billing/overview` |
| Sync after checkout | `/api/billing/sync` |
| Cancel subscription | `/api/billing/subscription/cancel` (+ `/cancel-feedback`) |
| Upgrade options | `/api/billing/upgrade-options` |
| Payment webhook (Dodo → Atai) | `https://atai.ink/api/billing/webhook` |
| Refund policy | [https://atai.ink/refund-policy](https://atai.ink/refund-policy) |

## 8.2 Subscription plans

| Plan | Price | Monthly credits | Highlights |
|---|---|---|---|
| **Free** | $0 | 0 (one-time **500 welcome credits** on email verification) | Workspace, all generation models, advanced site analysis, limited built-in database & infrastructure, community support. **No** monthly grants, code editor, source download, GitHub sync, custom domain, priority builds, direct support |
| **Explorer** | $12/mo | 50,000 | Everything in Free + built-in code editor, AI code fixes, up to 30 parallel AI agents, full application builds, deployment system, database management, limited team support |
| **Starter** | $79/mo | 300,000 | Everything in Explorer + edit code in editor or visually, **download source code**, **GitHub sync**, **use your own domain**, full multi-section editing, standard team support |
| **Business** *(popular)* | $139/mo | 600,000 | Everything in Starter + priority builds, team support |
| **Professional** | $219/mo | 1,400,000 | Everything in Business + direct support, full team support |
| **Enterprise** | $499/mo | 5,000,000+ (custom) | Custom volume, dedicated infrastructure, SLA-backed uptime, white-glove onboarding, dedicated account manager, custom integrations |

Currency is **USD**. Billing provider is **Dodo Payments**.

## 8.3 Permanent credit packs (never expire)

| Credits | Price |
|---|---|
| 200,000 | $59 |
| 500,000 *(popular)* | $119 |
| 1,000,000 | $219 |
| 5,000,000 | $859 |
| 15,000,000 | $2,499 |

## 8.4 How credits actually work

- Two types: **subscription** (monthly, expire) and **permanent** (never expire).
- Consumption order: **subscription credits first, then permanent** — so your monthly allowance is used before your purchased stash.
- Every operation uses **reserve → execute → charge/refund** with atomic reservation and idempotency keys. No race conditions, no double charges, automatic refund on failure.
- Full audit trail in the credit ledger; every entry has a type such as `signup_bonus`, `subscription_grant`, `build_reservation`, `build_refund`, `credit_purchase`, `fork_purchase`, `ai_collaboration`, `runtime_usage`.
- Free credits: **500 welcome** (on email verification), **500 referral verification reward**, **1,500 referral milestone reward**.
- If your balance is too low, a **Credit Gate dialog** appears with tailored upgrade options instead of a dead end.

## 8.5 Full cost table (current code defaults)

| Action | Standard (legacy) | Pro (heavy) |
|---|---|---|
| Website analysis / scrape | 5 credits | 100 credits |
| Plan generation | 5 credits | 100 credits |
| Deep crawl | 500 credits | 1,000 credits |
| Simple build | 50,000 credits | ~100,000 credits |
| Medium build | 75,000 credits | ~112,500 credits |
| Complex build | 100,000 credits | ~133,333 credits |
| Follow-up agent edit | 50,000 / 75,000 / 100,000 by tier | same as initial |
| **Publish / deploy** | **500 credits** | **500 credits** |
| Collaborate chat message | 2 credits | 2 credits |
| AI plan analysis run | 10 credits | 10 credits |
| Auto-complete one plan section | 8 credits | 8 credits |
| Fork (simple / medium / complex) | 15,000 / 45,000 / 50,000 | — |

Internal conversion used for economics: **1,000 Atai Credits = 1 Baseline Cost Unit**. All numbers are admin-configurable; `GET https://atai.ink/api/credit-costs` is the source of truth and [/pricing](https://atai.ink/pricing) renders from it.

## 8.6 Cancelling, refunds and payment problems

- Cancel from [https://atai.ink/settings/billing](https://atai.ink/settings/billing) → your active plan → **Cancel subscription**, then complete the short feedback. Cancellation tracking is visible to admins at [/admin/cancellations](https://atai.ink/admin/cancellations).
- Refund terms: [https://atai.ink/refund-policy](https://atai.ink/refund-policy). For any payment issue, email [support@atai.ink](mailto:support@atai.ink).
- Payment succeeded but no credits → see [Problem 10.4](#104-credits-payments).

---

## Part 9 — Complete URL directory

All public pages below are prefixed `https://atai.ink`. Replace `PROJECT_ID`, `TABLE_NAME`, `REQUEST_ID`, `ID`, `SLUG`, `CATEGORY`, `KEY_ID` with real values.

## 9.1 Public / marketing / legal

| URL | Purpose |
|---|---|
| `/` | Home |
| `/about` | Mission, team, AI teams |
| `/founder` | Founder's story |
| `/pricing` | Plans, credit packs, build costs |
| `/modes-comparison` | Standard vs Pro |
| `/docs` | Short documentation (searchable, with feedback on each section) |
| `/docs/onboarding` | **This extended onboarding guide** |
| `/resources` | Founder library |
| `/resources/CATEGORY` | Category (start, build, launch, grow, ai, atai, templates, glossary) |
| `/resources/CATEGORY/SLUG` | Individual guide / video / download |
| `/lessons`, `/lessons/SLUG`, `/lessons/paths/SLUG` | Business lessons, lesson detail, and individual learning paths (no `/lessons/paths` index page) |
| `/sdk` | SDK & Runtime API reference |
| `/developers`, `/developers/keys`, `/developers/playground`, `/developers/usage`, `/developers/calcom` | Developer portal |
| `/explore`, `/public/ID` | Discover public businesses |
| `/feature-requests`, `/feature-requests/ID` | Roadmap board and voting |
| `/privacy`, `/terms`, `/refund-policy`, `/database-terms` | Legal |
| `/llms.txt`, `/llms-full.txt` | Machine-readable docs for AI assistants |
| `/sitemap.xml`, `/seo/sitemap.xml`, `/resources/sitemap.xml`, `/robots.txt` | SEO / crawlers |

## 9.2 Authentication

`/register` · `/login` · `/verify-email` · `/forgot-password` · `/reset-password` · `/confirm-email-change` · `/start` (workspace creation) · `/new` · `/new/idea` · `/new/website` · `/new/github`

API: `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/verify-email`, `/api/auth/resend-verification`, `/api/auth/forgot-password`, `/api/auth/reset-password`, `/api/auth/change-email`, `/api/auth/confirm-email-change`, `/api/auth/change-password`, `/api/auth/sessions`, `/api/auth/onboarding`, `/api/auth/google`, `/api/auth/google/callback`, `/api/auth/github`, `/api/auth/github/callback`, `/api/me`, `/api/me/profile`, `/api/me/avatar`

## 9.3 Signed-in top level

`/dashboard` · `/projects` · `/workspace` (→ redirects to `/dashboard`, kept for old bookmarks) · `/notifications` · `/finances` · `/referrals` · `/settings` · `/settings/profile` · `/settings/security` · `/settings/billing` · `/settings/appearance` · `/settings/features` · `/account` (→ `/settings/profile`) · `/billing/top-up` (→ `/settings/billing`) · `/ads` · `/market` (coming-soon placeholder) · `/competition` (coming-soon placeholder) · `/hosting` (coming-soon placeholder)

> `/seo` is **not** a page — only `/seo/sitemap.xml` exists there. For SEO work use the project-level [Market / SEO tool](https://atai.ink/project/PROJECT_ID/market/seo).

## 9.4 One business (all project pages)

`/project/PROJECT_ID` (Workspace) · `/progress` · `/collaborate` · `/plan` · `/edit` · `/tasks` · `/source` · `/tree` · `/repo-code` · `/readme` · `/database` · `/database/TABLE_NAME` · `/env` · `/hosting` · `/runtime` · `/runtime/health` · `/runtime/keys` · `/runtime/limits` · `/runtime/models` · `/runtime/requests` · `/runtime/requests/REQUEST_ID` · `/runtime/usage` · `/studio` · `/market` · `/market/seo` · `/promote` · `/ads` · `/campaigns` · `/competition` · `/finances` · `/intelligence` · `/lessons` · `/resources`

Key project APIs: `/api/projects`, `/api/projects/ID`, `/api/projects/ID/status`, `/api/projects/ID/build`, `/api/projects/ID/deploy`, `/api/projects/ID/domain`, `/api/projects/ID/launch`, `/api/projects/ID/retry`, `/api/projects/ID/recover`, `/api/projects/ID/auto-complete`, `/api/projects/ID/agent`, `/api/projects/ID/agent/stop`, `/api/projects/ID/chats`, `/api/projects/ID/export`, `/api/projects/ID/fork`, `/api/projects/ID/versions`, `/api/projects/ID/version-diff`, `/api/projects/ID/visibility`, `/api/projects/ID/settings`, `/api/projects/ID/secrets`, `/api/projects/ID/logs`, `/api/projects/ID/analytics-consent`, `/api/projects/ID/runtime/*`

## 9.5 Admin

`/admin` · `/admin/users` · `/admin/billing` (+ `/audit`, `/configuration`, `/credit-packs`, `/plans`, `/reconciliation`, `/subscriptions`, `/user-billing`, `/webhooks`) · `/admin/payments` · `/admin/transactions` · `/admin/ledger` · `/admin/cancellations` · `/admin/referrals` · `/admin/feedback` · `/admin/feature-requests` · `/admin/planning-runs` · `/admin/infrastructure` · `/admin/runtime` · `/admin/runtime/pricing` · `/admin/learning` · `/admin/lessons` · `/admin/resources` · `/admin/ads` · `/admin/tools` · `/admin/dodo-products`

---

## Part 10 — Common problems and how to solve them

Each entry follows **Symptom → Cause → Fix (with the exact URL to click)**.

## 10.1 Account & sign-in

**(a) "Invalid credentials" / cannot log in**
- *Cause:* wrong password; email not verified; or the account was soft-deleted.
- *Fix:* reset at [https://atai.ink/forgot-password](https://atai.ink/forgot-password) → open the emailed link → [https://atai.ink/reset-password](https://atai.ink/reset-password). If you never verified, see (b). If you believe the account was removed, email [support@atai.ink](mailto:support@atai.ink).
- *Alternative:* use **Sign in with Google** at [https://atai.ink/login](https://atai.ink/login).

**(b) "Verify your email to unlock Atai" — account feels locked, no welcome credits**
- *Cause:* the 500 welcome credits are granted **on email verification**, not on signup.
- *Fix:* open the verification link → [https://atai.ink/verify-email](https://atai.ink/verify-email). A persistent **Verify email banner** appears in the logged-in header with a **Resend email** button (calls `/api/auth/resend-verification`) and an **I've verified** button. Check spam / promotions. Then hard-refresh.

**(c) Verification email never arrives**
- *Fix:* click **Resend email** in the banner, wait a minute, check spam and promotions folders (the onboarding screen explicitly suggests this). Then [https://atai.ink/verify-email](https://atai.ink/verify-email). Still missing → [support@atai.ink](mailto:support@atai.ink). Admin-side causes include an expired 24-hour token or SMTP misconfiguration.

**(d) "Session expired" / logged out repeatedly**
- *Cause:* sessions last about 30 days; rotating the platform auth secret invalidates all sessions.
- *Fix:* simply sign in again at [https://atai.ink/login](https://atai.ink/login). Manage active sessions at [https://atai.ink/settings/security](https://atai.ink/settings/security).

**(e) Google OAuth shows `redirect_uri_mismatch` or `access_denied`**
- *Cause:* server-side OAuth configuration (registered redirect URI, or the Google app in "Testing" mode without your email in test users).
- *Fix:* use email + password at [https://atai.ink/register](https://atai.ink/register) as a workaround and report it to [support@atai.ink](mailto:support@atai.ink) with the exact error. The correct production callback is `https://atai.ink/api/auth/google/callback`.

**(f) "Something went wrong" with no detail**
- *Fix:* open browser DevTools → **Network** tab → find the failed request and read its response body; note the timestamp; email it to [support@atai.ink](mailto:support@atai.ink). Admins can correlate with server logs.

## 10.2 Navigation surprises (not bugs)

**(a) "Where is the billing page?"** → **[https://atai.ink/settings/billing](https://atai.ink/settings/billing)**. See [Part 8.1](#81-where-the-billing-page-actually-is).

**(b) `/account` opens `/settings/profile`** — intentional redirect, not an error. Same for `/billing/top-up` → `/settings/billing`.

**(c) A page says "Coming soon"** — the top-level `/market`, `/competition`, `/hosting` are placeholder pages; use the **project-level** equivalents in [Part 6.1](#61-the-growth-toolkit-project-level-this-is-where-the-real-tools-live). Also check [https://atai.ink/settings/features](https://atai.ink/settings/features) — SEO audits, growth tasks, campaigns and lessons are opt-in and gated. If a switch is disabled, an operator kill switch is temporarily in effect; you cannot override it.

**(d) A sidebar item has a "Soon" badge** — by design, that feature is announced but not yet enabled. Don't wait on it; use the equivalent project tool that is live.

## 10.3 Billing link does not open

- *Symptom:* an old bookmark, saved link, search result, or third-party page pointing to `https://atai.ink/billing` leads nowhere or to a 404.
- *Cause:* `/billing` has no page in this build. The correct address is `/settings/billing`. (The short docs page's own Billing links now point to the correct place; older external links and bookmarks may not.)
- *Fix:* type [https://atai.ink/settings/billing](https://atai.ink/settings/billing) directly, or reach it via **avatar → Settings → + Top Up**, or click the header credit meter. `https://atai.ink/billing/top-up` correctly redirects there.

## 10.4 Credits & payments

**(a) "Not enough credits" / "Insufficient credits" / Credit Gate dialog appears**
- *Cause:* balance below the operation cost — most commonly because a build costs 50,000–100,000 credits while the Free plan grants only 500.
- *Fix:* check the balance at [https://atai.ink/settings/billing](https://atai.ink/settings/billing) → **Buy Permanent Credits** or choose a subscription. Compare options at [https://atai.ink/pricing](https://atai.ink/pricing). Earn free credits at [https://atai.ink/referrals](https://atai.ink/referrals). Use **Standard** instead of **Pro** for a first project, and refine the plan *before* building (edits after build cost a full build tier).

**(b) Credits deducted but the operation failed**
- *Cause:* the automatic refund path did not execute (rare).
- *Fix:* check **Credit History** at [https://atai.ink/settings/billing](https://atai.ink/settings/billing). If a `build_reservation` has no matching `build_refund`, contact [support@atai.ink](mailto:support@atai.ink) with the project ID and timestamp; an admin can grant compensating credits from [/admin/users](https://atai.ink/admin/users) after checking [/admin/ledger](https://atai.ink/admin/ledger).

**(c) Payment succeeded but no credits appeared**
- *Cause:* the Dodo webhook (`https://atai.ink/api/billing/webhook`) was not received or failed processing, or the UI is showing a cached balance.
- *Fix (in order):* ① hard-refresh with **Ctrl+Shift+R**; ② return from checkout via the normal flow so `/api/billing/sync` runs with the `subscription_id`; ③ check **Credit History** at [https://atai.ink/settings/billing](https://atai.ink/settings/billing); ④ email [support@atai.ink](mailto:support@atai.ink) with the receipt. Admins inspect [/admin/billing/webhooks](https://atai.ink/admin/billing/webhooks) and can grant credits manually at [/admin/users](https://atai.ink/admin/users).

**(d) UI shows credits but the build says insufficient**
- *Cause:* subscription credits expired, or the cached `users.credits` is out of sync with the ledger.
- *Fix:* hard-refresh; check the history at [https://atai.ink/settings/billing](https://atai.ink/settings/billing); contact support. Admins compare `creditBuckets` / `expiresAt` with the ledger at [/admin/billing/reconciliation](https://atai.ink/admin/billing/reconciliation).

**(e) Credits not updating after purchase**
- *Fix:* hard refresh (Ctrl+Shift+R). If still wrong, use [https://atai.ink/settings/billing](https://atai.ink/settings/billing) and then contact support.

**(f) Need to cancel or change plan**
- *Fix:* [https://atai.ink/settings/billing](https://atai.ink/settings/billing) → Subscription Plans → change or **Cancel subscription** (with feedback). Terms: [https://atai.ink/refund-policy](https://atai.ink/refund-policy).

## 10.5 Analysis, plan and build problems

**(a) Project stuck on "Analyzing website" forever**
- *Cause:* a Deep Crawl legitimately takes **up to 15 minutes**; or the status polling stopped; or an unhandled exception after the crawl.
- *Fix:* ① wait (deep crawls are slow by design); ② hard-refresh the page; ③ open [https://atai.ink/project/PROJECT_ID/progress](https://atai.ink/project/PROJECT_ID/progress) to see the timeline; ④ if the state is `analysis_failed` ("Understand needs attention"), use **Retry understanding** from the Workspace; ⑤ admins can reset state at [/admin/infrastructure](https://atai.ink/admin/infrastructure).

**(b) "This website blocks automated analysis. Try a different website."**
- *Cause:* the site returns 0 pages to crawlers and the automatic web-search supplement also returned nothing. Credits are refunded.
- *Fix:* use a different, publicly accessible URL, or start from an idea at [https://atai.ink/new/idea](https://atai.ink/new/idea).

**(c) Smart crawl analyzed the wrong / irrelevant pages**
- *Cause:* page scoring picked low-value pages.
- *Fix:* switch to **Deep Crawl**, or start from Idea Mode and describe the product yourself. The scoring intentionally favours `/pricing`, `/features`, `/product`, `/about`, `/docs`, `/faq` over blog posts.

**(d) "Plan needs attention" / "Understand needs attention"**
- *Fix:* open `https://atai.ink/project/PROJECT_ID` and use the **Retry planning** / **Retry understanding** action. These stages are designed to be recoverable and the pipeline is built to always produce output.

**(e) Build failed or stuck on "Building"**
- *Fix:* ① Workspace → **Retry build** (the plan stays editable while `build_failed`); ② use **Recover** for an orphaned build; ③ **Auto-complete** missing plan sections; ④ **Restart server**; ⑤ open the **Build stage overlay** to see the failing stage; ⑥ ask the AI co-founder from the header; ⑦ if a spec looks empty or garbage, create a new project in **Pro** mode so Research/Critique/Repair/Validation run. Admins inspect [/admin/planning-runs](https://atai.ink/admin/planning-runs).

**(f) AI model rate limit / quota errors ("RESOURCE_EXHAUSTED", 429)**
- *Cause:* upstream AI provider rate limits, often on free-tier models.
- *Fix:* wait a few minutes and retry. Atai's pipeline has per-stage fallbacks and circuit breakers; non-blocking stages (Research, Critique, Validation) log a warning and continue — **those log lines are normal, not failures**.

**(g) Plan is read-only after build**
- *Cause:* by design, `PLAN_LOCKED_STATES` makes the plan an archive once the app exists.
- *Fix:* make changes through [https://atai.ink/project/PROJECT_ID/edit](https://atai.ink/project/PROJECT_ID/edit) or the instruction bar, not the plan page.

**(h) Follow-up instruction rejected as too long**
- *Cause:* one instruction is capped at **12,000 characters**.
- *Fix:* split it into several focused instructions.

## 10.6 Publishing & domains

**(a) "Nothing to host yet" on the Hosting page**
- *Cause:* the app has not been built. Building and hosting are separate steps.
- *Fix:* finish the plan and start the first build from the Workspace, then return to [https://atai.ink/project/PROJECT_ID/hosting](https://atai.ink/project/PROJECT_ID/hosting).

**(b) I built the app but nobody can visit it**
- *Cause:* you have not published yet.
- *Fix:* click **Publish** → **Publish Now** (costs 500 credits). Your free address is `PROJECT_NAME.totalum-project.com`.

**(c) Custom domain not resolving**
- *Fix:* re-open [https://atai.ink/project/PROJECT_ID/hosting](https://atai.ink/project/PROJECT_ID/hosting) → custom domain → copy the exact DNS records shown and add them at your registrar. Propagation can take **up to 24 hours**. Status updates automatically. If you misconfigured it, remove the domain (confirm the dialog) and re-add — the app stays reachable on the free subdomain meanwhile. Also confirm your plan includes **Use your own domain** (Starter and above).

**(d) Deployment failed**
- *Fix:* check the **Deployments** list on the Hosting page, then **Republish**. Building succeeded — only the deployment step needs repeating.

## 10.7 Database, source, GitHub, runtime

**(a) Database Manager shows no tables / is empty**
- *Cause:* the app has not been built yet, or the plan had no data entities.
- *Fix:* build first; then [https://atai.ink/project/PROJECT_ID/database](https://atai.ink/project/PROJECT_ID/database). To add data types, refine the plan *before* building, or use a follow-up edit.

**(b) Accidentally deleted a record**
- *Fix:* deletions have a confirmation step but no self-service undo. Recreate the record from the grid (Create Records), or restore from an **Export snapshot** at [https://atai.ink/api/projects/PROJECT_ID/export](https://atai.ink/api/projects/PROJECT_ID/export). Contact [support@atai.ink](mailto:support@atai.ink) if it is critical.

**(c) Can't download source / can't connect a domain / no code editor**
- *Cause:* these are **plan-gated**. The Free plan excludes the built-in code editor, source download, GitHub sync and custom domains.
- *Fix:* upgrade at [https://atai.ink/pricing](https://atai.ink/pricing) (Explorer adds the editor; Starter adds source download, GitHub sync and custom domains) via [https://atai.ink/settings/billing](https://atai.ink/settings/billing).

**(d) GitHub connect / push fails**
- *Fix:* reconnect at [https://atai.ink/settings/profile](https://atai.ink/settings/profile) → Connected Services; confirm the repo exists and the branch (default `main`) is correct; use different repos or branches per project to avoid conflicts. Disconnecting never deletes existing code or git history.

**(e) Runtime API returns 401 / 403**
- *Fix:* ① confirm the header is exactly `Authorization: Bearer <key>`; ② confirm `ATAI_API_KEY` is present in [https://atai.ink/project/PROJECT_ID/env](https://atai.ink/project/PROJECT_ID/env); ③ **rotate** the key at [https://atai.ink/project/PROJECT_ID/runtime/keys](https://atai.ink/project/PROJECT_ID/runtime/keys) or [https://atai.ink/developers/keys](https://atai.ink/developers/keys); ④ check health at `GET https://atai.ink/api/runtime/v1/health` and limits at [/runtime/limits](https://atai.ink/project/PROJECT_ID/runtime/limits). Full reference: [https://atai.ink/sdk](https://atai.ink/sdk).

**(f) Runtime spend is higher than expected**
- *Fix:* set caps at [https://atai.ink/project/PROJECT_ID/runtime/limits](https://atai.ink/project/PROJECT_ID/runtime/limits), inspect calls at [/runtime/requests](https://atai.ink/project/PROJECT_ID/runtime/requests) and [/runtime/usage](https://atai.ink/project/PROJECT_ID/runtime/usage), and review [https://atai.ink/finances](https://atai.ink/finances).

## 10.8 UI / performance

**(a) Blank dashboard or page crash**
- *Fix:* hard-refresh; open DevTools Console for the red error; if a data-shape error repeats, report it with the URL to [support@atai.ink](mailto:support@atai.ink).

**(b) Status never updates (stuck spinner)**
- *Cause:* the 2-second status polling loop stopped.
- *Fix:* hard-refresh; check DevTools → Network for `GET /api/projects/PROJECT_ID/status` requests.

**(c) Atai on mobile**
- Atai's own dashboard is designed for desktop; the applications it builds are fully responsive and work on phones. Use a desktop browser for building and managing.

**(d) Theme looks wrong / resets**
- *Fix:* set it at [https://atai.ink/settings/appearance](https://atai.ink/settings/appearance). It saves to `atai:theme` in localStorage instantly and syncs to your account when signed in — check you are signed in for cross-device sync.

## 10.9 When none of the above works

1. Reproduce once and note the **exact URL**, the **project ID**, the **timestamp**, and the **exact error text**.
2. Open DevTools → **Console** and **Network**, and screenshot the failing request's response.
3. Check [https://atai.ink/docs](https://atai.ink/docs) search and this guide's [Part 9](#part-9-complete-url-directory).
4. Post a [feature request / bug report](https://atai.ink/feature-requests) or use the thumbs-down on the relevant docs section.
5. Email [support@atai.ink](mailto:support@atai.ink), WhatsApp/call [+256761819885](tel:+256761819885), or ask in the [WhatsApp community](https://chat.whatsapp.com/CB3zVz7UnsQLfDjjk04gt1). Include the four details from step 1 — it makes the fix much faster.

---

## Part 11 — Checklists and quick reference

## 11.1 First 10 minutes

- [ ] Register at [https://atai.ink/register](https://atai.ink/register)
- [ ] Verify email (banner → Resend email if needed) → confirm 500 credits in the header meter
- [ ] Complete the onboarding mission (one good sentence about what you are building)
- [ ] Land on `https://atai.ink/project/PROJECT_ID/collaborate`
- [ ] Read the plan on the left; ask one question in the chat on the right
- [ ] Bookmark [https://atai.ink/settings/billing](https://atai.ink/settings/billing) and [https://atai.ink/docs/onboarding](https://atai.ink/docs/onboarding)

## 11.2 First day (first launch)

- [ ] Check [https://atai.ink/pricing](https://atai.ink/pricing) — a Standard Simple build is 50,000 credits; the Free plan's 500 credits will not cover a build
- [ ] Refine the plan fully on Collaborate **before** submitting (avoid 50k+ follow-up edits)
- [ ] Click **Submit Plan & Start Building**; watch [progress](https://atai.ink/project/PROJECT_ID/progress)
- [ ] Inspect the generated app in the Workspace
- [ ] Publish at [https://atai.ink/project/PROJECT_ID/hosting](https://atai.ink/project/PROJECT_ID/hosting) → free subdomain (500 credits)
- [ ] Open the live URL and click through every page
- [ ] Visit [https://atai.ink/project/PROJECT_ID/database](https://atai.ink/project/PROJECT_ID/database) and confirm your tables exist

## 11.3 Weekly operations

- [ ] [https://atai.ink/dashboard](https://atai.ink/dashboard) — clear attention items
- [ ] [https://atai.ink/notifications](https://atai.ink/notifications) — inbox
- [ ] [https://atai.ink/finances](https://atai.ink/finances) — revenue vs runtime spend
- [ ] [/runtime/usage](https://atai.ink/project/PROJECT_ID/runtime/usage) and [/runtime/health](https://atai.ink/project/PROJECT_ID/runtime/health) — consumption and uptime
- [ ] [/database](https://atai.ink/project/PROJECT_ID/database) — spot-check records
- [ ] [https://atai.ink/resources](https://atai.ink/resources) + [https://atai.ink/lessons](https://atai.ink/lessons) — one new lesson
- [ ] [https://atai.ink/settings/billing](https://atai.ink/settings/billing) — balance and history

## 11.4 Scaling checklist

- [ ] Move to a plan whose monthly credits match your build cadence ([/pricing](https://atai.ink/pricing))
- [ ] Enable the four feature switches at [https://atai.ink/settings/features](https://atai.ink/settings/features)
- [ ] Connect a custom domain ([/hosting](https://atai.ink/project/PROJECT_ID/hosting))
- [ ] Set runtime limits and rotate keys ([/runtime/limits](https://atai.ink/project/PROJECT_ID/runtime/limits), [/runtime/keys](https://atai.ink/project/PROJECT_ID/runtime/keys))
- [ ] Turn on GitHub auto-push for a code backup ([/settings/profile](https://atai.ink/settings/profile))
- [ ] Export a snapshot regularly: [https://atai.ink/api/projects/PROJECT_ID/export](https://atai.ink/api/projects/PROJECT_ID/export)
- [ ] Publish your business to [https://atai.ink/explore](https://atai.ink/explore) so others can fork it (you earn a royalty)
- [ ] Use Refer & Earn at [https://atai.ink/referrals](https://atai.ink/referrals) to offset credit costs

---

## Part 12 — Glossary and where to learn more

| Term | Definition |
|---|---|
| **Atai Credits** | Internal currency for analysis, builds, deploys, chat, and growth actions |
| **Baseline Cost Unit** | 1,000 Atai Credits; internal economics unit |
| **Collaborate** | Plan + AI chat review screen before a build |
| **Deep Crawl** | Full-site recursive crawl (up to 50 pages, up to 15 min) |
| **Dodo Payments** | Subscription and credit-pack payment processor |
| **Fork** | Start your own business from someone else's public project (cheaper than a full build; pays the original owner a royalty) |
| **Founder Form** | The five-field structured Idea Mode form |
| **Heavy / Pro** | Premium 7-stage pipeline mode |
| **Legacy / Standard** | Fast single-pass pipeline mode |
| **Plan Ready** | State where you review before any build credits are spent |
| **Relevant Info** | Fast analysis of the most important pages only |
| **Runtime API** | `https://atai.ink/api/runtime/v1` — one key for AI, payments, maps, messaging, auth, search, data |
| **Totalum project** | The generated application and its database/hosting; free subdomain `*.totalum-project.com` |
| **Workspace** | The home screen for one business |

**Where to learn more:**

- Short, searchable docs: [https://atai.ink/docs](https://atai.ink/docs)
- This extended guide: [https://atai.ink/docs/onboarding](https://atai.ink/docs/onboarding)
- Founder library: [https://atai.ink/resources](https://atai.ink/resources) (categories: start, build, launch, grow, ai, atai, templates, glossary)
- Business lessons: [https://atai.ink/lessons](https://atai.ink/lessons)
- SDK & API reference: [https://atai.ink/sdk](https://atai.ink/sdk)
- Developer portal: [https://atai.ink/developers](https://atai.ink/developers)
- AI-readable index: [https://atai.ink/llms.txt](https://atai.ink/llms.txt) and [https://atai.ink/llms-full.txt](https://atai.ink/llms-full.txt)
- Human help: [support@atai.ink](mailto:support@atai.ink) · [+256761819885](tel:+256761819885) · [WhatsApp community](https://chat.whatsapp.com/CB3zVz7UnsQLfDjjk04gt1) · [YouTube](https://www.youtube.com/@mirrorsiteai)

---

*This guide is the extended companion to the Atai documentation. All URLs point to the single public origin **https://atai.ink**. Prices and credit costs are current code defaults and may be changed by platform operators — the numbers shown in the app at the moment of purchase are authoritative. Last compiled from the `atai` v5.0.0 codebase.*
