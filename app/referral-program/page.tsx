import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, Gift, Rocket, ShieldCheck, UserPlus, Users } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { AuthTrigger } from "@/components/auth/auth-trigger"
import { getCurrentUser } from "@/lib/auth/session"
import { SITE_URL } from "@/lib/env"
import { cn } from "@/lib/utils"

export const metadata: Metadata = {
  title: "Referral program — Invite a founder, both get credits",
  description:
    "Share your Atai referral link. The person who joins gets 500 bonus credits, you get 500 when they verify, and 1,500 more when their builds reach 75,000 credits.",
  alternates: { canonical: "/referral-program" },
  openGraph: {
    title: "Atai referral program — Invite a founder, both get credits",
    description:
      "Share your Atai referral link. The person who joins gets 500 bonus credits, you earn credits when they verify and build.",
    url: `${SITE_URL}/referral-program`,
    type: "website",
  },
}

const EARNINGS = [
  {
    icon: Gift,
    title: "The person who joins",
    amount: "500 credits",
    body: "A one-time bonus added to their account when they register through your link, on top of the standard welcome credits.",
  },
  {
    icon: Users,
    title: "You, when they verify",
    amount: "500 credits",
    body: "Once the person you invited confirms their account, 500 credits land in your balance automatically.",
  },
  {
    icon: Rocket,
    title: "You, when they build",
    amount: "1,500 credits",
    body: "When their successful builds reach 75,000 eligible credits, you receive the final 1,500-credit milestone reward.",
  },
]

const STEPS = [
  {
    icon: UserPlus,
    title: "Get your personal link",
    body: "Open Refer & Earn from your account menu. Every account has a referral code and a shareable link.",
  },
  {
    icon: Gift,
    title: "Share it with a founder",
    body: "Send the link by message, email, or social. They can join with email, Google, or GitHub — all three count.",
  },
  {
    icon: Rocket,
    title: "Watch the credits arrive",
    body: "Your Refer & Earn page shows each person who joined, their status, and the rewards issued.",
  },
]

const RULES = [
  "A referral counts once per person. One business owner belongs to one referrer.",
  "The referred person must be new to Atai; existing accounts cannot be claimed retroactively.",
  "Rewards are credited automatically — you do not need to claim them.",
  "Self-referrals, duplicate accounts, and referral rings are blocked and may forfeit rewards.",
  "Referral credits are promotional: they have no cash value and cannot be refunded or transferred.",
  "The maximum reward per referred person is 2,000 credits (500 verification + 1,500 milestone).",
]

const FAQ = [
  {
    q: "When do I get my referral credits?",
    a: "You receive 500 credits as soon as the person you invited verifies their account. The 1,500-credit milestone arrives when their successful builds reach 75,000 eligible credits.",
  },
  {
    q: "Does the person I invite get anything?",
    a: "Yes. They receive 500 bonus credits when they register through your link, on top of the standard welcome credits every new account gets.",
  },
  {
    q: "Does it work with Google and GitHub sign-up?",
    a: "Yes. The referral link is remembered across email, Google, and GitHub registration, so every path attributes the person to you.",
  },
  {
    q: "Can I change my referral code?",
    a: "Yes. Open Refer & Earn and choose a custom code starting with ATAI-, or let Atai generate one. New links use the new code; links already shared keep working until you change the code.",
  },
  {
    q: "How many people can I refer?",
    a: "There is no fixed limit, but unusually high referral counts are reviewed for fraud before rewards are released.",
  },
]

