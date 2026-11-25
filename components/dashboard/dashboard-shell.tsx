"use client"

import { useEffect, useId, useMemo, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Bell,
  BookOpen,
  Building2,
  Compass,
  EyeOff,
  Gift,
  Home,
  LifeBuoy,
  Lightbulb,
  Lock,
  Menu,
  MessageSquare,
  PanelLeft,
  PanelLeftClose,
  Search,
  Settings,
  Sparkles,
  Wallet,
  X,
} from "lucide-react"
import { BrandLogo } from "@/components/brand-logo"
import { AccountMenu } from "@/components/account-menu"
import { CreditMeter } from "@/components/credit-meter"
import { ThemeToggle } from "@/components/theme-toggle"
import { VerifyEmailBanner } from "@/components/verify-email-banner"
import { DashboardNotifications } from "@/components/dashboard/dashboard-notifications"
import { CofounderPanel, useCofounderPanel } from "@/components/cofounder/cofounder-panel"
import { PageTourLauncher } from "@/components/tour/page-tour-launcher"
import { workspaceGrowNav, workspaceIntelligenceNav, workspaceProjectNav, type AtaiNavItem } from "@/components/workspace/atai-nav"
import { useProjects } from "@/lib/client/api"
import { AuthGate } from "@/components/auth/auth-gate"
import { interpretProjectState, selectActiveProject } from "@/lib/dashboard/view-model"
import { projectIsBuilt } from "@/lib/dashboard/built-states"
import { isConnectedBusiness } from "@/lib/connected-business/guards"
import type { ProjectSummary } from "@/lib/types/project"
import { cn } from "@/lib/utils"

const NAV = [
  { href: "/dashboard", label: "Home", icon: Home, tour: "nav-dashboard" },
  { href: "/cofounder", label: "Co-founder", icon: Sparkles, tour: "nav-cofounder" },
  { href: "/projects", label: "All businesses", icon: Building2, tour: "nav-businesses" },
  { href: "/finances", label: "Finances", icon: Wallet, tour: "nav-finances", requires: "built" },
  { href: "/notifications", label: "Notifications", icon: Bell, tour: "nav-notifications" },
  { href: "/contributions", label: "Contributions", icon: Gift, tour: "nav-contributions" },
  { href: "/new", label: "New business", icon: Sparkles, tour: "nav-new" },
  { href: "/tours", label: "Guided tours", icon: BookOpen, tour: "nav-tours" },
] as const

export type ShellNavItem = (typeof NAV)[number]

/**
 * The main navigation. One entry per destination: built apps and connected
 * businesses are both listed on `/projects`, so a second "Connected business"
 * link would send the founder to the same portfolio from a different name.
 */
export function shellNavigation(): ShellNavItem[] {
  return [...NAV]
}

const DISCOVER_NAV = [
  { href: "/explore", label: "Explore", icon: Compass, tour: "nav-explore" },
  { href: "/feature-requests", label: "Feature requests", icon: Lightbulb, tour: "nav-feature-requests" },
] as const

