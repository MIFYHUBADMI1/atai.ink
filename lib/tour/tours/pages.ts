import type { TourDefinition } from "../types"

/**
 * Individual page tours.
 *
 * A founder who lands on one page should be able to understand that page
 * without being walked through six others. These stay on their own route:
 * no cross-page navigation, four or five stops, one or two minutes.
 */
function pageTour(
  id: string,
  title: string,
  blurb: string,
  minutes: number,
  startRoute: TourDefinition["startRoute"],
  steps: TourDefinition["steps"],
  extra: Partial<Pick<TourDefinition, "requiresProject" | "requiresFeature">> = {},
): TourDefinition {
  return {
    id,
    title,
    blurb,
    // Page tours are listed under the page they belong to, not as a course.
    category: "Advanced features",
    minutes,
    startRoute,
    ...extra,
    steps,
  }
}

export const PAGE_TOURS: TourDefinition[] = [
  pageTour("page-projects", "Your businesses", "The list that is actually your portfolio, and what each card is telling you.", 2, "projects", [
    {
      id: "list",
      kind: "info",
      title: "Every business you run",
      text: "One card per business with its real stage and its money. A card that says there is no financial data yet means exactly that — it is not a zero.",
      target: "projects-list",
      verify: { type: "element", target: "projects-list" },
    },
    {
      id: "open",
      kind: "click",
      title: "Open one to work on it",
      text: "A card takes you into that business's workspace: plan, co-founder, application, hosting, growth and its own finances.",
      target: "projects-list",
      instruction: "Open whichever business needs you most right now.",
      verify: { type: "manual" },
    },
    {
      id: "start-new",
      kind: "click",
      title: "Starting another one",
      text: "New businesses come from the same place: an idea, a website you own or admire, or a repository. Each business keeps its own plan, customers and money.",
      target: "projects-new",
      instruction: "If you have not started one yet, take the full Create your first business tour instead — it walks the real form.",
    },
  ]),

  pageTour("page-create", "Starting a business", "Four ways in, and what Atai does with what you type.", 3, "newBusiness", [
    {
      id: "composer",
      kind: "info",
      title: "This box is the beginning",
      text: "Describe the business in your own words: who it serves, what it does, what success looks like. The co-founder builds the whole plan from this brief.",
      target: "new-composer",
    },
    {
      id: "methods",
      kind: "info",
      title: "Pick the way that matches what you have",
      text: "An idea when you know the outcome. A website when something exists to mirror or rebuild. A repository when the code is already written.",
      target: "new-method-idea",
      instruction: "Choose a starting method, then take the full creation tour to be walked through submitting it.",
    },
    {
      id: "cost",
      kind: "info",
      title: "Nothing is charged yet",
      text: "Describing and submitting starts planning, which uses credits — the cost is shown on the button before you press it. You can write and re-write your brief here for free.",
      costsCredits: true,
    },
  ]),

  pageTour("page-dashboard", "Your command centre", "What needs your attention, across every business you run.", 2, "dashboard", [
    {
      id: "overview",
      kind: "info",
      title: "The shortlist, not the whole archive",
      text: "Atai puts the things waiting on a decision from you here, plus the state of each business. Everything else is one click away in the navigation.",
      target: "dashboard-overview",
    },
    {
      id: "journey",
      kind: "info",
      title: "Which stage each business is in",
      text: "Idea, plan, build, launch, grow, run. The stage decides which actions are offered and which are not available yet.",
      target: "dashboard-journey",
    },
    {
      id: "actions",
      kind: "info",
      title: "Acting from here",
      text: "Actions that cost credits show their cost where they are pressed, not on this page. Treat a highlighted item here as a question, not a task list.",
      target: "dashboard-actions",
    },
  ]),

  pageTour("page-collaborate", "Your co-founder", "How to direct the one who knows your business best.", 3, "projectCollaborate", [
    {
      id: "chat",
      kind: "info",
      title: "It is reading your plan",
      text: "The co-founder answers from this business's plan, application state and numbers. Ask it something specific and it will tell you when it is guessing.",
      target: "cofounder-chat",
    },
    {
      id: "ask",
      kind: "input",
      title: "Asking costs credits, so aim",
      text: "Each reply uses credits, shown before sending. Constraints beat adjectives: name the audience, the price, the problem.",
      target: "cofounder-input",
      costsCredits: true,
      instruction: "Ask one real question now, or read the fuller co-founder tour if you want the whole workflow.",
      verify: { type: "manual" },
    },
    {
      id: "build",
      kind: "info",
      title: "The expensive gate",
      text: "Submitting the plan for a build is the big spend: it commits credits to generating your application. It waits for you, always.",
      target: "project-next-action",
      route: "project",
      costsCredits: true,
    },
  ], { requiresProject: true }),

  pageTour("page-plan", "Your business plan", "The document everything else is written from.", 3, "projectPlan", [
    {
      id: "report",
      kind: "info",
      title: "One plan, several sections",
      text: "Offer, audience, pricing and revenue, marketing, look and feel, and the delivery brief. Drafts, campaigns and builds all read from here.",
      target: "plan-report",
    },
    {
      id: "correct",
      kind: "click",
      title: "Fix what is wrong here first",
      text: "A wrong section becomes wrong ads and a wrong application. Edit the section, or tell the co-founder what to change and have it revise.",
      target: "plan-report",
      instruction: "Read the pricing and audience sections and correct anything you would not say out loud to a customer.",
      verify: { type: "manual" },
    },
    {
      id: "next",
      kind: "info",
      title: "The plan is not a ceremony",
      text: "It stays editable after launch, and it should change as you learn. The version you write before your first customer is a hypothesis with your name on it.",
      target: "cofounder-input",
    },
  ], { requiresProject: true }),

  pageTour("page-market", "Market & grow", "Turn a plan into launch material, with the measurements attached.", 3, "projectMarket", [
    {
      id: "overview",
      kind: "info",
      title: "Real numbers, honest gaps",
      text: "Deployment state, runtime and checkout calls, credits spent and plan completeness come from your workspace. Visitor analytics are not collected yet, and the page says so instead of showing zeros.",
      target: "market-overview",
    },
    {
      id: "kit",
      kind: "info",
      title: "Launch pack costs credits",
      text: "The launch kit drafts the announcement set in one pass. Generating uses credits and the cost is on the button.",
      target: "market-launch-kit",
      costsCredits: true,
    },
    {
      id: "nothing-posted",
      kind: "info",
      title: "Nothing is published from here",
      text: "Drafts land in your library. You copy them to a channel yourself — Atai does not post, send or publish on your behalf.",
      target: "market-studio",
    },
  ], { requiresProject: true, requiresFeature: "marketStudio" }),

  pageTour("page-ads", "Ads & growth", "Strategy, drafts and quotes — and where real money appears.", 3, "projectAds", [
    {
      id: "overview",
      kind: "info",
      title: "Atai does not run ads",
      text: "This page plans advertising and drafts it. Where you want paid placement, Atai quotes it and you accept — execution stays with you.",
      target: "ads-overview",
    },
    {
      id: "bench",
      kind: "info",
      title: "Drafting costs credits",
      text: "Ad sets and images are drafted on request, including image generation, and each draft uses credits.",
      target: "ads-bench",
      costsCredits: true,
    },
    {
      id: "requests",
      kind: "info",
      title: "The money page",
      text: "Placement requests carry a quote, and accepting one spends money. Results recorded against them come from Atai's staff and are labelled by source.",
      target: "ads-requests",
    },
  ], { requiresProject: true, requiresFeature: "marketStudio" }),

  pageTour("page-hosting", "Hosting", "Whether your application is reachable, and how it got there.", 3, "projectHosting", [
    {
      id: "state",
      kind: "info",
      title: "Built, deployed, live",
      text: "Three different things, reported separately. This tour completing does not make your application live — the state shown here does.",
      target: "app-publish",
    },
    {
      id: "publish",
      kind: "info",
      title: "Publishing costs credits",
      text: "Deploying puts the current build on a public address, and it costs credits. Check the preview in the editor first.",
      target: "app-publish",
      costsCredits: true,
    },
    {
      id: "domain",
      kind: "info",
      title: "A domain of your own",
      text: "You can attach a custom domain. The Atai address keeps working until the domain is confirmed, so nothing goes dark while you wait.",
      target: "app-domain",
    },
  ], { requiresProject: true }),

  pageTour("page-finances", "Business finances", "What came in, what it cost, and which number is an estimate.", 2, "projectFinances", [
    {
      id: "overview",
      kind: "info",
      title: "Earnings and cost, never blended",
      text: "Money from customers and credits spent running the business stay on separate axes. A total that mixes them would flatter the business and mislead you.",
      target: "finances-overview",
    },
    {
      id: "sources",
      kind: "info",
      title: "Every figure says where it came from",
      text: "Earnings come from payments attributed to this business; costs from real runtime metering. Recurring and valuation figures are modelled, with their basis stated.",
      target: "finances-overview",
    },
    {
      id: "compare",
      kind: "info",
      title: "The comparison to make",
      text: "Put what customers paid against what the business cost to run in the same period. That single comparison is worth more than any chart on the page.",
      target: "runtime-usage",
    },
  ], { requiresProject: true }),

  pageTour("page-intelligence", "Application intelligence", "What your customers did inside the application.", 2, "projectIntelligence", [
    {
      id: "overview",
      kind: "info",
      title: "Measured, not invented",
      text: "The page renders what exists and names what does not. A measured zero and an uninstrumented metric are different problems with different fixes.",
      target: "intelligence-overview",
    },
    {
      id: "consent",
      kind: "info",
      title: "Tracking is your decision",
      text: "Visitor tracking for this application is off until you switch it on, per business. Turning it on starts collection; turning it off stops it.",
      target: "intelligence-consent",
    },
    {
      id: "act",
      kind: "info",
      title: "One number, one change",
      text: "Pick the step where people stop, change it, and come back to the same figure. Numbers here are only useful as before and after.",
      target: "cofounder-input",
    },
  ], { requiresProject: true }),

  pageTour("page-runtime", "Runtime", "The machinery your application runs on, and what it is costing.", 3, "projectRuntime", [
    {
      id: "overview",
      kind: "info",
      title: "Your application calling Atai",
      text: "Requests here are calls your own application makes to Atai's capabilities. They are not visitors to your website, and the page does not pretend otherwise.",
      target: "runtime-overview",
    },
    {
      id: "usage",
      kind: "info",
      title: "Usage before the bill",
      text: "Usage shows what consumed credits and exports to CSV. Read it monthly; a surprise in a credit balance is always a month you did not look.",
      target: "runtime-usage",
    },
    {
      id: "keys",
      kind: "info",
      title: "Keys can break a live application",
      text: "Rotating or revoking a key stops any application using it immediately, so each of those carries a confirmation. If you did not create a key, find out what did before deleting it.",
      target: "runtime-keys",
    },
  ], { requiresProject: true }),

  pageTour("page-competition", "Competition", "Who else serves your customers, and what the evidence says.", 2, "projectCompetition", [
    {
      id: "dash",
      kind: "info",
      title: "Research starts from your plan",
      text: "Competitor work only means something against a specific offer, so it needs a plan. Without a research provider available, the page says so rather than inventing rivals.",
      target: "competition-dashboard",
    },
    {
      id: "run",
      kind: "info",
      title: "Live research costs credits",
      text: "A scan searches real sources and returns findings with links and dates, for a credit cost shown first. Automatic monitoring is not available yet.",
      target: "competition-dashboard",
      costsCredits: true,
    },
    {
      id: "use",
      kind: "info",
      title: "Unverified means unverified",
      text: "Anything the research could not check is labelled as a lead. Take the useful one to your co-founder and change the positioning or price.",
      target: "cofounder-input",
    },
  ], { requiresProject: true, requiresFeature: "marketStudio" }),

  pageTour("page-features", "Feature switches", "Optional parts of Atai you can turn on when you need them.", 2, "settingsFeatures", [
    {
      id: "toggles",
      kind: "info",
      title: "You own the optional features",
      text: "SEO checks, growth tasks, campaign plans and business lessons are switches you control here, not settings hidden in a menu somewhere.",
      target: "settings-features",
    },
    {
      id: "effect",
      kind: "info",
      title: "What switching changes",
      text: "A feature that is off shows an honest unavailable page rather than an empty shell, and the tours for it stay out of the list until you turn it on.",
      target: "settings-features",
      instruction: "Turn on what you actually intend to use this month, and leave the rest off.",
      verify: { type: "manual" },
    },
  ]),

  pageTour("page-billing", "Credits and plan", "What you have paid for, and what each action costs.", 2, "settingsBilling", [
    {
      id: "credits",
      kind: "info",
      title: "Credits are prepayment, not a balance",
      text: "Credits buy Atai's running costs: planning, builds, research, drafts. They are not money in an account and they are not earnings — the finances pages keep those apart on purpose.",
      target: "settings-credits",
    },
    {
      id: "costs",
      kind: "info",
      title: "Know the prices",
      text: "The cost table says what each capability takes. Read it once so a button labelled with a number means something to you before you press it.",
      target: "settings-credits",
    },
    {
      id: "buy",
      kind: "info",
      title: "Buying goes through the payment provider",
      text: "Purchasing credits or changing plans happens at the payment provider, at a real price, and always asks you first. This tour never starts a checkout.",
      target: "settings-billing-checkout",
    },
  ]),

  pageTour("page-explore", "Explore", "What other founders have built, and how to start from their work.", 2, "explore", [
    {
      id: "gallery",
      kind: "info",
      title: "A public gallery of built businesses",
      text: "Projects their owners chose to publish. Useful for calibrating what Atai actually produces before you spend credits finding out.",
      target: "explore-gallery",
    },
    {
      id: "fork",
      kind: "click",
      title: "Copying one gives you your own",
      text: "Forking makes a copy in your own account to change — the original is untouched, and it becomes a business of yours with its own plan and money.",
      target: "explore-fork",
      instruction: "Open a project you find interesting first; the copy option appears on the page.",
      verify: { type: "manual" },
    },
  ]),

  pageTour("page-docs", "Help & support", "Where the written answers live, and how to reach a human.", 2, "docs", [
    {
      id: "guides",
      kind: "info",
      title: "Guides, not release notes",
      text: "Written for owners: how onboarding works, the runtime API, managing your app's data, growth and marketing, and what to do when something fails.",
      target: "docs-hub",
    },
    {
      id: "report",
      kind: "click",
      title: "Reporting a real problem earns credits",
      text: "The report button is available on every page. A report that turns out to be a genuine bug earns you credits, because you saved everyone the trouble of finding it.",
      target: "support-report",
      instruction: "If you are stuck on something specific, report it with what you expected and what happened.",
      verify: { type: "manual" },
    },
  ]),
]
