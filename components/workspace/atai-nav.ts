import type { LucideIcon } from "lucide-react"
import {
  BookOpen,
  Code2,
  Compass,
  Database,
  Download,
  FileText,
  FolderKanban,
  Globe,
  GraduationCap,
  LayoutDashboard,
  ListChecks,
  LifeBuoy,
  Lightbulb,
  Megaphone,
  Pencil,
  Server,
  Settings,
  Sparkles,
  LineChart,
  Swords,
  Target,
  TrendingUp,
  Wallet,
} from "lucide-react"

export type AtaiNavKind = "link" | "soon" | "cofounder"

export interface AtaiNavItem {
  href: string
  label: string
  icon: LucideIcon
  kind: AtaiNavKind
  match?: (pathname: string) => boolean
  /** Guided-tour anchor id — must exist in lib/tour/targets.ts and on this link. */
  tour?: string
  /** Workspace section that only opens once the founder has a built/live app. */
  requiresBuilt?: boolean
}

export interface AtaiNavGroup {
  label: string
  items: AtaiNavItem[]
}

export function workspaceProjectNav(projectId: string): AtaiNavItem[] {
  const root = `/project/${projectId}`
  return [
    { href: root, label: "Workspace", icon: LayoutDashboard, kind: "link", tour: "nav-project-workspace", match: (pathname) => pathname === root },
    { href: `${root}/progress`, label: "Team progress", icon: ListChecks, kind: "link", tour: "nav-project-progress" },
    { href: `${root}/collaborate`, label: "Collaborate", icon: Sparkles, kind: "link", tour: "nav-project-collaborate" },
    { href: `${root}/plan`, label: "Plan", icon: FileText, kind: "link", tour: "nav-project-plan" },
    { href: `${root}/edit`, label: "Edit app", icon: Pencil, kind: "link", tour: "nav-project-edit", requiresBuilt: true },
    { href: `${root}/source`, label: "Source", icon: Code2, kind: "link", tour: "nav-project-source", requiresBuilt: true },
    { href: `${root}/runtime`, label: "Runtime", icon: Server, kind: "link", tour: "nav-project-runtime", requiresBuilt: true },
    { href: `${root}/database`, label: "Database", icon: Database, kind: "link", tour: "nav-project-database", requiresBuilt: true },
    { href: `${root}/env`, label: "Environment", icon: Settings, kind: "link", tour: "nav-project-env", requiresBuilt: true },
    { href: `${root}/hosting`, label: "Hosting", icon: Globe, kind: "link", tour: "nav-project-hosting", requiresBuilt: true },
    { href: `/api/projects/${projectId}/export`, label: "Export snapshot", icon: Download, kind: "link", tour: "nav-project-export", match: () => false, requiresBuilt: true },
  ]
}

/**
 * Application Intelligence section (its own product area — separate from
 * Marketing & Monetization's grow nav). Sections activate as their data
 * pipelines land; deferred entries stay "soon" rather than rendering fake
 * capability, per the workspace nav convention.
 */
export function workspaceIntelligenceNav(projectId: string): AtaiNavItem[] {
  const root = `/project/${projectId}/intelligence`
  return [
    { href: root, label: "Intelligence", icon: LineChart, kind: "link", tour: "nav-project-intelligence", match: (p) => p === root || p.startsWith(`${root}/`), requiresBuilt: true },
  ]
}

export function workspaceGrowNav(projectId: string): AtaiNavItem[] {
  return [
    { href: `/project/${projectId}/market`, label: "Market & grow", icon: TrendingUp, kind: "link", tour: "nav-project-market", requiresBuilt: true },
    { href: `/project/${projectId}/ads`, label: "Ads & Growth", icon: Megaphone, kind: "link", tour: "nav-project-ads", requiresBuilt: true },
    { href: `/project/${projectId}/campaigns`, label: "Campaigns", icon: Target, kind: "link", tour: "nav-project-campaigns", requiresBuilt: true },
    { href: `/project/${projectId}/finances`, label: "Business finances", icon: Wallet, kind: "link", tour: "nav-project-finances", requiresBuilt: true },
    { href: `/project/${projectId}/lessons`, label: "Business lessons", icon: GraduationCap, kind: "link", tour: "nav-project-lessons", requiresBuilt: true },
    { href: `/project/${projectId}/resources`, label: "Resources", icon: BookOpen, kind: "link", tour: "nav-project-resources", requiresBuilt: true },
    { href: `/project/${projectId}/competition`, label: "Competition", icon: Swords, kind: "link", tour: "nav-project-competition", requiresBuilt: true },
  ]
}

export function ataiNav(projectId?: string): AtaiNavGroup[] {
  const competitionHref = projectId ? `/project/${projectId}/competition` : "/competition"
  const hostingHref = projectId ? `/project/${projectId}/hosting` : "/hosting"

  return [
    {
      label: "Atai",
      items: [
        { href: "/dashboard", label: "Home", icon: LayoutDashboard, kind: "link", match: (p) => p === "/dashboard" },
        { href: "/explore", label: "Explore", icon: Compass, kind: "link" },
        { href: "/feature-requests", label: "Feature requests", icon: Lightbulb, kind: "link" },
        { href: "#cofounder", label: "Co-founder", icon: Sparkles, kind: "cofounder" },
      ],
    },
    {
      label: "My business",
      items: [
        { href: "/projects", label: "All projects", icon: FolderKanban, kind: "link", match: (p) => p === "/projects" || p.startsWith("/project/") },
        { href: competitionHref, label: "Competition", icon: Swords, kind: "link" },
      ],
    },
    {
      label: "Business & growth",
      items: [
        { href: "/market", label: "Market & grow", icon: TrendingUp, kind: "soon" },
        { href: "/ads", label: "Ads & Growth", icon: Megaphone, kind: "link" },
        { href: "/finances", label: "Business finances", icon: Wallet, kind: "link", match: (p) => p === "/finances" },
        { href: "/lessons", label: "Business lessons", icon: GraduationCap, kind: "link" },
        { href: "/resources", label: "Resources", icon: BookOpen, kind: "link" },
      ],
    },
    {
      label: "Infrastructure",
      items: [{ href: hostingHref, label: "Hosting", icon: Server, kind: projectId ? "link" : "soon" }],
    },
    {
      label: "Account",
      items: [
        { href: "/settings", label: "Settings", icon: Settings, kind: "link" },
        { href: "/docs", label: "Help & support", icon: LifeBuoy, kind: "link" },
      ],
    },
  ]
}
