"use client"

import { useCallback, useEffect, useState } from "react"

const READ_KEY = "atai:dashboard-notifications-read"
const DISMISSED_KEY = "atai:dashboard-notifications-dismissed"
const SYNC_EVENT = "atai:notifications-state"
const MAX_IDS = 400

function loadSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? new Set(parsed.filter((x): x is string => typeof x === "string")) : new Set()
  } catch {
    return new Set()
  }
}

function storeSet(key: string, ids: Set<string>) {
  try {
    // Keep the tail: the newest ids are the ones still matching live project state.
    localStorage.setItem(key, JSON.stringify([...ids].slice(-MAX_IDS)))
    window.dispatchEvent(new Event(SYNC_EVENT))
  } catch {
    /* ignore quota */
  }
}

export interface NotificationState {
  /** False until localStorage has been read — first paint stays deterministic. */
  hydrated: boolean
  read: Set<string>
  dismissed: Set<string>
  markRead: (id: string) => void
  markUnread: (id: string) => void
  markAllRead: (ids: string[]) => void
  dismiss: (id: string) => void
  restore: (id: string) => void
  clearDismissed: () => void
}

/**
 * Read/dismissal state for the notification inbox. Both the header preview and the
 * /notifications page subscribe here, so acting in one surface updates the other
 * without a round trip — the inbox itself is derived from live project state.
 */
export function useNotificationState(): NotificationState {
  const [read, setRead] = useState<Set<string>>(() => new Set())
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    const sync = () => {
      setRead(loadSet(READ_KEY))
      setDismissed(loadSet(DISMISSED_KEY))
      setHydrated(true)
    }
    sync()
    window.addEventListener(SYNC_EVENT, sync)
    window.addEventListener("storage", sync)
    return () => {
      window.removeEventListener(SYNC_EVENT, sync)
      window.removeEventListener("storage", sync)
    }
  }, [])

  // Always write from the freshest stored set so the two surfaces can't clobber each other.
  const mutateRead = useCallback((mutate: (next: Set<string>) => void) => {
    const next = loadSet(READ_KEY)
    mutate(next)
    storeSet(READ_KEY, next)
    setRead(next)
  }, [])

  const mutateDismissed = useCallback((mutate: (next: Set<string>) => void) => {
    const next = loadSet(DISMISSED_KEY)
    mutate(next)
    storeSet(DISMISSED_KEY, next)
    setDismissed(next)
  }, [])

  return {
    hydrated,
    read,
    dismissed,
    markRead: (id) => mutateRead((next) => next.add(id)),
    markUnread: (id) =>
      mutateRead((next) => {
        next.delete(id)
      }),
    markAllRead: (ids) =>
      mutateRead((next) => {
        for (const id of ids) next.add(id)
      }),
    dismiss: (id) => {
      mutateDismissed((next) => void next.add(id))
      mutateRead((next) => next.add(id))
    },
    restore: (id) =>
      mutateDismissed((next) => {
        next.delete(id)
      }),
    clearDismissed: () =>
      mutateDismissed((next) => {
        next.clear()
      }),
  }
}
