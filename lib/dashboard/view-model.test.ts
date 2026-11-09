import { describe, expect, it } from "vitest"
import type { ProjectSummary } from "@/lib/types/project"
import {
  buildNotificationInbox,
  filterMeaningfulActivity,
  getDashboardAttentionItems,
  interpretProjectState,
  selectActiveProject,
  selectNotifications,
  type InboxItem,
} from "./view-model"

function project(partial: Partial<ProjectSummary> & Pick<ProjectSummary, "id" | "state">): ProjectSummary {
  return {
    name: partial.name ?? partial.id,
    mode: "scratch",
    updatedAt: partial.updatedAt ?? 1,
    ...partial,
  }
}

describe("interpretProjectState", () => {
  it("maps plan_ready to review CTA without exposing raw state", () => {
    const status = interpretProjectState("plan_ready", "p1")
    expect(status.founderLabel).toBe("Plan ready")
    expect(status.primaryAction.href).toContain("/collaborate")
    expect(status.headline.toLowerCase()).not.toContain("plan_ready")
  })

  it("surfaces build failure as an error with a fix path", () => {
    const status = interpretProjectState("build_failed", "p1")
    expect(status.severity).toBe("error")
    expect(status.primaryAction.href).toContain("/edit")
  })
})

describe("selectActiveProject", () => {
  it("prefers failures over newest", () => {
    const active = selectActiveProject([
      project({ id: "new", state: "created", updatedAt: 99 }),
      project({ id: "fail", state: "build_failed", updatedAt: 1 }),
    ])
    expect(active?.id).toBe("fail")
  })

  it("prefers plan review over idle newest", () => {
    const active = selectActiveProject([
      project({ id: "idle", state: "created", updatedAt: 50 }),
      project({ id: "plan", state: "plan_ready", updatedAt: 10 }),
    ])
    expect(active?.id).toBe("plan")
  })
})

describe("getDashboardAttentionItems", () => {
  it("includes email verification and failed builds", () => {
    const items = getDashboardAttentionItems({
      emailVerified: false,
      projects: [project({ id: "a", name: "Marketly", state: "build_failed" })],
    })
    expect(items.some((i) => i.id === "email")).toBe(true)
    expect(items.some((i) => i.id === "build-fail-a")).toBe(true)
  })
})

describe("buildNotificationInbox", () => {
  it("surfaces failed builds and live work as actionable inbox items", () => {
    const items = buildNotificationInbox({
      emailVerified: true,
      now: 20,
      projects: [
        project({ id: "fail", name: "Marketly", state: "build_failed", updatedAt: 10 }),
        project({ id: "build", name: "Ledger", state: "building", updatedAt: 12 }),
      ],
    })
    expect(items.some((i) => i.id === "build-fail-fail" && i.kind === "action")).toBe(true)
    expect(items.some((i) => i.id.startsWith("progress-build") && i.href.includes("/project/build"))).toBe(true)
  })

  it("includes shipped feature requests without inventing extra scores", () => {
    const items = buildNotificationInbox({
      emailVerified: true,
      now: 50,
      projects: [],
      featureRequests: [{ id: "fr1", title: "Custom models", status: "shipped", updatedAt: 40 }],
    })
    expect(items[0]?.href).toBe("/feature-requests/fr1")
    expect(items[0]?.title.toLowerCase()).toContain("shipped")
  })
})

function inboxItem(partial: Partial<InboxItem> & Pick<InboxItem, "id">): InboxItem {
  return {
    at: 1,
    title: "Update",
    description: "",
    href: "/dashboard",
    actionLabel: "Open",
    severity: "info",
    kind: "update",
    ...partial,
  }
}

const NOTIF_FIXTURE = [
  inboxItem({ id: "old-read", at: 10, title: "Ledger: plan shipped", severity: "success" }),
  inboxItem({ id: "new-unread", at: 30, title: "Marketly failed to build", severity: "error", kind: "action" }),
  inboxItem({ id: "mid-unread", at: 20, title: "Ledger is deploying", kind: "progress" }),
]

describe("selectNotifications", () => {
  const none = { read: new Set<string>(), dismissed: new Set<string>() }

  it("gives the header preview three items, newest unseen first", () => {
    const preview = selectNotifications({
      items: [...NOTIF_FIXTURE, inboxItem({ id: "extra", at: 5 })],
      ...none,
      sort: "newest",
      preferUnread: true,
      limit: 3,
    })
    expect(preview.map((i) => i.id)).toEqual(["new-unread", "mid-unread", "old-read"])
  })

  it("hides dismissed items and surfaces them again on the dismissed tab", () => {
    const dismissed = new Set(["mid-unread"])
    const live = selectNotifications({ items: NOTIF_FIXTURE, read: new Set(), dismissed })
    expect(live.map((i) => i.id)).toEqual(["new-unread", "old-read"])
    const rest = selectNotifications({ items: NOTIF_FIXTURE, read: new Set(), dismissed, tab: "dismissed" })
    expect(rest.map((i) => i.id)).toEqual(["mid-unread"])
  })

  it("brings a restored item back into the live inbox", () => {
    const withDismissal = selectNotifications({
      items: NOTIF_FIXTURE,
      read: new Set(),
      dismissed: new Set(["mid-unread"]),
    })
    const afterRestore = selectNotifications({ items: NOTIF_FIXTURE, ...none, sort: "newest" })
    expect(withDismissal.map((i) => i.id)).toEqual(["new-unread", "old-read"])
    expect(afterRestore.map((i) => i.id)).toEqual(["new-unread", "mid-unread", "old-read"])
  })

  it("searches title, description and action, and sorts by time or priority", () => {
    const hits = selectNotifications({ items: NOTIF_FIXTURE, ...none, search: "ledger" })
    expect(hits.map((i) => i.id)).toEqual(["mid-unread", "old-read"])
    expect(selectNotifications({ items: NOTIF_FIXTURE, ...none, sort: "oldest" }).map((i) => i.at)).toEqual([10, 20, 30])
    expect(
      selectNotifications({ items: NOTIF_FIXTURE, ...none, sort: "priority" })[0]?.id,
    ).toBe("new-unread")
  })

  it("splits unread from the rest of the inbox", () => {
    const unread = selectNotifications({
      items: NOTIF_FIXTURE,
      read: new Set(["old-read"]),
      dismissed: new Set(),
      tab: "unread",
    })
    expect(unread.map((i) => i.id)).toEqual(["new-unread", "mid-unread"])
  })
})

describe("filterMeaningfulActivity", () => {
  it("drops heartbeat noise", () => {
    const items = filterMeaningfulActivity(
      [
        { id: "1", at: 2, level: "info", stage: "heartbeat", message: "ok" },
        { id: "2", at: 3, level: "info", stage: "build", message: "Build completed" },
      ],
      project({ id: "a", name: "Marketly", state: "ready" }),
    )
    expect(items).toHaveLength(1)
    expect(items[0]!.title).toBe("Build completed")
  })
})
