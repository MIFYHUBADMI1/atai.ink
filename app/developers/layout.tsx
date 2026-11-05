import type { ReactNode } from "react"
import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth/session"
import { store } from "@/lib/store/store"
import { DeveloperNav } from "@/components/developers/nav"
import { ProjectPicker } from "@/components/developers/project-picker"
import { getDeveloperPortalOrigin } from "@/lib/env"

const PORTAL_ORIGIN = getDeveloperPortalOrigin()

/** SEO: the portal is indexed at one location — /developers on the canonical
 * app origin. Only an explicitly configured staging host moves the origin, so
 * nothing here can point search engines at a subdomain that no longer serves. */
export const metadata: Metadata = {
  metadataBase: new URL(PORTAL_ORIGIN),
  title: {
    default: "Atai Developers — Developer Portal",
    template: "%s | Atai Developers",
  },
  description:
    "Manage Atai Runtime API keys, monitor usage and health, and test every endpoint live against your real API key in the playground — development and production.",
  alternates: { canonical: "/developers" },
  openGraph: {
    type: "website",
    siteName: "Atai",
    title: "Atai Developers — Developer Portal",
    description:
      "API keys, usage, health, and a live playground for the Atai Runtime API.",
  },
  robots: { index: true, follow: true },
}

/**
 * Developer portal — served at /developers on the canonical app origin.
 * A staging host set via NEXT_PUBLIC_DEV_PORTAL_HOST is rewritten into this
 * same subtree by proxy.ts; nothing is required in production.
 */
export default async function DevelopersLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser()
  if (!user) redirect("/login?next=/developers")

  const projects = await store.listProjects(user.id)

  return (
    <main className="min-h-svh bg-background text-foreground">
      <header className="border-b border-border bg-card/60">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6 sm:px-6 lg:flex-row lg:items-end lg:justify-between lg:px-10">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">Atai Developers</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">Developer Portal</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Keys, usage, health, and a live playground for the Atai Runtime API.
            </p>
          </div>
          {projects.length > 0 ? <ProjectPicker projects={projects.map((p) => ({ id: p.id, name: p.name }))} /> : null}
        </div>
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-10">
          <DeveloperNav isAdmin={Boolean(user.isAdmin)} />
        </div>
      </header>
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-10">{children}</div>
    </main>
  )
}
