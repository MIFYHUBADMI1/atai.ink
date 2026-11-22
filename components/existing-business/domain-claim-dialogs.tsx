"use client"

import { Loader2, Trash2, TriangleAlert } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import type { DomainView } from "@/lib/domain/service"

/**
 * Removing a claim is never a side effect of something else. It frees the
 * hostname for any other Atai account, and a proved address is what the app
 * connection counts on — so the founder sees the consequence, the exact
 * hostnames, and a way out before anything is released.
 */
export function DomainReleaseDialog({
  domains,
  open,
  busy,
  onCancel,
  onConfirm,
}: {
  domains: DomainView[]
  open: boolean
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const single = domains.length === 1 ? domains[0] : null
  const proved = domains.some((domain) => domain.status === "verified")

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <Trash2 className="size-5" aria-hidden />
          </AlertDialogMedia>
          <AlertDialogTitle className="break-words">
            {single ? `Remove ${single.hostname}?` : `Remove ${domains.length} addresses?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {single ? null : (
              <span className="mb-2 block font-mono text-[11px] leading-relaxed break-all">
                {domains.map((domain) => domain.hostname).join(" · ")}
              </span>
            )}
            Atai stops claiming {single ? "this address" : "these addresses"} for this business. Any other Atai account
            can connect {single ? "it" : "them"} from now on, and the tag or file you added stops mattering. You can add
            {single ? " it" : " them"} again later — with a new tag or file to prove.
            {proved
              ? " A proved address is what your app's connection counts on, so removing it takes the connection back to unverified."
              : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep {single ? "it" : "them"}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            className="h-auto max-w-full whitespace-normal text-left"
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
          >
            {busy ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : <Trash2 className="size-3.5 shrink-0" />}
            <span className="min-w-0 break-all">
              {single ? `Remove ${single.hostname}` : `Remove all ${domains.length}`}
            </span>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * Shown the moment one address is proved while others are still waiting. The
 * step does not move on by itself: a waiting claim reserves a hostname nobody
 * else can connect, so the founder is asked to settle it — prove it, or remove
 * it — instead of discovering it later.
 */
export function UnresolvedDomainsDialog({
  domains,
  open,
  onOpenChange,
  onRemove,
}: {
  domains: DomainView[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onRemove: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-amber-500/15 text-amber-700 dark:text-amber-400">
            <TriangleAlert className="size-5" aria-hidden />
          </AlertDialogMedia>
          <AlertDialogTitle className="break-words">
            {domains.length === 1
              ? "One address is proved — one is still waiting"
              : `One address is proved — ${domains.length} are still waiting`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            <span className="mb-2 block font-mono text-[11px] leading-relaxed break-all">
              {domains.map((domain) => domain.hostname).join(" · ")}
            </span>
            This step stays open until every address you added is proved or removed, because a waiting address keeps
            that site reserved for your business. Prove them one at a time below, or remove the ones you no longer need.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>I&apos;ll prove them</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            className="h-auto max-w-full whitespace-normal text-left"
            onClick={(event) => {
              event.preventDefault()
              onRemove()
            }}
          >
            <Trash2 className="size-3.5 shrink-0" />
            <span className="min-w-0 break-all">
              Remove {domains.length === 1 ? "it" : `all ${domains.length}`}
            </span>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
