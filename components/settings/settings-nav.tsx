"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Bot,
  CreditCard,
  LifeBuoy,
  MessageSquare,
  Palette,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  LayoutGrid,
  Shield,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useSession } from "@/lib/client/api"

type NavItem = { href: string; label: string; description?: string; icon: React.ElementType }
type NavGroup = { label: string; items: NavItem[] }

const GROUPS: NavGroup[] = [
  {
    label: "Account",
    items: [
      { href: "/settings", label: "Overview", description: "Account, security, and usage at a glance", icon: LayoutGrid },
      { href: "/settings/profile", label: "Profile", description: "Name, avatar, and connected accounts", icon: UserRound },
    ],
  },
  {
    label: "Security & privacy",
    items: [
      { href: "/settings/security", label: "Security", description: "Password, email, and active sessions", icon: Shield },
      { href: "/settings/feedback", label: "Feedback & privacy", description: "What diagnostics your reports include", icon: ShieldCheck },
    ],
  },
  {
    label: "Workspace",
    items: [
      { href: "/settings/appearance", label: "Appearance", description: "Theme and visual preferences", icon: Palette },
    ],
  },
  {
    label: "Atai intelligence",
    items: [
      { href: "/settings/ai", label: "AI co-founder", description: "Choose the engine behind your co-founder", icon: Bot },
      { href: "/settings/features", label: "Feature switches", description: "Optional Market & Grow capabilities", icon: SlidersHorizontal },
    ],
  },
  {
    label: "Billing",
    items: [
      { href: "/settings/billing", label: "Billing & credits", description: "Balance, plan, purchases, and history", icon: CreditCard },
    ],
  },
  {
    label: "Support",
    items: [
      { href: "/settings/feedback", label: "Feedback & privacy", description: "Report issues and control diagnostics", icon: MessageSquare },
      { href: "/contributions", label: "Contributions", description: "Your submitted reports and rewards", icon: LifeBuoy },
    ],
  },
]

const ADMIN_GROUP: NavGroup = {
  label: "Admin",
  items: [
    { href: "/admin", label: "Admin dashboard", icon: ShieldCheck },
    { href: "/admin/users", label: "Users", icon: UserRound },
    { href: "/admin/billing", label: "Billing admin", icon: CreditCard },
  ],
}

function isActive(pathname: string, href: string) {
  if (href === "/settings") return pathname === "/settings"
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function SettingsNav() {
  const pathname = usePathname()
  const { session } = useSession()
  const groups = session?.user?.isAdmin ? [...GROUPS, ADMIN_GROUP] : GROUPS
  const allItems = groups.flatMap((g) => g.items)

  return (
    <nav aria-label="Settings" className="lg:sticky lg:top-24 lg:self-start">
      <div className="hidden lg:block">
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Settings</p>
        <div className="mt-4 space-y-6">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">
                {group.label}
              </p>
              <div className="mt-2 space-y-1">
                {group.items.map((item) => {
                  const active = isActive(pathname, item.href)
                  const Icon = item.icon
                  return (
                    <Link
                      key={`${group.label}-${item.href}`}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-start gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                        active
                          ? "bg-primary/10 text-foreground ring-1 ring-primary/20"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      <Icon className={cn("mt-0.5 size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                      <span className="min-w-0">
                        <span className="block font-medium leading-5">{item.label}</span>
                        {item.description ? (
                          <span className="mt-0.5 block text-xs leading-5 text-muted-foreground/80">
                            {item.description}
                          </span>
                        ) : null}
                      </span>
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="lg:hidden">
        <label htmlFor="settings-nav" className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Settings section
        </label>
        <select
          id="settings-nav"
          value={allItems.some((i) => isActive(pathname, i.href)) ? pathname : "/settings"}
          onChange={(e) => {
            window.location.href = e.target.value
          }}
          className="mt-2 w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30"
        >
          {groups.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.items.map((item) => (
                <option key={`${group.label}-${item.href}`} value={item.href}>
                  {item.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {allItems.slice(0, 8).map((item) => {
            const active = isActive(pathname, item.href)
            return (
              <Link
                key={`${item.label}-${item.href}-mobile`}
                href={item.href}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
