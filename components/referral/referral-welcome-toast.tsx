"use client"

import { useEffect } from "react"
import { toast } from "sonner"

/**
 * OAuth signups land on a normal app page, so the referral bonus is confirmed
 * here: the callback appends `welcome=referral&bonus=<n>` to the destination
 * and this component turns it into one toast, then removes the params so a
 * refresh does not repeat it.
 */
export function ReferralWelcomeToast() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get("welcome") !== "referral") return

    const bonus = Number(params.get("bonus"))
    toast.success(
      Number.isFinite(bonus) && bonus > 0
        ? `You joined through a referral link — ${bonus.toLocaleString()} bonus credits added.`
        : "You joined through a referral link — your bonus credits are in your account.",
    )

    params.delete("welcome")
    params.delete("bonus")
    const query = params.toString()
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`)
  }, [])

  return null
}