export function DashboardShell({
  children,
  title = "Home",
  projectId,
}: {
  children: React.ReactNode
  title?: string
  projectId?: string
}) {
  const pathname = usePathname()
  const { projects } = useProjects()
  const resolvedProjectId = projectId ?? pathname.match(/^\/project\/([^/]+)/)?.[1]
  const [collapsed, setCollapsed] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const drawerId = useId()
  const workspaceProject = resolvedProjectId ? projects.find((p) => p.id === resolvedProjectId) ?? null : null
  const active = workspaceProject ?? selectActiveProject(projects)
  const askHref = active ? `/project/${active.id}/collaborate` : "/new"
  const nav = useMemo(() => shellNavigation(), [])
  const hasBuilt = projects.some((p) => projectIsBuilt(p.state))
  // A connected business is a real business even though Atai did not build it.
  const hasRealBusiness = projects.some((p) => projectIsBuilt(p.state) || isConnectedBusiness(p))

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  useEffect(() => {
    try {
      const raw = localStorage.getItem("atai.sidebar")
      if (!raw) return
      const parsed = JSON.parse(raw) as { collapsed?: boolean; hidden?: boolean }
      if (typeof parsed.collapsed === "boolean") setCollapsed(parsed.collapsed)
      if (typeof parsed.hidden === "boolean") setHidden(parsed.hidden)
    } catch {
      // ignore malformed preference
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem("atai.sidebar", JSON.stringify({ collapsed, hidden }))
    } catch {
      // storage unavailable
    }
  }, [collapsed, hidden])

  return (
    <AuthGate next={pathname || "/dashboard"}>
    <div className="min-h-svh bg-background text-foreground">
      <CofounderPanel />
      <div className="flex min-h-svh">
        {!hidden ? (
        <aside
          className={cn(
            "sticky top-0 hidden h-svh shrink-0 flex-col border-r border-border bg-card/40 md:flex",
            collapsed ? "w-[4.25rem]" : "w-60",
          )}
        >
          <SidebarBody
            collapsed={collapsed}
            pathname={pathname}
            active={active}
            askHref={askHref}
            projectId={resolvedProjectId}
            workspaceName={title}
            hasBuilt={hasBuilt}
            hasRealBusiness={hasRealBusiness}
            nav={nav}
          />
          <div className={cn("flex items-center gap-1 border-t border-border p-2", collapsed && "flex-col")}>
            <button
              type="button"
              data-atai-tour="nav-collapse"
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-border p-2 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setCollapsed((v) => !v)}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? <PanelLeft className="size-4" /> : <PanelLeftClose className="size-4" />}
              {!collapsed ? <span className="text-xs">Collapse</span> : null}
            </button>
            <button
              type="button"
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-border p-2 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setHidden(true)}
              aria-label="Hide sidebar"
              title="Hide sidebar"
            >
              <EyeOff className="size-4" />
              {!collapsed ? <span className="text-xs">Hide</span> : null}
            </button>
          </div>
        </aside>
        ) : null}

        {mobileOpen ? (
          <div className="fixed inset-0 z-40 md:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-background/70"
              aria-label="Close navigation"
              onClick={() => setMobileOpen(false)}
            />
            <aside
              id={drawerId}
              className="relative z-50 flex h-full w-72 flex-col border-r border-border bg-background shadow-lg"
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
            >
              <div className="flex items-center justify-between px-4 py-3">
                <BrandLogo size={28} href="/dashboard" />
                <button
                  type="button"
                  className="rounded-lg p-2 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setMobileOpen(false)}
                  aria-label="Close navigation"
                >
                  <X className="size-4" />
                </button>
              </div>
              <SidebarBody collapsed={false} pathname={pathname} active={active} askHref={askHref} projectId={resolvedProjectId} workspaceName={title} hasBuilt={hasBuilt} hasRealBusiness={hasRealBusiness} nav={nav} />
            </aside>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
            <div className="flex items-center justify-between gap-2 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3 lg:px-6">
              <div className="flex min-w-0 items-center gap-3">
                {hidden ? (
                  <button
                    type="button"
                    className="hidden size-9 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:grid"
                    onClick={() => setHidden(false)}
                    aria-label="Show sidebar"
                    title="Show sidebar"
                  >
                    <PanelLeft className="size-4" />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="shrink-0 rounded-lg border border-border p-2 md:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-expanded={mobileOpen}
                  aria-controls={drawerId}
                  onClick={() => setMobileOpen(true)}
                >
                  <Menu className="size-4" />
                  <span className="sr-only">Open navigation</span>
                </button>
                <div className="min-w-0">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Atai</p>
                  <h1 className="truncate text-sm font-semibold sm:text-base">{title}</h1>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                {resolvedProjectId ? <WorkspaceAskButton /> : <ProjectSearch projects={projects} />}
                <Link
                  href="/tours"
                  data-atai-tour="nav-tours"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  title="Guided tours"
                >
                  <Compass className="size-3.5" aria-hidden />
                  <span className="hidden sm:inline">Tours</span>
                  <span className="sr-only sm:hidden">Guided tours</span>
                </Link>
                <Link
                  href="/docs"
                  data-atai-tour="nav-help"
                  className="hidden rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground sm:inline-flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Help
                </Link>
                <DashboardNotifications />
                <div className="hidden lg:block" data-atai-tour="header-credits">
                  <CreditMeter />
                </div>
                <ThemeToggle />
                <AccountMenu />
              </div>
            </div>
            <VerifyEmailBanner />
          </header>
          <PageTourLauncher />
          <div className="flex-1">{children}</div>
        </div>
      </div>
    </div>
    </AuthGate>
  )
}

function SidebarLink({
  item,
  pathname,
  collapsed,
  locked = { built: false, business: false },
}: {
  item: Pick<AtaiNavItem, "href" | "label" | "icon" | "match" | "requires" | "tour">
  pathname: string
  collapsed: boolean
  locked?: { built: boolean; business: boolean }
}) {
  const activeNav = item.match
    ? item.match(pathname)
    : pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href))
  const Icon = item.icon
  const showLock =
    item.requires === "built" ? locked.built : item.requires === "business" ? locked.business : false
  return (
    <Link
      href={item.href}
      data-atai-tour={item.tour}
      title={showLock ? `${item.label} — unlocks once you have a built application` : item.label}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        collapsed && "justify-center px-0",
        showLock && "opacity-60",
        activeNav ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      {collapsed ? (
        <span className="sr-only">{showLock ? `${item.label} (locked)` : item.label}</span>
      ) : (
        <span className="flex-1 truncate">{item.label}</span>
      )}
      {showLock && !collapsed ? (
        <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          <Lock className="size-3" aria-hidden /> Locked
        </span>
      ) : null}
      {showLock && collapsed ? (
        <Lock className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      ) : null}
    </Link>
  )
}

