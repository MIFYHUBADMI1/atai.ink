"use client"

import { useMemo } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, Bell, X } from "lucide-react"
import { toast } from "sonner"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { jsonFetcher, useProjects, useSession } from "@/lib/client/api"
import { relativeTimeShort } from "@/lib/client/format"
import { buildNotificationInbox, selectNotifications, type InboxItem } from "@/lib/dashboard/view-model"
import { useNotificationState } from "@/lib/dashboard/notifications-store"
import type { PublicFeatureRequest } from "@/lib/feature-requests/types"
import useSWR from "swr"

const PREVIEW_COUNT = 3

const KIND_LABEL: Record<InboxItem["kind"], string> = {
  action: "Needs you",
  progress: "In progress",
  update: "Update",
}

export function DashboardNotifications() {
  const router = useRouter()
  const { projects } = useProjects()
  const { session } = useSession()
  const { data: mine } = useSWR<{ items: PublicFeatureRequest[] }>(
    session ? "/api/feature-requests?mine=1&sort=updated" : null,
    jsonFetcher,
    { revalidateOnFocus: true, dedupingInterval: 30_000 },
  )
  const { data: adsMine } = useSWR<{ requests: { id: string; projectId: string; projectName: string; status: string; updatedAt: number }[] }>(
    session ? "/api/me/ads/requests" : null,
    jsonFetcher,
    { revalidateOnFocus: true, dedupingInterval: 30_000 },
  )
  const { hydrated, read, dismissed, markRead, markAllRead, dismiss, restore } = useNotificationState()

  const items = useMemo(
    () =>
      buildNotificationInbox({
        projects,
        emailVerified: session?.user.emailVerified ?? true,
        creditsAvailable: session?.credits.available,
        featureRequests: mine?.items,
        adRequests: adsMine?.requests.map((request) => ({
          id: request.id,
          projectId: request.projectId,
          title: request.projectName,
          status: request.status,
          updatedAt: request.updatedAt,
        })),
        // Build the full inbox so the badge and "N more" are honest; only three render below.
        maxItems: 200,
        maxFeatureRequests: 100,
      }),
    [projects, session, mine, adsMine],
  )

  const live = useMemo(() => selectNotifications({ items, read, dismissed }), [items, read, dismissed])
  const preview = useMemo(
    () => selectNotifications({ items, read, dismissed, sort: "newest", preferUnread: true, limit: PREVIEW_COUNT }),
    [items, read, dismissed],
  )
  const unread = live.filter((item) => !read.has(item.id)).length
  const overflow = live.length - preview.length
  const dismissedCount = items.filter((item) => dismissed.has(item.id)).length

  function openItem(item: InboxItem) {
    markRead(item.id)
    router.push(item.href)
  }

  function dismissItem(e: React.MouseEvent, item: InboxItem) {
    e.preventDefault()
    e.stopPropagation()
    dismiss(item.id)
    toast("Notification dismissed", {
      description: item.title,
      action: { label: "Undo", onClick: () => restore(item.id) },
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="relative rounded-lg border border-border p-2 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Bell className="size-4" />
        <span className="sr-only">
          {unread > 0 ? `${unread} unread notifications` : "Notifications"}
        </span>
        {hydrated && unread > 0 ? (
          <span className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center justify-between gap-2 text-foreground">
            <span>Inbox</span>
            {live.length > 0 && unread > 0 ? (
              <button
                type="button"
                className="text-[11px] font-medium text-primary hover:underline"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  markAllRead(live.map((item) => item.id))
                }}
              >
                Mark all read
              </button>
            ) : null}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {preview.length === 0 ? (
            <>
              <DropdownMenuItem disabled className="items-start whitespace-normal">
                {live.length === 0 && dismissedCount > 0
                  ? "Nothing left here. Dismissed items are in your notifications page."
                  : "You're all caught up. When a plan needs review, a build fails, or a request ships, it shows up here."}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push("/new")}>Start a business</DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push("/feature-requests")}>Shape Atai</DropdownMenuItem>
            </>
          ) : (
            preview.map((item) => {
              const unseen = !read.has(item.id)
              return (
                <DropdownMenuItem
                  key={item.id}
                  className="items-start"
                  onClick={() => openItem(item)}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      {unseen ? (
                        <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                      ) : null}
                      <span>{KIND_LABEL[item.kind]}</span>
                      <span>·</span>
                      <span>{relativeTimeShort(item.at)}</span>
                    </span>
                    <span className="text-sm font-medium leading-snug">{item.title}</span>
                    <span className="line-clamp-2 text-xs text-muted-foreground">{item.description}</span>
                    <span className="text-xs text-primary">{item.actionLabel}</span>
                  </span>
                  <span
                    role="button"
                    tabIndex={-1}
                    aria-label={`Dismiss notification: ${item.title}`}
                    onClick={(e) => dismissItem(e, item)}
                    className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="size-3" />
                  </span>
                </DropdownMenuItem>
              )
            })
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-primary"
          onClick={() => router.push("/notifications")}
        >
          <span className="flex items-center justify-between gap-2">
            <span>View all notifications{overflow > 0 ? ` · ${overflow} more` : ""}</span>
            <ArrowRight className="size-3.5" />
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
