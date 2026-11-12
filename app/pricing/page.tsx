import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, BookOpen, Check, Store, Users, Building2, Globe, Link as LinkIcon, Shield, HelpCircle, ChevronDown, Coins, Rocket, Wallet } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { SITE_URL } from "@/lib/env"
import { getCurrentUser } from "@/lib/auth/session"
import {
  BUILD_TIERS,
  SUBSCRIPTION_PLANS,
  PERMANENT_CREDIT_PACKS,
  CREDIT_UNIT_NAME,
  formatUSD,
  WELCOME_BONUS_CREDITS,
} from "@/lib/billing/config"
import { getBuildTierCosts, getDeploymentCosts } from "@/lib/billing/runtime-config"
import { PlanCard } from "@/components/billing/plan-card"
import { CheckoutButton } from "@/components/billing/checkout-button"
import { AuthTrigger } from "@/components/auth/auth-trigger"

/**
 * Pricing is where a first-time owner decides whether Atai is for them, so the
 * page leads with what the business gets and puts credit arithmetic after it.
 * Build and publishing costs are read from the billing authority
 * (`lib/billing/runtime-config.ts`, which defaults to `lib/billing/config.ts`)
 * so the numbers shown here are the numbers a build actually charges. Plan and
 * top-up prices are fixed in config; only the framing lives here.
 */

/** Per plan: what a founder can actually do with it this month. */
const PLAN_GUIDANCE: Record<string, { bestFor: string; outcomes: string[] }> = {
  free: {
    bestFor: "Looking around first",
    outcomes: [
      "Plan your business with Atai and see the working plan in your own workspace",
      `${WELCOME_BONUS_CREDITS.toLocaleString()} credits on email verification — enough to try the work, not enough to launch`,
      "Stay signed in as long as you like; upgrade when you want it built",
    ],
  },
  explorer: {
    bestFor: "Your first offer, live",
    outcomes: [
      "About one simple launch a month — the build, the hosting, the web address",
      "Take real customers: sign-in, records of their orders, and the database to hold it",
      "Publish it on the Atai marketplace so other owners can start from your business",
    ],
  },
  starter: {
    bestFor: "A business with customers already",
    outcomes: [
      "Launch on your own domain, so customers and search results find you by your name",
      "Iterate as you learn: edits to pages, offers and pricing without starting over",
      "About six simple launches' worth of work every month, or a bigger business at a time",
    ],
  },
  business: {
    bestFor: "Running two or three businesses",
    outcomes: [
      "Your builds and edits go to the front of the queue",
      "Room to launch, change and market several businesses in the same month",
      "A support team behind your builds, not just a form",
    ],
  },
  professional: {
    bestFor: "Several businesses, all running at once",
    outcomes: [
      "The heaviest monthly workload we offer without a custom contract",
      "Talk to a person directly about the businesses you are running",
      "Enough credits to keep launching, selling and growing without watching the meter",
    ],
  },
  enterprise: {
    bestFor: "A portfolio or an organisation",
    outcomes: [
      "Credit volume and integrations shaped around your operation",
      "Dedicated infrastructure, an uptime commitment and an account manager",
      "We help your first businesses go out the door",
    ],
  },
}

/** What launching costs, in the size of business rather than lines of work. */
const LAUNCH_SIZES = [
  {
    tierId: "simple",
    icon: Store,
    headline: "One offer, online this week",
    forLine: "A shop, a service, a portfolio, a booking page — one clear thing to sell.",
    gets: [
      "A live website for the business, sized for phones as well as desks",
      "A way for people to reach you, ask, or order",
      "Hosting, HTTPS and a free Atai web address",
      "An admin console so you can see enquiries and orders yourself",
    ],
  },
  {
    tierId: "medium",
    icon: Users,
    headline: "Real customers, real sales",
    forLine: "You want people to sign in, pay, and come back — and you want to keep track of them.",
    gets: [
      "Customer accounts: sign up, sign in, their own area",
      "Records of every customer, order and job, searchable",
      "Payments, offers and pricing tiers",
      "Dashboards so you can see sales and daily work in one screen",
    ],
  },
  {
    tierId: "complex",
    icon: Building2,
    headline: "A whole platform business",
    forLine: "More than one way to earn, several moving parts, and customers on both sides.",
    gets: [
      "Multiple revenue streams working together",
      "Your business can email, message and remind customers on its own",
      "Deeper data work: catalogues, availability, matching, history",
      "Connections to the tools you already use, run through your Atai key",
    ],
  },
]

