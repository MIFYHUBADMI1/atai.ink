"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import useSWR from "swr"
import { Bug, EyeOff, MessageSquareWarning, RotateCcw, Sparkles, X } from "lucide-react"
import { useSession, jsonFetcher } from "@/lib/client/api"
import { useCofounderPanel } from "@/components/cofounder/cofounder-panel"
import { CofounderPanel } from "@/components/cofounder/cofounder-panel"
import { FeedbackReportModal } from "@/components/feedback/feedback-report-modal"
import { installDiagnosticsCapture } from "@/lib/feedback/diagnostics"
import { launcherAllowed } from "@/lib/feedback/privacy"
import { cn } from "@/lib/utils"

/**
 * Atai Feedback Hub — global draggable launcher.
 *
 * Mounted once in the root layout; renders only for signed-in users on
 * eligible app routes (admin, auth, and public marketing pages are excluded).
 * Dragging uses Pointer Events so mouse + touch share one path. Position and
 * hidden-state persist per viewport class (mobile/desktop) in localStorage —
 * there is no server-side preference store for arbitrary UI geometry.
 */

const POS_KEY = "atai:feedback-launcher"
const HIDDEN_KEY = "atai:feedback-launcher:hidden"
const DRAG_THRESHOLD = 6
const EDGE_MARGIN = 12

/** Routes where the launcher must never appear. */
const EXCLUDED_EXACT = new Set([
  "/", "/about", "/pricing", "/privacy", "/terms", "/refund-policy",
  "/database-terms", "/blog", "/docs", "/developers", "/sdk",
  "/modes-comparison", "/seo", "/explore", "/founder", "/feature-requests",
  "/resources", "/lessons", "/indexnow", "/new",
])
const EXCLUDED_PREFIXES = [
  "/admin", "/login", "/register", "/forgot-password", "/reset-password",
  "/verify-email", "/confirm-email-change", "/public/", "/llms",
]

function isEligiblePath(pathname: string): boolean {
  if (!pathname) return false
  if (EXCLUDED_EXACT.has(pathname)) return false
  return !EXCLUDED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))
}

type Pos = { x: number; y: number }
type ViewportClass = "mobile" | "desktop"

function viewportClass(): ViewportClass {
  return typeof window !== "undefined" && window.innerWidth < 768 ? "mobile" : "desktop"
}

function defaultPos(vc: ViewportClass): Pos {
  if (typeof window === "undefined") return { x: 0, y: 0 }
  return vc === "mobile"
    ? { x: window.innerWidth - 64, y: window.innerHeight - 140 }
    : { x: window.innerWidth - 88, y: window.innerHeight - 88 }
}

function clampPos(p: Pos, vc: ViewportClass): Pos {
  if (typeof window === "undefined") return p
  const size = vc === "mobile" ? 56 : 48
  return {
    x: Math.min(Math.max(EDGE_MARGIN, p.x), Math.max(EDGE_MARGIN, window.innerWidth - size - EDGE_MARGIN)),
    y: Math.min(Math.max(EDGE_MARGIN, p.y), Math.max(EDGE_MARGIN, window.innerHeight - size - EDGE_MARGIN)),
  }
}

function loadPos(): Partial<Record<ViewportClass, Pos>> {
  try {
    const raw = localStorage.getItem(POS_KEY)
    return raw ? (JSON.parse(raw) as Partial<Record<ViewportClass, Pos>>) : {}
  } catch {
    return {}
  }
}

function savePos(pos: Partial<Record<ViewportClass, Pos>>) {
  try { localStorage.setItem(POS_KEY, JSON.stringify(pos)) } catch { /* quota */ }
}

function loadHidden(): boolean {
  try { return localStorage.getItem(HIDDEN_KEY) === "1" } catch { return false }
}
function saveHidden(v: boolean) {
  try { localStorage.setItem(HIDDEN_KEY, v ? "1" : "0") } catch { /* quota */ }
}

interface FeedbackConfig {
  enabled: boolean
  bugReportsEnabled: boolean
  cofounderShortcutEnabled: boolean
}

