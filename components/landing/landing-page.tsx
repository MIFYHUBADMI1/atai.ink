"use client"

import useSWR from "swr"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { ReferralProgramSection } from "@/components/referral/referral-program-section"
import { jsonFetcher, useSession } from "@/lib/client/api"
import type { PublicBillingConfig } from "@/lib/billing/public-config-types"
import { LandingHero } from "@/components/landing/hero"
import {
  LandingAudience,
  LandingBuild,
  LandingDifferentiation,
  LandingFinalCta,
  LandingGrow,
  LandingInfra,
  LandingLifecycle,
  LandingManage,
  LandingPlan,
  LandingResources,
  LandingStart,
  LandingTrust,
} from "@/components/landing/sections"

export default function LandingPage() {
  const { session } = useSession()
  const { data: publicBilling } = useSWR<PublicBillingConfig>("/api/billing/public-config", jsonFetcher)
  const ctaHref = session ? "/dashboard" : "/register"
  const ctaLabel = session ? "Open my businesses" : "Start my business"

  return (
    <main className="lp-root min-h-svh overflow-x-hidden bg-background text-foreground">
      <div className="lp-ambient" aria-hidden />
      <SiteHeader />
      <LandingHero ctaHref={ctaHref} ctaLabel={ctaLabel} />
      <LandingTrust />
      <LandingResources />
      <LandingDifferentiation />
      <LandingLifecycle />
      <LandingStart />
      <LandingPlan />
      <LandingBuild />
      <LandingInfra />
      <LandingManage />
      <LandingGrow />
      <LandingAudience />
      <ReferralProgramSection rewards={publicBilling?.rewards} />
      <LandingFinalCta
        ctaHref={ctaHref}
        ctaLabel={ctaLabel}
        welcomeBonus={publicBilling?.rewards.welcomeBonus}
      />
      <SiteFooter />
    </main>
  )
}