const INCLUDED_WITH_EVERY_LAUNCH = [
  { icon: Globe, title: "Hosting that stays up", body: "Your business is online with HTTPS and a global network. No server to manage, and no separate hosting bill." },
  { icon: Wallet, title: "A way to get paid", body: "Checkout, subscriptions and payout records run through Atai Payments — no separate payment account for you to open and configure." },
  { icon: Users, title: "Customer accounts", body: "People can sign up, sign in and come back to what is theirs." },
  { icon: Building2, title: "Your records", body: "Customers, orders and work are stored properly, not in a spreadsheet you keep losing." },
  { icon: Shield, title: "An admin console", body: "Every business launches with its own admin area so you can manage it without asking anyone." },
  { icon: Coins, title: "One key for every feature", body: "AI replies, messages, maps, reminders and analytics all run on your Atai key — no jumble of vendor accounts." },
]

const FAQS = [
  {
    q: "Do I have to write code, or hire someone?",
    a: "No. You describe the business you want to run. Atai's teams plan it, build it, put it online and then keep working on it with you. When your business needs a feature, it is asked for in plain words and delivered as part of the business.",
  },
  {
    q: "What exactly do I have when a launch finishes?",
    a: "A live business you can send people to: your website or product on its own web address, hosting and security already set up, customer sign-in, records of your customers and orders, a way to take payment, and an admin console so you can run all of it yourself.",
  },
  {
    q: "What is an Atai Credit, really?",
    a: "One unit of work by your Atai teams — planning, building, changing, launching, answering, writing to your customers. You are shown the credit cost before any piece of work starts, so nothing is spent quietly.",
  },
  {
    q: "Do my credits run out?",
    a: "Monthly credits from your plan are used first and expire at the end of the month. Permanent credits — the welcome bonus and any top-up packs — never expire and stay yours even if you cancel a plan.",
  },
  {
    q: "What happens if I run out in the middle of something?",
    a: "Work stops before it goes past what you can pay for, and credits reserved for a job that cannot complete are returned to you. Add credits or change plan and the work picks up where it stopped.",
  },
  {
    q: "Can I bring something I already have?",
    a: "Yes. Point Atai at a website you like or own, or bring an existing product, and it works from what is already there instead of starting from nothing.",
  },
  {
    q: "Can I sell what I build?",
    a: "Businesses you publish on the Atai marketplace can be started from by other owners. You get credited when someone does, and you can keep running your own.",
  },
  {
    q: "How do I pay, and can I stop?",
    a: "Plans are billed monthly by card through a secure checkout provider. You can change or cancel at any time, and your published business stays hosted.",
  },
]

const LAUNCHES = LAUNCH_SIZES.flatMap((size) => {
  const tier = BUILD_TIERS[size.tierId]
  return tier ? [{ ...size, tier, popular: tier.id === "medium" }] : []
})

export const metadata: Metadata = {
  title: "Atai Pricing | Plans to Launch and Run a Business",
  description:
    "Atai plans, builds, launches and runs your business with specialized AI teams — hosting, customers, payments and an admin console included. Choose a plan or start with free credits.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: `${SITE_URL}/pricing`,
    siteName: "Atai",
    title: "Atai Pricing | Plans to Launch and Run a Business",
    description:
      "Tell Atai the business you want to run. AI teams plan it, build it, launch it and keep working on it — customers, sales and your own admin console included.",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Atai Pricing" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Atai Pricing | Plans to Launch and Run a Business",
    description:
      "Plans, builds and running costs explained in business terms — not tooling terms.",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Atai Pricing" }],
  },
}

