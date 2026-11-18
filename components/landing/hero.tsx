"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowRight, BookOpen, Building2, Code2, FileText, Globe2, Lightbulb } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { HeroProductStack } from "@/components/landing/product-shot"
import { AuthTrigger } from "@/components/auth/auth-trigger"
import { useSession } from "@/lib/client/api"
import { LandingComposer } from "@/components/landing/composer"

type EntryPath = "new" | "existing"

const BRINGS = [
  { icon: Globe2, title: "Your live website", body: "Atai reads it and understands your offer, your pages, your market." },
  { icon: Code2, title: "Your code or project", body: "A GitHub repo — yours, or one built with another AI app builder." },
  { icon: FileText, title: "Or just your words", body: "No site yet? Describe what you already run in your own words." },
]

export function LandingHero({
  ctaHref,
  ctaLabel,
}: {
  ctaHref: string
  ctaLabel: string
}) {
  const { session } = useSession()
  const [entry, setEntry] = useState<EntryPath>("new")

  return (
    <section className="relative mx-auto w-full max-w-7xl px-6 pb-14 pt-4 lg:px-10 lg:pb-20 lg:pt-6">
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-8">
        <div className="flex flex-col items-start">
          <p className="lp-badge mb-3 inline-flex items-center gap-2 rounded-full border border-indigo-500/20 bg-indigo-500/8 px-4 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-300">
            <span className="lp-live-dot size-1.5 rounded-full bg-indigo-500" />
            Your business. Your AI teams.
          </p>

          <h1 className="lp-h1 max-w-2xl text-balance text-[1.85rem] font-black leading-[1.12] tracking-[-0.04em] sm:text-4xl lg:text-[2.75rem]">
            Start, run, and grow{" "}
            <span className="lp-gradient-text">your own business.</span>
          </h1>

          <p className="lp-copy mt-3 max-w-lg text-pretty text-sm leading-6 text-muted-foreground sm:text-base">
            Starting from an idea — or already running a business, a website, or a product built elsewhere? Bring what
            you have. Atai’s specialized AI teams help you plan, build, manage, market, and scale it, all working
            toward customers, sales, and an income of your own.
          </p>
          <p className="lp-copy mt-2 max-w-lg text-pretty text-sm leading-6 text-muted-foreground">
            Unlike hiring a full team or juggling separate tools, Atai’s specialized AI teams collaborate in one
            workspace — from your first plan through daily operations to growth.
          </p>

          <div
            role="tablist"
            aria-label="Choose how to start with Atai"
            className="lp-hero-input mt-5 flex w-full flex-wrap items-center gap-1.5"
          >
            <button
              type="button"
              role="tab"
              id="entry-tab-new"
              aria-selected={entry === "new"}
              aria-controls="entry-panel-new"
              onClick={() => setEntry("new")}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition-all",
                entry === "new"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Lightbulb className="size-3.5 shrink-0" aria-hidden />
              Start with an idea
            </button>
            <button
              type="button"
              role="tab"
              id="entry-tab-existing"
              aria-selected={entry === "existing"}
              aria-controls="entry-panel-existing"
              onClick={() => setEntry("existing")}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition-all",
                entry === "existing"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Building2 className="size-3.5 shrink-0" aria-hidden />
              I already have a business
            </button>
          </div>

          {entry === "new" ? (
            <div id="entry-panel-new" role="tabpanel" aria-labelledby="entry-tab-new" className="mt-2 w-full">
              <LandingComposer />
            </div>
          ) : (
            <div
              id="entry-panel-existing"
              role="tabpanel"
              aria-labelledby="entry-tab-existing"
              className="mt-2 w-full rounded-[1.35rem] border border-transparent bg-card/90 p-5 backdrop-blur-md"
            >
              <p className="text-sm font-semibold">
                Do not start over. Keep running what already works.
              </p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Connect a business you already run — or a project built with another AI app builder. Atai reads what
                you share, gives you an honest first assessment, and your AI teams take it from there: no rebuild, no
                switching tools, nothing thrown away.
              </p>
              <ul className="mt-4 space-y-3">
                {BRINGS.map((item) => (
                  <li key={item.title} className="flex gap-3">
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
                      <item.icon className="size-3.5" aria-hidden />
                    </span>
                    <span className="text-sm leading-5">
                      <span className="font-semibold">{item.title}</span>
                      <span className="mt-0.5 block text-muted-foreground">{item.body}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-5 flex flex-wrap items-center gap-2">
                {session ? (
                  <Link
                    href="/new/existing"
                    className={cn(buttonVariants({ size: "sm" }), "lp-cta-primary h-9 gap-1.5 px-4 font-semibold")}
                  >
                    Connect my business
                    <ArrowRight className="size-3.5" />
                  </Link>
                ) : (
                  <AuthTrigger
                    view="signup"
                    next="/new/existing"
                    className={cn(buttonVariants({ size: "sm" }), "lp-cta-primary h-9 gap-1.5 px-4 font-semibold")}
                  >
                    Connect my business
                    <ArrowRight className="size-3.5" />
                  </AuthTrigger>
                )}
                <span className="text-xs text-muted-foreground">Takes about two minutes — your words are enough to begin.</span>
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {session ? (
              <Link href={ctaHref} className={cn(buttonVariants({ size: "sm" }), "lp-cta-primary h-9 gap-1.5 px-4 font-semibold")}>
                {ctaLabel}
                <ArrowRight className="size-3.5" />
              </Link>
            ) : (
              <AuthTrigger view="signup" next="/new/idea" className={cn(buttonVariants({ size: "sm" }), "lp-cta-primary h-9 gap-1.5 px-4 font-semibold")}>
                {ctaLabel}
                <ArrowRight className="size-3.5" />
              </AuthTrigger>
            )}
            <a href="#how-it-works" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-9 px-4")}>
              See how Atai works
            </a>
          </div>
          <Link
            href="/resources"
            className="mt-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <BookOpen className="size-3.5" />
            Browse the resource library — guides, tutorials, roadmaps, documents, and videos
          </Link>
        </div>

        <HeroProductStack className="lg:self-start lg:mt-6" />
      </div>
    </section>
  )
}
