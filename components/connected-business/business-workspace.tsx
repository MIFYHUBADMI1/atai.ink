"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Globe, Plus, Trash2, Users } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { sendJson } from "./api-client"
import {
  APPLICATION_KINDS,
  BUSINESS_ROLES,
  type BusinessDoc,
  type BusinessMemberDoc,
  type BusinessRole,
  type ConnectedApplicationDoc,
} from "@/lib/types/business"

const TABS = ["Overview", "Applications", "People", "Settings"] as const
type Tab = (typeof TABS)[number]

const ROLE_LABEL: Record<BusinessRole, string> = {
  owner: "Owner",
  admin: "Admin",
  marketer: "Marketer",
  developer: "Developer",
  finance: "Finance",
  viewer: "Viewer",
}

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"

export function BusinessWorkspace({
  business,
  applications: initialApplications,
  members: initialMembers,
}: {
  business: BusinessDoc
  applications: ConnectedApplicationDoc[]
  members: BusinessMemberDoc[]
}) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>("Overview")
  const [applications, setApplications] = useState(initialApplications)
  const [members, setMembers] = useState(initialMembers)
  const [name, setName] = useState(business.name)
  const [, startTransition] = useTransition()

  const refresh = () => startTransition(() => router.refresh())

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{business.name}</h1>
        <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant={business.status === "active" ? "default" : "secondary"}>{business.status}</Badge>
          <span>
            {applications.length} application{applications.length === 1 ? "" : "s"}
          </span>
          <span aria-hidden>·</span>
          <span>{members.filter((member) => member.status === "active").length} people</span>
        </div>
      </header>

      <nav className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={
              tab === item
                ? "rounded-md bg-background px-3 py-1.5 text-sm font-medium shadow-sm"
                : "rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            }
          >
            {item}
          </button>
        ))}
      </nav>

      {tab === "Overview" ? <Overview business={business} applications={applications} members={members} /> : null}

      {tab === "Applications" ? (
        <Applications
          businessId={business.id}
          applications={applications}
          onCreated={(application) => {
            setApplications((current) => [...current, application])
            refresh()
          }}
          onArchived={(applicationId) => {
            setApplications((current) => current.filter((application) => application.id !== applicationId))
            refresh()
          }}
        />
      ) : null}

      {tab === "People" ? (
        <People
          businessId={business.id}
          applications={applications}
          members={members}
          onAdded={(member) => {
            setMembers((current) => [...current, member])
            refresh()
          }}
          onRemoved={(userId) => {
            setMembers((current) =>
              current.map((member) => (member.userId === userId ? { ...member, status: "removed" } : member)),
            )
            refresh()
          }}
        />
      ) : null}

      {tab === "Settings" ? (
        <Settings
          business={business}
          name={name}
          onNameChange={setName}
          onRenamed={() => refresh()}
          onArchived={() => router.push("/business")}
        />
      ) : null}
    </div>
  )
}

function Overview({
  business,
  applications,
  members,
}: {
  business: BusinessDoc
  applications: ConnectedApplicationDoc[]
  members: BusinessMemberDoc[]
}) {
  const active = members.filter((member) => member.status === "active")
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Applications</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-semibold">{applications.length}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {applications.map((application) => application.name).join(", ") || "None connected yet"}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">People</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-semibold">{active.length}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {active
              .map((member) => ROLE_LABEL[member.role])
              .filter((role, index, all) => all.indexOf(role) === index)
              .join(", ")}
          </p>
        </CardContent>
      </Card>
      <Card className="sm:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Business</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
          <Row label="Business id" value={business.id} />
          <Row label="Owner" value={business.ownerId} />
          <Row label="Created" value={new Date(business.createdAt).toLocaleString()} />
          <Row label="Updated" value={new Date(business.updatedAt).toLocaleString()} />
        </CardContent>
      </Card>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="truncate font-mono text-xs">{value}</p>
    </div>
  )
}

