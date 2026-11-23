import Link from "next/link"
import { ArrowRight, Gift, Rocket, UserPlus } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const STEPS = [
  {
    icon: UserPlus,
    title: "Share your link",
    body: "Every account gets a personal referral link. Share it with founders who want to start or grow a business.",
  },
  {
    icon: Gift,
    title: "They join with 500 extra credits",
    body: "The person who joins through your link gets 500 bonus credits on top of their welcome credits.",
  },
  {
    icon: Rocket,
    title: "You earn as they build",
    body: "You get 500 credits when they verify their account, and 1,500 more when their builds reach 75,000 credits.",
  },
]

/**
 * Public referral-program band. Rendered on the landing page and pricing so the
 * programme is documented wherever a visitor decides whether to join — not only
 * behind the signed-in /referrals page.
 */
export function ReferralProgramSection({
  className,
  ctaHref = "/referral-program",
  ctaLabel = "See how referrals work",
}: {
  className?: string
  ctaHref?: string
  ctaLabel?: string
}) {
  return (
    <section className={cn("border-y border-border bg-card/40", className)}>
      <div className="mx-auto w-full max-w-5xl px-6 py-16 lg:px-10">
        <div className="flex flex-col gap-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">Referral program</p>
          <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Invite a founder. You both get credits.
          </h2>
          <p className="max-w-2xl text-pretty text-base leading-7 text-muted-foreground">
            Atai is better with more owners in it. Share your referral link: the person who joins gets
            500 bonus credits, and you earn credits when they verify their account and start building.
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-xl border border-border bg-background p-5">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                <Icon className="size-5 text-primary" />
              </div>
              <h3 className="mt-4 text-base font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href={ctaHref} className={cn(buttonVariants({ size: "lg" }), "h-11 px-5")}>
            {ctaLabel} <ArrowRight className="size-4" />
          </Link>
          <p className="text-sm text-muted-foreground">
            Referral credits have no cash value and are not refundable. Up to 2,000 credits per referral.
          </p>
        </div>
      </div>
    </section>
  )
}
