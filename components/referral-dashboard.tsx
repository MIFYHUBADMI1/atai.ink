"use client"

import { useState } from "react"
import useSWR from "swr"
import { Copy, Check, Gift, Rocket, Users, Clock, CheckCircle2, ExternalLink, Shield } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { jsonFetcher, patchJson } from "@/lib/client/api"
import { toast } from "sonner"
import type { PublicRewards } from "@/lib/billing/public-config-types"

interface ReferralInfo {
  referralCode: string
  referralLink: string
  stats: {
    totalReferrals: number
    successfulReferrals: number
    pendingReferrals: number
    verificationRewards: number
    milestoneRewards: number
    totalCreditsEarned: number
  }
  referrals: Array<{
    id: string
    status: string
    verificationRewardIssued: boolean
    milestoneRewardIssued: boolean
    eligibleUsage: number
    createdAt: number
  }>
  rewards: PublicRewards
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  registered: { label: "Joined", color: "text-muted-foreground" },
  verified: { label: "Verified", color: "text-green-500" },
  active: { label: "Building", color: "text-blue-500" },
  milestone_reached: { label: "Milestone Reached", color: "text-primary" },
  blocked: { label: "Blocked", color: "text-destructive" },
}

function formatUsage(usage: number): string {
  if (usage >= 1000) return `${(usage / 1000).toFixed(1)}k`
  return String(usage)
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export function ReferralDashboard() {
  const { data, error, isLoading, mutate } = useSWR<ReferralInfo>("/api/referrals", jsonFetcher)
  const [copied, setCopied] = useState(false)
  const [codeInput, setCodeInput] = useState("")
  const [savingCode, setSavingCode] = useState(false)

  async function copyLink() {
    if (!data) return
    try {
      await navigator.clipboard.writeText(data.referralLink)
      setCopied(true)
      toast.success("Referral link copied!")
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Failed to copy link")
    }
  }

  async function saveCustomCode() {
    const code = codeInput.trim().toUpperCase()
    if (!code) {
      toast.error("Enter a code starting with ATAI-")
      return
    }
    setSavingCode(true)
    try {
      const res = await patchJson<{ referralCode: string; referralLink: string }>("/api/referrals", { code })
      setCodeInput("")
      await mutate()
      toast.success(`Referral code updated to ${res.referralCode}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update your referral code")
    } finally {
      setSavingCode(false)
    }
  }

  async function generateAutoCode() {
    setSavingCode(true)
    try {
      const res = await patchJson<{ referralCode: string }>("/api/referrals", { auto: true })
      setCodeInput("")
      await mutate()
      toast.success(`New referral code: ${res.referralCode}`)
    } catch {
      toast.error("Couldn't generate a new referral code")
    } finally {
      setSavingCode(false)
    }
  }

  if (isLoading) {
    return (
      <section className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 py-10 lg:px-10 lg:py-14">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 rounded bg-muted" />
          <div className="h-4 w-96 rounded bg-muted" />
          <div className="h-32 rounded-lg bg-muted" />
        </div>
      </section>
    )
  }

  if (error || !data) {
    return (
      <section className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 py-10 lg:px-10 lg:py-14">
        <p className="text-sm text-destructive">Failed to load referral information. Please try again.</p>
      </section>
    )
  }

  const { referralVerificationReward: verification, referralMilestoneReward: milestone, referralSignupBonus: signup, referralMilestoneThreshold: threshold } = data.rewards
  const maxReward = verification + milestone

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 py-10 lg:px-10 lg:py-14">
      {/* Hero */}
      <div className="flex flex-col gap-4 border-b border-border pb-10">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Referrals</p>
        <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          Refer & Earn Credits
        </h1>
        <p className="max-w-2xl text-pretty text-lg leading-8 text-muted-foreground">
          Invite people to build with Atai and earn credits when they become active users.
        </p>
      </div>

      {/* Referral Link */}
      <Card>
        <CardContent className="py-6">
          <p className="text-sm font-medium text-muted-foreground mb-3">Your Referral Link</p>
          <div className="flex items-center gap-3">
            <div className="flex-1 truncate rounded-lg border border-border bg-muted/50 px-4 py-3 font-mono text-sm">
              {data.referralLink}
            </div>
            <button
              onClick={copyLink}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              aria-label="Copy referral link"
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "Copied!" : "Copy Link"}
            </button>
          </div>
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            Your code: <span className="text-foreground">{data.referralCode}</span>
          </p>
        </CardContent>
      </Card>

      {/* Customize code */}
      <Card>
        <CardContent className="py-6">
          <p className="text-sm font-medium text-muted-foreground mb-3">Your Referral Code</p>
          <p className="text-xs leading-5 text-muted-foreground mb-4">
            Codes start with <span className="font-mono text-foreground">ATAI-</span>. Pick your own suffix or let Atai generate one.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              type="text"
              value={codeInput}
              onChange={(event) => setCodeInput(event.target.value)}
              placeholder="ATAI-YOUR-NAME"
              maxLength={40}
              className="h-11 flex-1 rounded-lg border border-border bg-muted/50 px-4 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void saveCustomCode()}
                disabled={savingCode || !codeInput.trim()}
                className="inline-flex h-11 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save code
              </button>
              <button
                type="button"
                onClick={() => void generateAutoCode()}
                disabled={savingCode}
                className="inline-flex h-11 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Auto-generate
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Reward Explanation */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="flex gap-4 py-6">
            <div className="rounded-lg bg-green-500/10 p-3 h-fit">
              <Gift className="size-6 text-green-500" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">{verification.toLocaleString()} Credits</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Earn {verification.toLocaleString()} credits when someone joins through your referral link and verifies their account.
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex gap-4 py-6">
            <div className="rounded-lg bg-primary/10 p-3 h-fit">
              <Rocket className="size-6 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">+{milestone.toLocaleString()} Credits</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Earn an additional {milestone.toLocaleString()} credits when your referral successfully uses {threshold.toLocaleString()} credits to build applications.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Max per referral */}
      <div className="rounded-lg border border-border bg-card/50 px-6 py-4 text-center">
        <p className="text-lg font-medium">
          Up to <span className="text-primary font-semibold">{maxReward.toLocaleString()} Credits</span> per successful referral
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Whoever you invite also gets {signup.toLocaleString()} bonus credits when they join, on top of their welcome credits.
        </p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="py-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2">
                <Users className="size-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Successful Referrals</p>
                <p className="mt-1 text-2xl font-semibold">{data.stats.successfulReferrals}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-amber-500/10 p-2">
                <Clock className="size-4 text-amber-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pending Referrals</p>
                <p className="mt-1 text-2xl font-semibold">{data.stats.pendingReferrals}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-green-500/10 p-2">
                <Gift className="size-4 text-green-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Credits Earned</p>
                <p className="mt-1 text-2xl font-semibold text-green-500">+{data.stats.totalCreditsEarned.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Stats */}
      {(data.stats.verificationRewards > 0 || data.stats.milestoneRewards > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardContent className="py-5">
              <p className="text-xs text-muted-foreground">Verification Rewards</p>
              <p className="mt-2 text-xl font-semibold">{data.stats.verificationRewards}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {(data.stats.verificationRewards * verification).toLocaleString()} credits awarded
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-5">
              <p className="text-xs text-muted-foreground">Usage Milestones</p>
              <p className="mt-2 text-xl font-semibold">{data.stats.milestoneRewards}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {(data.stats.milestoneRewards * milestone).toLocaleString()} credits awarded
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Referral List */}
      {data.referrals.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-4">Your Referrals</h2>
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="grid grid-cols-[1fr_auto_auto] gap-4 px-4 py-3 bg-muted/50 text-xs font-medium text-muted-foreground border-b border-border">
              <span>Referral</span>
              <span>Status</span>
              <span className="text-right">Reward</span>
            </div>
            <div className="divide-y divide-border">
              {data.referrals.map((r) => {
                const status = STATUS_LABELS[r.status] ?? { label: r.status, color: "text-muted-foreground" }
                let rewardText = "Pending"
                let rewardColor = "text-muted-foreground"
                if (r.verificationRewardIssued && r.milestoneRewardIssued) {
                  rewardText = `+${maxReward.toLocaleString()}`
                  rewardColor = "text-green-500"
                } else if (r.verificationRewardIssued) {
                  rewardText = `+${verification.toLocaleString()}`
                  rewardColor = "text-green-500"
                }
                return (
                  <div key={r.id} className="grid grid-cols-[1fr_auto_auto] gap-4 px-4 py-3 items-center">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">Referral</p>
                      <p className="text-xs text-muted-foreground">{formatDate(r.createdAt)}</p>
                    </div>
                    <Badge variant="outline" className={`text-xs ${status.color}`}>
                      {status.label}
                    </Badge>
                    <span className={`font-mono text-sm font-medium ${rewardColor}`}>
                      {rewardText}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Progress for active referrals */}
      {data.referrals.some((r) => !r.milestoneRewardIssued && r.eligibleUsage > 0) && (
        <div>
          <h2 className="text-lg font-semibold mb-4">Referral Progress</h2>
          <div className="space-y-3">
            {data.referrals
              .filter((r) => !r.milestoneRewardIssued && r.eligibleUsage > 0)
              .map((r) => {
                const progress = threshold > 0 ? Math.min((r.eligibleUsage / threshold) * 100, 100) : 0
                return (
                  <Card key={r.id}>
                    <CardContent className="py-4">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-medium">Referral activity</p>
                        <p className="text-xs text-muted-foreground">
                          {formatUsage(r.eligibleUsage)} / {threshold.toLocaleString()}
                        </p>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${progress}%` }}
                          role="progressbar"
                          aria-valuenow={r.eligibleUsage}
                          aria-valuemin={0}
                          aria-valuemax={threshold}
                          aria-label={`${formatUsage(r.eligibleUsage)} of ${threshold.toLocaleString()} credits used`}
                        />
                      </div>
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        {Math.max(0, threshold - r.eligibleUsage).toLocaleString()} credits remaining to milestone
                      </p>
                    </CardContent>
                  </Card>
                )
              })}
          </div>
        </div>
      )}

      {/* Empty State */}
      {data.referrals.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <Users className="size-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-lg font-medium">No referrals yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Share your referral link to start earning credits.
          </p>
        </div>
      )}

      {/* Fraud Policy */}
      <div className="rounded-lg border border-border bg-card/50 px-6 py-5">
        <div className="flex items-start gap-3">
          <Shield className="size-5 text-muted-foreground mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium">Referral Policy</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Referral rewards are intended for genuine new users. Attempts to create fraudulent,
              duplicate, self-referred, or manipulated accounts to obtain rewards may result in
              referral rewards being removed and the associated account being suspended.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