function Applications({
  businessId,
  applications,
  onCreated,
  onArchived,
}: {
  businessId: string
  applications: ConnectedApplicationDoc[]
  onCreated: (application: ConnectedApplicationDoc) => void
  onArchived: (applicationId: string) => void
}) {
  const [name, setName] = useState("")
  const [kind, setKind] = useState<string>("marketing_site")
  const [url, setUrl] = useState("")
  const [basePath, setBasePath] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    const result = await sendJson<{ application: ConnectedApplicationDoc }>(
      `/api/businesses/${businessId}/applications`,
      "POST",
      { name, kind, url, ...(basePath.trim() ? { basePath: basePath.trim() } : {}) },
    )
    setBusy(false)
    if (!result.ok || !result.data) {
      setError(result.message ?? "Could not add the application.")
      return
    }
    onCreated(result.data.application)
    setName("")
    setUrl("")
    setBasePath("")
  }

  async function archive(applicationId: string) {
    const result = await sendJson(`/api/businesses/${businessId}/applications/${applicationId}`, "DELETE")
    if (!result.ok) setError(result.message ?? "Could not archive the application.")
    else onArchived(applicationId)
  }

  return (
    <div className="space-y-4">
      {applications.length === 0 ? (
        <Empty icon={<Globe className="h-6 w-6" />} text="No applications connected yet." />
      ) : (
        <ul className="space-y-2">
          {applications.map((application) => (
            <li key={application.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{application.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{application.primaryUrl}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{application.kind}</Badge>
                    <Badge variant={application.hostVerified ? "default" : "outline"}>
                      {application.hostVerified ? "verified" : "unverified"}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Archive application"
                      onClick={() => archive(application.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Connect an application</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="app-name">Name</Label>
              <Input id="app-name" value={name} onChange={(event) => setName(event.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="app-kind">Kind</Label>
              <select id="app-kind" className={SELECT_CLASS} value={kind} onChange={(event) => setKind(event.target.value)}>
                {APPLICATION_KINDS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="app-url">Address</Label>
              <Input
                id="app-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/shop"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="app-path">Path (optional)</Label>
              <Input id="app-path" value={basePath} onChange={(event) => setBasePath(event.target.value)} placeholder="/shop" />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy}>
                <Plus className="mr-2 h-4 w-4" />
                Connect application
              </Button>
            </div>
          </form>
          {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>
    </div>
  )
}

function People({
  businessId,
  applications,
  members,
  onAdded,
  onRemoved,
}: {
  businessId: string
  applications: ConnectedApplicationDoc[]
  members: BusinessMemberDoc[]
  onAdded: (member: BusinessMemberDoc) => void
  onRemoved: (userId: string) => void
}) {
  const [userId, setUserId] = useState("")
  const [role, setRole] = useState<BusinessRole>("viewer")
  const [scopeKind, setScopeKind] = useState<"all" | "applications">("all")
  const [selected, setSelected] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    const result = await sendJson<{ member: BusinessMemberDoc }>(`/api/businesses/${businessId}/members`, "POST", {
      userId,
      role,
      ...(scopeKind === "applications" ? { scope: { kind: "applications", applicationIds: selected } } : {}),
    })
    setBusy(false)
    if (!result.ok || !result.data) {
      setError(result.message ?? "Could not add that person.")
      return
    }
    onAdded(result.data.member)
    setUserId("")
    setSelected([])
  }

  async function remove(memberUserId: string) {
    const result = await sendJson(`/api/businesses/${businessId}/members/${memberUserId}`, "DELETE")
    if (!result.ok) setError(result.message ?? "Could not remove that person.")
    else onRemoved(memberUserId)
  }

  return (
    <div className="space-y-4">
      {members.length === 0 ? (
        <Empty icon={<Users className="h-6 w-6" />} text="Nobody has been added yet." />
      ) : (
        <ul className="space-y-2">
          {members.map((member) => (
            <li key={member.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm">{member.userId}</p>
                    <p className="text-xs text-muted-foreground">
                      {member.scope.kind === "all" ? "Whole business" : `${member.scope.applicationIds.length} application(s)`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={member.status === "active" ? "default" : "secondary"}>{member.status}</Badge>
                    <Badge variant="secondary">{ROLE_LABEL[member.role]}</Badge>
                    {member.role !== "owner" ? (
                      <Button variant="ghost" size="icon" aria-label="Remove person" onClick={() => remove(member.userId)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Add someone</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="member-id">User id</Label>
              <Input id="member-id" value={userId} onChange={(event) => setUserId(event.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="member-role">Role</Label>
              <select
                id="member-role"
                className={SELECT_CLASS}
                value={role}
                onChange={(event) => setRole(event.target.value as BusinessRole)}
              >
                {BUSINESS_ROLES.filter((option) => option !== "owner").map((option) => (
                  <option key={option} value={option}>
                    {ROLE_LABEL[option]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="member-scope">Scope</Label>
              <select
                id="member-scope"
                className={SELECT_CLASS}
                value={scopeKind}
                onChange={(event) => setScopeKind(event.target.value as "all" | "applications")}
              >
                <option value="all">Whole business</option>
                <option value="applications">Selected applications</option>
              </select>
            </div>
            {scopeKind === "applications" ? (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Applications</Label>
                <div className="flex flex-wrap gap-3">
                  {applications.map((application) => (
                    <label key={application.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selected.includes(application.id)}
                        onChange={(event) =>
                          setSelected((current) =>
                            event.target.checked
                              ? [...current, application.id]
                              : current.filter((id) => id !== application.id),
                          )
                        }
                      />
                      {application.name}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy}>
                <Plus className="mr-2 h-4 w-4" />
                Add person
              </Button>
            </div>
          </form>
          {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>
    </div>
  )
}

function Settings({
  business,
  name,
  onNameChange,
  onRenamed,
  onArchived,
}: {
  business: BusinessDoc
  name: string
  onNameChange: (value: string) => void
  onRenamed: () => void
  onArchived: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  async function rename(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    const result = await sendJson(`/api/businesses/${business.id}`, "PATCH", { name })
    setBusy(false)
    if (!result.ok) setError(result.message ?? "Could not rename the business.")
    else onRenamed()
  }

  async function archive() {
    setError(null)
    const result = await sendJson(`/api/businesses/${business.id}`, "DELETE")
    if (!result.ok) setError(result.message ?? "Could not archive the business.")
    else onArchived()
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Name</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={rename} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="rename">Business name</Label>
              <Input id="rename" value={name} onChange={(event) => onNameChange(event.target.value)} required />
            </div>
            <Button type="submit" disabled={busy || name.trim() === business.name}>
              Save
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Archive</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Archiving stops every write to this business. Its applications, people and records are kept.
          </p>
          <Separator />
          {confirming ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="destructive" onClick={archive}>
                Yes, archive
              </Button>
              <Button variant="outline" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="outline" onClick={() => setConfirming(true)}>
              Archive business
            </Button>
          )}
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  )
}

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
      <div className="mx-auto w-fit">{icon}</div>
      <p className="mt-3 text-sm">{text}</p>
    </div>
  )
}