function SidebarBody({
  collapsed,
  pathname,
  active,
  askHref,
  projectId,
  workspaceName,
  hasBuilt,
  hasRealBusiness,
  nav,
}: {
  collapsed: boolean
  pathname: string
  active: ProjectSummary | null
  askHref: string
  projectId?: string
  workspaceName?: string
  hasBuilt: boolean
  hasRealBusiness: boolean
  nav: readonly ShellNavItem[]
}) {
  if (projectId) {
    const tools = workspaceProjectNav(projectId)
    const intelligence = workspaceIntelligenceNav(projectId)
    const grow = workspaceGrowNav(projectId)
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-4">
        <div className={cn("px-1", collapsed && "flex justify-center")}>
          <BrandLogo size={28} href="/dashboard" withWordmark={!collapsed} />
        </div>
        {!collapsed ? (
          <div className="rounded-xl border border-border bg-background px-3 py-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">This workspace</p>
            <p className="mt-1 truncate text-sm font-medium">{active?.name ?? workspaceName ?? "Workspace"}</p>
          </div>
        ) : null}
        <nav className="flex flex-col gap-1" aria-label="Workspace">
          <SidebarLink item={{ href: "/dashboard", label: "Dashboard", icon: Home, tour: "nav-dashboard", match: (p) => p === "/dashboard" }} pathname={pathname} collapsed={collapsed} />
          <SidebarLink item={{ href: "/finances", label: "All business finances", icon: Wallet, match: (p) => p === "/finances", requires: "built" }} pathname={pathname} collapsed={collapsed} locked={{ built: !hasBuilt, business: !hasRealBusiness }} />
        </nav>
        <nav className="flex flex-col gap-1" aria-label="Project tools">
          {!collapsed ? (
            <p className="px-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Project tools</p>
          ) : null}
          {tools.map((item) => (
            <SidebarLink key={item.href} item={item} pathname={pathname} collapsed={collapsed} locked={{ built: !hasBuilt, business: !hasRealBusiness }} />
          ))}
        </nav>
        <nav className="flex flex-col gap-1" aria-label="Application intelligence">
          {!collapsed ? (
            <p className="px-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Application intelligence</p>
          ) : null}
          {intelligence.map((item) => (
            <SidebarLink key={item.href} item={item} pathname={pathname} collapsed={collapsed} locked={{ built: !hasBuilt, business: !hasRealBusiness }} />
          ))}
        </nav>
        <nav className="flex flex-col gap-1" aria-label="Grow your business">
          {!collapsed ? (
            <p className="px-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Grow your business</p>
          ) : null}
          {grow.map((item) => {
            const Icon = item.icon
            const activeNav = pathname === item.href || pathname.startsWith(`${item.href}/`)
            const showLock =
            item.requires === "built" ? !hasBuilt : item.requires === "business" ? !hasRealBusiness : false
            return (
              <Link
                key={item.href}
                href={item.href}
                data-atai-tour={item.tour}
                title={showLock ? `${item.label} — unlocks once you have a built application` : item.label}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  collapsed && "justify-center px-0",
                  showLock && "opacity-60",
                  activeNav ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {collapsed ? (
                  <span className="sr-only">{showLock ? `${item.label} (locked)` : item.label}</span>
                ) : (
                  <span className="flex-1 truncate">{item.label}</span>
                )}
                {!collapsed && showLock ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    <Lock className="size-3" aria-hidden /> Locked
                  </span>
                ) : null}
                {collapsed && showLock ? <Lock className="size-3 shrink-0 text-muted-foreground" aria-hidden /> : null}
                {!collapsed && item.kind === "soon" ? (
                  <span className="rounded-full bg-muted px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-muted-foreground">Soon</span>
                ) : null}
              </Link>
            )
          })}
        </nav>
        {/* The top-bar Help link is hidden on a narrow screen, and inside a
            business there is no bottom block — so without this, a phone founder
            cannot reach the guides at all. */}
        <div className="mt-auto flex flex-col gap-1">
          <SidebarLink item={{ href: "/docs", label: "Help & support", icon: LifeBuoy, tour: "nav-help", match: (p) => p === "/docs" }} pathname={pathname} collapsed={collapsed} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-4">
      <div className={cn("px-1", collapsed && "flex justify-center")}>
        <BrandLogo size={28} href="/dashboard" withWordmark={!collapsed} />
      </div>

      {!collapsed && active ? (
        <div className="rounded-xl border border-border bg-background px-3 py-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Current business</p>
          <p className="mt-1 truncate text-sm font-medium">{active.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {interpretProjectState(active.state, active.id).founderLabel}
          </p>
        </div>
      ) : null}

      <nav className="flex flex-col gap-1" aria-label="Primary">
        {nav.map((item) => (
          <SidebarLink key={item.href} item={item} pathname={pathname} collapsed={collapsed} locked={{ built: !hasBuilt, business: !hasRealBusiness }} />
        ))}
      </nav>

      <nav className="flex flex-col gap-1" aria-label="Discover">
        {!collapsed ? (
          <p className="px-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Discover</p>
        ) : null}
        {DISCOVER_NAV.map((item) => (
          <SidebarLink key={item.href} item={item} pathname={pathname} collapsed={collapsed} />
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-1">
        <Link
          href="/docs"
          data-atai-tour="nav-help"
          className={cn(
            "inline-flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            collapsed && "justify-center px-0",
          )}
        >
          <LifeBuoy className="size-4" />
          {collapsed ? <span className="sr-only">Help & support</span> : "Help & support"}
        </Link>
        <Link
          href="/settings"
          data-atai-tour="nav-settings"
          className={cn(
            "inline-flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            collapsed && "justify-center px-0",
          )}
        >
          <Settings className="size-4" />
          {collapsed ? <span className="sr-only">Settings</span> : "Settings"}
        </Link>
        <Link
          href={askHref}
          data-atai-tour="nav-ask"
          className={cn(
            "inline-flex items-center gap-2 rounded-lg bg-primary px-2.5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            collapsed && "justify-center px-0",
          )}
        >
          <MessageSquare className="size-4" />
          {collapsed ? <span className="sr-only">Ask Atai</span> : "Ask Atai"}
        </Link>
      </div>
    </div>
  )
}

function WorkspaceAskButton() {
  const { open } = useCofounderPanel()
  return (
    <button
      type="button"
      onClick={() => open()}
      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
    >
      <Sparkles className="size-3.5" />
      <span className="hidden sm:inline">Ask your AI co-founder</span>
      <span className="sm:hidden">Ask</span>
    </button>
  )
}

function ProjectSearch({ projects }: { projects: ProjectSummary[] }) {
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const matches = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (!query) return []
    return projects.filter((p) => p.name.toLowerCase().includes(query)).slice(0, 8)
  }, [projects, q])

  return (
    <div className="relative hidden md:block">
      <label className="sr-only" htmlFor="dashboard-search">
        Search businesses
      </label>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5">
        <Search className="size-3.5 text-muted-foreground" />
        <input
          id="dashboard-search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Find a business"
          className="w-40 bg-transparent text-sm outline-none lg:w-52"
        />
      </div>
      {open && q.trim() ? (
        <ul className="absolute right-0 z-40 mt-1 w-64 rounded-xl border border-border bg-popover p-1 shadow-lg">
          {matches.length === 0 ? (
            <li className="px-2 py-2 text-sm text-muted-foreground">No matching businesses</li>
          ) : (
            matches.map((project) => (
              <li key={project.id}>
                <Link
                  href={`/project/${project.id}`}
                  className="block rounded-lg px-2 py-2 text-sm hover:bg-accent"
                >
                  {project.name}
                </Link>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  )
}