export default async function ReferralProgramPage() {
  const user = await getCurrentUser()
  const cta = user
    ? { href: "/referrals", label: "Get my referral link" }
    : { href: "/register", label: "Create an account" }

  return (
    <main className="min-h-svh bg-background text-foreground">
      <SiteHeader activePage="/referral-program" />

      <section className="mx-auto w-full max-w-4xl px-6 pt-16 pb-12 sm:pt-20 lg:px-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">Referral program</p>
        <h1 className="mt-4 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          Invite a founder. You both get credits.
        </h1>
        <p className="mt-5 max-w-2xl text-pretty text-lg leading-8 text-muted-foreground">
          Atai grows when more people own their business. Share your referral link and both sides
          benefit: the person who joins receives 500 bonus credits, and you earn credits as they
          verify their account and start building.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          {user ? (
            <Link href={cta.href} className={cn(buttonVariants({ size: "lg" }), "h-12 px-6")}>
              {cta.label} <ArrowRight className="size-4" />
            </Link>
          ) : (
            <AuthTrigger view="signup" next="/referrals" className={cn(buttonVariants({ size: "lg" }), "h-12 px-6")}>
              {cta.label} <ArrowRight className="size-4" />
            </AuthTrigger>
          )}
          <p className="text-sm text-muted-foreground">Free to join. No credit card required.</p>
        </div>
      </section>

      <section className="border-y border-border bg-card/40">
        <div className="mx-auto w-full max-w-5xl px-6 py-14 lg:px-10">
          <h2 className="text-2xl font-semibold tracking-tight">What you both earn</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {EARNINGS.map(({ icon: Icon, title, amount, body }) => (
              <div key={title} className="rounded-xl border border-border bg-background p-5">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="size-5 text-primary" />
                </div>
                <p className="mt-4 text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
                <p className="mt-1 text-2xl font-semibold text-primary">{amount}</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-6 py-14 lg:px-10">
        <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, body }, index) => (
            <div key={title} className="rounded-xl border border-border p-5">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="size-5 text-primary" />
                </div>
                <span className="font-mono text-xs text-muted-foreground">0{index + 1}</span>
              </div>
              <h3 className="mt-4 text-base font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-border bg-card/40">
        <div className="mx-auto w-full max-w-4xl px-6 py-14 lg:px-10">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" />
            <h2 className="text-2xl font-semibold tracking-tight">Program rules</h2>
          </div>
          <ul className="mt-6 space-y-3">
            {RULES.map((rule) => (
              <li key={rule} className="flex items-start gap-3 text-sm leading-6 text-muted-foreground">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                {rule}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto w-full max-w-4xl px-6 py-14 lg:px-10">
        <h2 className="text-2xl font-semibold tracking-tight">Questions</h2>
        <div className="mt-6 divide-y divide-border rounded-xl border border-border">
          {FAQ.map((item) => (
            <details key={item.q} className="group px-5 py-4">
              <summary className="cursor-pointer list-none text-sm font-medium marker:hidden">{item.q}</summary>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-4xl px-6 pb-20 text-center lg:px-10">
        <h2 className="text-2xl font-semibold tracking-tight">Ready to invite someone?</h2>
        <p className="mx-auto mt-3 max-w-xl text-pretty text-muted-foreground">
          {user
            ? "Your referral link is waiting on your Refer & Earn page."
            : "Create your account, then share your link from Refer & Earn."}
        </p>
        <div className="mt-6 flex justify-center">
          {user ? (
            <Link href={cta.href} className={cn(buttonVariants({ size: "lg" }), "h-12 px-6")}>
              {cta.label} <ArrowRight className="size-4" />
            </Link>
          ) : (
            <AuthTrigger view="signup" next="/referrals" className={cn(buttonVariants({ size: "lg" }), "h-12 px-6")}>
              {cta.label} <ArrowRight className="size-4" />
            </AuthTrigger>
          )}
        </div>
      </section>

      <SiteFooter
        activePage="/referral-program"
        links={[
          { href: "/", label: "Home" },
          { href: "/pricing", label: "Pricing" },
          { href: "/referral-program", label: "Referrals" },
          { href: "/docs", label: "Docs" },
          { href: "/about", label: "About" },
          { href: "/terms", label: "Terms" },
          { href: "/privacy", label: "Privacy" },
        ]}
      />
    </main>
  )
}