const pricingStructuredData = {
  "@context": "https://schema.org",
  "@type": "Product",
  name: "Atai",
  description:
    "Atai.ink is the business builder for founders: launch, run and grow a real business with an AI team — customers, sales and your own admin console included. No code.",
  brand: { "@type": "Organization", name: "ATAI Enterprises", url: SITE_URL },
  offers: SUBSCRIPTION_PLANS.filter((p) => !p.custom).map((plan) => ({
    "@type": "Offer",
    name: `${plan.name} Plan`,
    price: plan.priceUSD,
    priceCurrency: "USD",
    description: `${plan.mirrorCredits.toLocaleString()} ${CREDIT_UNIT_NAME} per month`,
    url: `${SITE_URL}/pricing`,
    availability: "https://schema.org/InStock",
    priceValidUntil: "2026-12-31",
  })),
}

const faqStructuredData = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQS.map((item) => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: { "@type": "Answer", text: item.a },
  })),
}

function SectionNav() {
  const links = [
    { href: "#plans", label: "Plans" },
    { href: "#launch", label: "What a launch costs" },
    { href: "#included", label: "What you get" },
    { href: "#top-ups", label: "Extra credits" },
    { href: "#hosting", label: "Your web address" },
    { href: "#questions", label: "Questions" },
  ]
  return (
    <nav aria-label="On this page" className="mx-auto max-w-5xl px-6 pb-12">
      <ul className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm">
        {links.map((link) => (
          <li key={link.href}>
            <a href={link.href} className="text-muted-foreground underline-offset-4 transition-colors hover:text-primary hover:underline">
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export default async function PricingPage() {
  let user = null
  try {
    user = await getCurrentUser()
  } catch {
    // Not logged in — show register buttons
  }

  // Read the same billing authority the build pipeline charges from, so an
  // admin price override shows here instead of drifting from the real charge.
  const [buildTierCosts, deploymentCosts] = await Promise.all([
    getBuildTierCosts(),
    getDeploymentCosts(),
  ])
  const simpleCredits = buildTierCosts.simple
  const deployCost = deploymentCosts.deployCost
  const tierCosts: Record<string, number> = buildTierCosts
  const launches = LAUNCHES.map((entry) => ({
    ...entry,
    tier: { ...entry.tier, credits: tierCosts[entry.tier.id] },
  }))

  return (
    <main className="min-h-screen bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(pricingStructuredData) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqStructuredData) }} />
      <SiteHeader activePage="/pricing" variant="bordered" />

      {/* Hero — what Atai does, before any numbers */}
      <section className="mx-auto max-w-4xl px-6 pt-16 pb-10 text-center sm:pt-20">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Pricing</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Tell us the business you want to run.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-pretty text-muted-foreground">
          Atai&rsquo;s AI teams plan it, build it, put it online and keep working on it —
          winning customers, taking payments and handling the daily work, so you have
          something that earns. You pay for that work in Atai Credits.
          {` Start with ${WELCOME_BONUS_CREDITS.toLocaleString()} free credits; no card needed.`}
        </p>
        <ul className="mx-auto mt-7 flex max-w-3xl flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
          {["Your own website or product", "Hosting and security set up", "Customer sign-in and records", "Take payments", "Your admin console", "No code to write"].map((item) => (
            <li key={item} className="flex items-center gap-1.5">
              <Check className="size-4 text-primary" />
              {item}
            </li>
          ))}
        </ul>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <AuthTrigger view="signup" next="/pricing" className={buttonVariants({ size: "lg" }) + " h-12 px-6"}>
            Start your business <ArrowRight className="size-4" />
          </AuthTrigger>
          <a href="#launch" className={buttonVariants({ size: "lg", variant: "outline" }) + " h-12 px-6"}>
            What a launch costs
          </a>
        </div>
      </section>

      <SectionNav />

      {/* The money, in three sentences */}
      <section className="border-y border-border bg-card/40">
        <div className="mx-auto max-w-4xl px-6 py-12">
          <h2 className="text-center text-2xl font-semibold tracking-tight">Three things to know about the money</h2>
          <div className="mt-8 grid gap-6 text-center sm:grid-cols-3">
            <div>
              <p className="font-medium">You are charged for finished work</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Every piece of work states its credit cost before it starts, and a job that
                cannot complete gives its reserved credits back.
              </p>
            </div>
            <div>
              <p className="font-medium">A plan gives you monthly credits</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Your plan refills your credits each month. Those are used first and
                expire when the month ends.
              </p>
            </div>
            <div>
              <p className="font-medium">Top-ups never expire</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Buy permanent credits whenever you need room — they stay yours,
                even if you stop the plan.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Plans, framed by what you can do with them */}
      <section id="plans" className="mx-auto max-w-5xl scroll-mt-24 px-6 py-20">
        <div className="mb-4 text-center">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Plans</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">Pick by how much work you need done</h2>
          <p className="mx-auto mt-3 max-w-2xl text-muted-foreground text-pretty">
            A simple launch is {simpleCredits.toLocaleString()} credits, so the plans below
            differ mainly in how much of your business&rsquo;s work they cover each month.
            Not sure? Start on Free, then pick a plan when you see the plan for your business.
          </p>
        </div>

        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          {SUBSCRIPTION_PLANS.filter((plan) => !plan.custom).map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              isLoggedIn={!!user}
              bestFor={PLAN_GUIDANCE[plan.id]?.bestFor}
              outcomes={PLAN_GUIDANCE[plan.id]?.outcomes}
              translateLabels
            />
          ))}
        </div>

        {(() => {
          const enterprise = SUBSCRIPTION_PLANS.find((plan) => plan.custom)
          if (!enterprise) return null
          return (
            <div className="mt-5">
              <PlanCard
                plan={enterprise}
                isLoggedIn={!!user}
                bestFor={PLAN_GUIDANCE[enterprise.id]?.bestFor}
                outcomes={PLAN_GUIDANCE[enterprise.id]?.outcomes}
                translateLabels
              />
            </div>
          )
        })()}
      </section>

      {/* What launching costs */}
      <section id="launch" className="scroll-mt-24 border-y border-border bg-card/40">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <div className="mb-12 text-center">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Launching and changing it</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">How much business are you starting?</h2>
            <p className="mx-auto mt-3 max-w-2xl text-muted-foreground text-pretty">
              Credits are spent when your Atai teams work on the business — launching it,
              changing it, getting customers. Bigger businesses take more of their work.
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {launches.map(({ tier, icon: Icon, headline, forLine, gets, popular }) => (
              <div
                key={tier.id}
                className={`relative flex flex-col rounded-xl border p-6 ${popular ? "border-primary/50 bg-card shadow-lg shadow-primary/5" : "border-border bg-card"}`}
              >
                {popular && (
                  <div className="absolute -top-3 left-6 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                    Most owners start here
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                    <Icon className="size-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold">{tier.label}</h3>
                    <p className="text-sm text-muted-foreground">{headline}</p>
                  </div>
                </div>

                <p className="mt-4 text-sm leading-6 text-pretty text-muted-foreground">{forLine}</p>

                <div className="mt-5">
                  <span className="text-3xl font-bold">{tier.credits.toLocaleString()}</span>
                  <span className="ml-2 text-muted-foreground">{CREDIT_UNIT_NAME}</span>
                </div>

                <ul className="mt-6 flex-1 space-y-3">
                  {gets.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                      <span className="text-muted-foreground text-pretty">{item}</span>
                    </li>
                  ))}
                </ul>

                <AuthTrigger
                  view="signup"
                  next="/pricing"
                  className={`mt-6 block w-full text-center py-2.5 rounded-lg text-sm font-medium transition-colors ${popular
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "border border-border hover:bg-accent"
                    }`}
                >
                  Build this kind of business
                </AuthTrigger>
              </div>
            ))}
          </div>

          <p className="mx-auto mt-8 max-w-3xl text-center text-sm leading-6 text-muted-foreground text-pretty">
            Publishing takes {deployCost.toLocaleString()} credits on top of the build, and starting from a
            business someone already published can cost far less than building your own.
          </p>
        </div>
      </section>

      {/* What is already included, whatever your plan */}
      <section id="included" className="mx-auto max-w-5xl scroll-mt-24 px-6 py-20">
        <div className="mb-12 text-center">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">In the box</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">Every business launches with</h2>
          <p className="mx-auto mt-3 max-w-2xl text-muted-foreground text-pretty">
            This is the part people usually forget to ask about: with most software you buy
            a tool and then still pay for hosting, a database, email, payments and an
            admin area. With Atai it comes with the business.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {INCLUDED_WITH_EVERY_LAUNCH.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-xl border border-border bg-card p-5">
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10">
                <Icon className="size-4 text-primary" />
              </div>
              <p className="mt-3 font-semibold">{title}</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground text-pretty">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Top-ups */}
      <section id="top-ups" className="scroll-mt-24 border-y border-border bg-card/40">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <div className="mb-10 text-center">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Extra credits</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">Run short in the middle of a month?</h2>
            <p className="mx-auto mt-3 max-w-2xl text-muted-foreground text-pretty">
              Buy permanent credits and keep them. They are spent only after your monthly
              ones, so nothing you pay for is wasted.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PERMANENT_CREDIT_PACKS.map((pack) => (
              <div
                key={pack.id}
                className={`rounded-xl border bg-card p-5 ${pack.popular ? "border-primary/50 shadow-lg shadow-primary/5" : "border-border"}`}
              >
                {pack.popular && (
                  <div className="mb-3 inline-block rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                    Best Value
                  </div>
                )}
                <p className="text-2xl font-bold">{pack.credits.toLocaleString()}</p>
                <p className="mt-1 text-sm text-muted-foreground">{CREDIT_UNIT_NAME}, yours for good</p>
                <p className="mt-3 text-xl font-semibold">{formatUSD(pack.priceUSD)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  ${(pack.priceUSD / pack.credits).toFixed(4)} per credit
                </p>
                {user ? (
                  <CheckoutButton
                    type="permanent"
                    productId={pack.id}
                    className="mt-4 w-full bg-background text-foreground border border-border hover:bg-accent"
                  >
                    Add these credits
                  </CheckoutButton>
                ) : (
                  <AuthTrigger
                    view="signup"
                    next="/pricing"
                    className="mt-4 block w-full text-center py-2 rounded-lg text-sm font-medium border border-border hover:bg-accent transition-colors"
                  >
                    Get started first
                  </AuthTrigger>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Where customers find you */}
      <section id="hosting" className="mx-auto max-w-5xl scroll-mt-24 px-6 py-20">
        <div className="mb-12 text-center">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Your web address</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">An Atai address, or your own name</h2>
          <p className="mx-auto mt-3 max-w-2xl text-muted-foreground text-pretty">
            You can go live on an address we give you in seconds, or put the business on a
            domain you own. Both are hosted, secured and fast either way.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="relative flex flex-col rounded-xl border-2 border-primary/30 bg-card p-6">
            <div className="absolute -top-3 left-6 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
              Fastest way live
            </div>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                <Globe className="size-5 text-primary" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">A free Atai address</h3>
                <p className="text-sm text-muted-foreground">Live the moment the build is done</p>
              </div>
            </div>

            <div className="mb-5 rounded-lg bg-muted/50 p-3">
              <p className="font-mono text-sm break-all">yourbusiness.totalum-project.com</p>
            </div>

            <ul className="space-y-2 text-sm">
              {[
                "Nothing to set up — no domain to buy, no settings to copy out",
                "Security and fast loading handled for you",
                "Hosting costs nothing extra, for as long as the business is yours",
                "Send the link to a customer or your WhatsApp status straight away",
                "Move to your own domain later without rebuilding",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span className="text-muted-foreground text-pretty">{item}</span>
                </li>
              ))}
            </ul>

            <div className="mt-auto pt-5">
              <p className="mb-3 text-sm"><span className="font-medium">Publishing your build</span> <span className="float-right font-mono">{deployCost.toLocaleString()} {CREDIT_UNIT_NAME}</span></p>
              <AuthTrigger view="signup" next="/pricing" className="block w-full text-center py-2.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                Start free
              </AuthTrigger>
            </div>
          </div>

          <div className="relative flex flex-col rounded-xl border border-border bg-card p-6">
            <div className="absolute -top-3 left-6 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium">
              From the Starter plan
            </div>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                <LinkIcon className="size-5 text-muted-foreground" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">A domain you own</h3>
                <p className="text-sm text-muted-foreground">Your name on every page and email</p>
              </div>
            </div>

            <div className="mb-5 rounded-lg bg-muted/50 p-3">
              <p className="font-mono text-sm text-muted-foreground break-all">www.yourbusiness.com</p>
            </div>

            <ul className="space-y-2 text-sm">
              {[
                "Customers remember one name, not a long address they have to save",
                "Search engines and your own emails carry your brand, not ours",
                "Security certificates set up for you",
                "We walk you through the few settings your domain provider asks for",
                "First six months of hosting included, then it is a line in your plan",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span className="text-muted-foreground text-pretty">{item}</span>
                </li>
              ))}
            </ul>

            <div className="mt-auto pt-5">
              <p className="mb-3 text-sm"><span className="font-medium">Publishing your build</span> <span className="float-right font-mono">{deployCost.toLocaleString()} {CREDIT_UNIT_NAME}</span></p>
              <AuthTrigger view="signup" next="/pricing" className="block w-full text-center py-2.5 rounded-lg text-sm font-medium border border-border hover:bg-accent transition-colors">
                Get started
              </AuthTrigger>
            </div>
          </div>
        </div>
      </section>

      {/* Questions owners actually ask */}
      <section id="questions" className="scroll-mt-24 border-y border-border bg-card/40">
        <div className="mx-auto max-w-3xl px-6 py-20">
          <div className="mb-10 flex items-center justify-center gap-2 text-center">
            <HelpCircle className="size-5 text-primary" />
            <h2 className="text-3xl font-semibold tracking-tight">Questions worth asking before you pay</h2>
          </div>
          <div className="divide-y divide-border rounded-xl border border-border bg-card">
            {FAQS.map((item) => (
              <details key={item.q} className="group px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium marker:hidden">
                  <span className="text-pretty">{item.q}</span>
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <p className="mt-3 text-sm leading-6 text-muted-foreground text-pretty">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-4xl px-6 py-16 text-center">
        <div className="flex justify-center">
          <Rocket className="size-6 text-primary" />
        </div>
        <h2 className="mt-4 text-2xl font-semibold tracking-tight">The first step costs nothing</h2>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground text-pretty">
          Tell Atai what you want to run. You get {WELCOME_BONUS_CREDITS.toLocaleString()} credits,
          a real plan for the business, and a clear price for launching it before you spend anything.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <AuthTrigger view="signup" next="/pricing" className={buttonVariants({ size: "lg" }) + " h-12 px-6"}>
            Start free <ArrowRight className="size-4" />
          </AuthTrigger>
        </div>
      </section>

      {/* Related pages — cross-links for navigation and SEO */}
      <section className="border-t border-border bg-muted/30">
        <div className="mx-auto max-w-5xl px-6 py-12 lg:px-10">
          <p className="mb-4 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Before you decide</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { href: "/start", icon: Rocket, label: "Start a business", desc: "Tell Atai the idea and see the plan", color: "text-primary", bg: "bg-primary/10" },
              { href: "/docs", icon: BookOpen, label: "Documentation", desc: "How launching and running works, step by step", color: "text-indigo-600 dark:text-indigo-400", bg: "bg-indigo-500/10" },
              { href: "/about", icon: Users, label: "Who Atai is for", desc: "First-time owners, small businesses and teams", color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-500/10" },
              { href: "/founder", icon: Building2, label: "Our founder's story", desc: "Why Atai was built for owners, not engineers", color: "text-cyan-600 dark:text-cyan-400", bg: "bg-cyan-500/10" },
            ].map(({ href, icon: Icon, label, desc, color, bg }) => (
              <Link key={href} href={href} className="group flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-all hover:border-primary/40 hover:shadow-md">
                <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${bg}`}>
                  <Icon className={`size-4 ${color}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">{label}</p>
                  <p className="text-[11px] text-muted-foreground">{desc}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <SiteFooter activePage="/pricing" links={[{ href: "/", label: "Home" }, { href: "/pricing", label: "Pricing" }, { href: "/docs", label: "Docs" }, { href: "/sdk", label: "SDK" }, { href: "/developers", label: "Developers" }, { href: "/about", label: "About" }, { href: "/privacy", label: "Privacy" }, { href: "/terms", label: "Terms" }]} wrapperClassName="mx-auto flex w-full max-w-5xl flex-col gap-5 px-6 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between" />
    </main>
  )
}