export function AtaiFeedbackLauncher() {
  const pathname = usePathname()
  const { session, isLoading: sessionLoading } = useSession()
  const { open: openCofounder } = useCofounderPanel()
  const { data: config } = useSWR<FeedbackConfig>(session ? "/api/feedback/config" : null, jsonFetcher)

  const [vc, setVc] = useState<ViewportClass>("desktop")
  const [pos, setPos] = useState<Pos>({ x: 0, y: 0 })
  const [hydrated, setHydrated] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [prefEnabled, setPrefEnabled] = useState(true)
  const [hubOpen, setHubOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [moved, setMoved] = useState(false)

  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number; active: boolean } | null>(null)
  const suppressClick = useRef(false)

  const signedIn = Boolean(session?.user ?? session?.userId)
  const eligible = isEligiblePath(pathname ?? "")
  const enabled = config?.enabled !== false

  // Hydrate persisted position/hidden state + install diagnostic capture.
  useEffect(() => {
    installDiagnosticsCapture()
    const v = viewportClass()
    setVc(v)
    const saved = loadPos()
    setPos(clampPos(saved[v] ?? defaultPos(v), v))
    setHidden(loadHidden())
    setPrefEnabled(launcherAllowed())
    setHydrated(true)

    const onPrivacy = () => setPrefEnabled(launcherAllowed())
    window.addEventListener("atai:feedback-privacy-changed", onPrivacy)

    const onResize = () => {
      const nv = viewportClass()
      setVc((prev) => {
        if (prev !== nv) {
          const saved2 = loadPos()
          setPos(clampPos(saved2[nv] ?? defaultPos(nv), nv))
        }
        return nv
      })
      setPos((p) => clampPos(p, nv))
    }
    window.addEventListener("resize", onResize)
    return () => {
      window.removeEventListener("resize", onResize)
      window.removeEventListener("atai:feedback-privacy-changed", onPrivacy)
    }
  }, [])

  // Re-clamp when viewport class data is available.
  useEffect(() => {
    if (hydrated) setPos((p) => clampPos(p, vc))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vc, hydrated])

  const persistPos = useCallback((p: Pos) => {
    const all = loadPos()
    all[vc] = p
    savePos(all)
  }, [vc])

  const setHiddenPersist = useCallback((v: boolean) => {
    setHidden(v)
    saveHidden(v)
    if (v) setHubOpen(false)
  }, [])

  // ── Drag handling (Pointer Events: mouse + touch unified) ──
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y, active: false }
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }, [pos])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.active && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    d.active = true
    setMoved(true)
    setDragging(true)
    setPos(clampPos({ x: d.origX + dx, y: d.origY + dy }, vc))
  }, [vc])

  const onPointerUp = useCallback(() => {
    const d = dragRef.current
    dragRef.current = null
    setDragging(false)
    if (d?.active) {
      setPos((p) => {
        const c = clampPos(p, vc)
        persistPos(c)
        return c
      })
      // Suppress the click that follows a drag so it doesn't toggle the hub.
      suppressClick.current = true
      window.setTimeout(() => { suppressClick.current = false }, 0)
    }
  }, [persistPos, vc])

  const toggleHub = useCallback(() => {
    if (suppressClick.current || moved) {
      setMoved(false)
      return
    }
    setHubOpen((v) => !v)
  }, [moved])

  useEffect(() => {
    if (!hubOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setHubOpen(false) }
    const onDown = (e: PointerEvent) => {
      const el = (e.target as HTMLElement).closest?.("[data-feedback-hub]")
      if (!el) setHubOpen(false)
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("pointerdown", onDown)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("pointerdown", onDown)
    }
  }, [hubOpen])

  if (!hydrated || sessionLoading || !signedIn || !eligible || !enabled || !prefEnabled) return null

  const showBug = config?.bugReportsEnabled !== false
  const showCofounder = config?.cofounderShortcutEnabled !== false

  // Hidden state → small restore tab at the bottom-right.
  if (hidden) {
    return (
      <button
        type="button"
        onClick={() => setHiddenPersist(false)}
        className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground shadow-lg transition-colors hover:text-foreground"
        style={{ bottom: "calc(1rem + env(safe-area-inset-bottom))" }}
        aria-label="Restore feedback button"
      >
        <RotateCcw className="size-3.5" /> Feedback
      </button>
    )
  }

  const size = vc === "mobile" ? 56 : 48

  return (
    <>
      {/* Ensures a co-founder panel exists on every eligible page so the hub's
          secondary action always opens the real experience. */}
      <CofounderPanel />

      <div
        data-feedback-hub
        className={cn(
          "fixed z-40 select-none",
          dragging ? "cursor-grabbing" : "cursor-grab",
        )}
        style={{
          left: pos.x,
          top: pos.y,
          width: size,
          height: size,
          touchAction: "none",
        }}
      >
        {/* Hub popover */}
        {hubOpen ? (
          <div
            className={cn(
              "absolute bottom-full right-0 mb-3 w-72 origin-bottom-right rounded-xl border border-border bg-popover p-2 shadow-xl",
              "animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-200",
            )}
            role="menu"
            aria-label="Atai assistant"
          >
            {showBug ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => { setHubOpen(false); setReportOpen(true) }}
                className="flex w-full items-start gap-3 rounded-lg p-3 text-left transition-colors hover:bg-accent"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
                  <Bug className="size-4" />
                </span>
                <span>
                  <span className="block text-sm font-semibold">Report a bug or issue</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Tell us about something that isn&apos;t working correctly.
                  </span>
                </span>
              </button>
            ) : null}
            {showCofounder ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => { setHubOpen(false); openCofounder() }}
                className="flex w-full items-start gap-3 rounded-lg p-3 text-left transition-colors hover:bg-accent"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
                  <Sparkles className="size-4" />
                </span>
                <span>
                  <span className="block text-sm font-semibold">Talk to my AI Co-founder</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Get business guidance and assistance.
                  </span>
                </span>
              </button>
            ) : null}
            <div className="mt-1 border-t border-border pt-1">
              <button
                type="button"
                onClick={() => { setHubOpen(false); setHiddenPersist(true) }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <EyeOff className="size-3.5" /> Hide launcher
              </button>
            </div>
          </div>
        ) : null}

        {/* Launcher button — distinct feedback per interaction:
            hover → lift + glow, press/touch → squash, drag → tilt + shadow,
            click → pulse ring, open → stays raised. */}
        <button
          type="button"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClick={toggleHub}
          aria-label="Atai assistant — report an issue or talk to your co-founder"
          aria-expanded={hubOpen}
          aria-haspopup="menu"
          title="Atai assistant"
          className={cn(
            "group/launcher relative grid size-full place-items-center rounded-full border shadow-lg",
            "border-primary/30 bg-gradient-to-br from-primary to-primary/80 text-primary-foreground",
            "transition-all duration-200 ease-out",
            "hover:-translate-y-0.5 hover:scale-110 hover:shadow-xl hover:shadow-primary/25",
            "hover:ring-4 hover:ring-primary/15",
            "active:scale-90 active:shadow-md",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            dragging && "scale-115 -rotate-6 cursor-grabbing shadow-2xl shadow-primary/30 ring-4 ring-primary/20",
            hubOpen && "scale-105 shadow-xl ring-2 ring-ring",
          )}
        >
          {/* Cursor-follow glow */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full bg-white/0 transition-all duration-300 group-hover/launcher:bg-white/10"
          />
          {hubOpen ? (
            <X className="size-5 transition-transform duration-200" />
          ) : (
            <MessageSquareWarning className="size-5 transition-transform duration-300 group-hover/launcher:rotate-12 group-hover/launcher:scale-110" />
          )}
          {/* Pulse ring on open */}
          {hubOpen ? (
            <span aria-hidden className="absolute inset-0 animate-ping rounded-full border-2 border-primary/40" />
          ) : null}
        </button>
      </div>

      <FeedbackReportModal open={reportOpen} onOpenChange={setReportOpen} />
    </>
  )
}
