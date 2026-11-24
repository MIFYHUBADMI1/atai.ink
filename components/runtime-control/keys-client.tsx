"use client"

import { useState } from "react"
import useSWR from "swr"
import { toast } from "sonner"
import { Loader2, Trash2 } from "lucide-react"
import { jsonFetcher, postJson, deleteJson } from "@/lib/client/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { SecretOnceBanner } from "./secret-once"
import { formatWhen } from "./format"

interface ApiKey {
  id: string
  kind?: "secret" | "publishable"
  environment: "development" | "production"
  name?: string
  keyPrefix: string
  scopes: string[]
  status: string
  createdAt: number
  lastUsedAt?: number
  expiresAt?: number
}

/** Which destructive action the confirmation dialog is for. */
type ConfirmAction = { kind: "revoke"; key: ApiKey } | { kind: "delete"; key: ApiKey } | null

export function RuntimeKeysClient({
  projectId,
  developerPortalUrl,
}: {
  projectId: string
  /** Optional link to the full developer portal (/developers on the canonical origin). */
  developerPortalUrl?: string
}) {
  const { data, error, isLoading, mutate } = useSWR<{
    keys: ApiKey[]
  }>(
    `/api/runtime/keys?projectId=${encodeURIComponent(projectId)}`,
    jsonFetcher,
  )
  const [name, setName] = useState("")
  const [environment, setEnvironment] = useState<"development" | "production">("development")
  const [secret, setSecret] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [pendingAction, setPendingAction] = useState<ConfirmAction>(null)
  const [acting, setActing] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  async function createKey(kind: "secret" | "publishable" = "secret") {
    setCreating(true)
    const toastId = toast.loading(kind === "publishable" ? "Creating your browser key…" : "Creating your API key…")
    try {
      const created = await postJson<ApiKey & { secret: string }>(
        `/api/runtime/keys?projectId=${encodeURIComponent(projectId)}`,
        { name: name.trim() || undefined, environment, ...(kind === "publishable" ? { kind } : {}) },
      )
      setSecret(created.secret)
      setName("")
      toast.success(
        kind === "publishable"
          ? "Browser key created — it can only record analytics. Copy it now."
          : "API key created — copy the secret now, it won't be shown again.",
        { id: toastId },
      )
      await mutate()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create key", { id: toastId })
    } finally {
      setCreating(false)
    }
  }

  function askRevoke(key: ApiKey) {
    setPendingAction({ kind: "revoke", key })
    setConfirmOpen(true)
  }

  function askDelete(key: ApiKey) {
    setPendingAction({ kind: "delete", key })
    setConfirmOpen(true)
  }

  function closeConfirm() {
    setConfirmOpen(false)
    setPendingAction(null)
  }

  async function runConfirmAction() {
    if (!pendingAction) return
    const { kind, key } = pendingAction
    setActing(true)
    try {
      if (kind === "revoke") {
        await fetch(`/api/runtime/keys/${key.id}`, {
          method: "DELETE",
          credentials: "include",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ reason: "revoked_from_control_center" }),
        }).then(async (res) => {
          const body = await res.json().catch(() => null)
          if (!body?.ok) throw new Error(body?.error?.message ?? "Could not revoke key")
        })
        toast.success(`Key ${key.keyPrefix} revoked — apps using it stopped working.`)
      } else {
        await deleteJson(`/api/runtime/keys/${key.id}?permanent=1`)
        toast.success(`Key ${key.keyPrefix} permanently deleted.`)
      }
      closeConfirm()
      await mutate()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setActing(false)
    }
  }

  async function rotate(id: string) {
    const toastId = toast.loading("Rotating key…")
    try {
      const rotated = await postJson<ApiKey & { secret: string }>(`/api/runtime/keys/${id}/rotate`)
      setSecret(rotated.secret)
      toast.success("Key rotated — the new secret is shown once.", { id: toastId })
      await mutate()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not rotate key", { id: toastId })
    }
  }

  const isDelete = pendingAction?.kind === "delete"

  return (
    <div data-atai-tour="runtime-keys" className="flex flex-col gap-6">
      {secret ? <SecretOnceBanner secret={secret} onDismiss={() => setSecret(null)} /> : null}
      {secret && /_pk_/.test(secret) ? (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
          <p className="text-sm font-medium">Install it in your site</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Paste this once, in the <code>&lt;head&gt;</code> of every page. It reports page views, journeys and clicks
            to this project&apos;s Growth page — and it can do nothing else.
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-background p-3 text-xs">
            <code>{`<script defer src="${typeof window === "undefined" ? "" : window.location.origin}/atai-analytics.js" data-atai-key="${secret}"></script>`}</code>
          </pre>
        </div>
      ) : null}

      {developerPortalUrl ? (
        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-sm">
          <span className="text-muted-foreground">
            Manage keys, usage and test endpoints in the developer portal.
          </span>
          <a href={developerPortalUrl} className="text-xs font-medium text-primary hover:underline">
            Open developer portal ↗
          </a>
        </div>
      ) : null}

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-medium">Create key</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          The plaintext secret is shown once. Empty scopes grant every runtime capability.
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label htmlFor="key-name">Name</Label>
            <Input
              id="key-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Production app"
              disabled={creating}
            />
          </div>
          <div>
            <Label htmlFor="key-env">Environment</Label>
            <select
              id="key-env"
              className="flex h-8 w-full rounded-lg border border-border bg-background px-2 text-sm"
              value={environment}
              disabled={creating}
              onChange={(e) => setEnvironment(e.target.value as "development" | "production")}
            >
              <option value="development">development</option>
              <option value="production">production</option>
            </select>
          </div>
          <Button type="button" onClick={() => createKey("secret")} disabled={creating}>
            {creating ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                Creating…
              </>
            ) : (
              "Create secret key"
            )}
          </Button>
          <Button type="button" variant="outline" onClick={() => createKey("publishable")} disabled={creating}>
            Create browser key
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          A browser key is embedded in a page, so it is limited to recording analytics — it cannot call a provider,
          read data or spend a credit. Use a secret key for everything else.
        </p>
      </section>

      {isLoading ? <p className="text-sm text-muted-foreground">Loading keys…</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">Could not load keys.</p> : null}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Prefix</th>
              <th className="px-3 py-2 font-medium">Env</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Last used</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {(data?.keys ?? []).map((key) => (
              <tr key={key.id} className="border-t border-border">
                <td className="px-3 py-2">
                  <div className="font-mono text-xs">{key.keyPrefix}</div>
                  {key.name ? <div className="text-xs text-muted-foreground">{key.name}</div> : null}
                  {key.kind === "publishable" ? (
                    <span className="mt-1 inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                      browser · analytics only
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-xs">{key.environment}</td>
                <td className="px-3 py-2 text-xs">{key.status}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{formatWhen(key.lastUsedAt)}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-2">
                    {key.status === "active" ? (
                      <>
                        <Button type="button" size="xs" variant="outline" onClick={() => rotate(key.id)}>
                          Rotate
                        </Button>
                        <Button type="button" size="xs" variant="destructive" onClick={() => askRevoke(key)}>
                          Revoke
                        </Button>
                      </>
                    ) : null}
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      aria-label={`Permanently delete key ${key.keyPrefix}`}
                      onClick={() => askDelete(key)}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.keys.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">No keys yet.</p>
        ) : null}
      </div>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open && !acting) closeConfirm()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className={isDelete ? "bg-destructive/10 text-destructive" : undefined}>
              <Trash2 className="size-5" aria-hidden />
            </AlertDialogMedia>
            <AlertDialogTitle>
              {isDelete ? "Permanently delete this key?" : "Revoke this key?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isDelete ? (
                <>
                  The key record <span className="font-mono">{pendingAction?.key.keyPrefix}</span> will be removed
                  forever. Any app using it stops working immediately, and this cannot be undone.
                </>
              ) : (
                <>
                  The key <span className="font-mono">{pendingAction?.key.keyPrefix}</span> stops working immediately.
                  Existing apps using it will be cut off. Its history is kept, but it can never be re-activated.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={acting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={isDelete ? "destructive" : "default"}
              disabled={acting}
              onClick={(e) => {
                e.preventDefault()
                void runConfirmAction()
              }}
            >
              {acting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                  {isDelete ? "Deleting…" : "Revoking…"}
                </>
              ) : isDelete ? (
                "Delete permanently"
              ) : (
                "Revoke key"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
