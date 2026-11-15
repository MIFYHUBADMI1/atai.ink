"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function NewsletterForm({ source = "blog", compact = false }: { source?: string; compact?: boolean }) {
  const [email, setEmail] = useState("")
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle")
  const [message, setMessage] = useState("")

  async function subscribe(event: React.FormEvent) {
    event.preventDefault()
    if (!email.trim() || state === "saving") return
    setState("saving")
    try {
      const response = await fetch("/api/blog/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        setState("error")
        setMessage(payload?.error?.message ?? "Could not subscribe right now. Try again shortly.")
        return
      }
      setState("done")
      setMessage(payload?.data?.alreadySubscribed ? "You're already on the list." : "You're on the list. Watch your inbox.")
      setEmail("")
    } catch {
      setState("error")
      setMessage("Could not subscribe right now. Try again shortly.")
    }
  }

  if (state === "done") {
    return <p className="text-sm text-primary">{message}</p>
  }

  return (
    <form onSubmit={subscribe} className={compact ? "flex flex-col gap-2 sm:flex-row" : "flex flex-col gap-3 sm:flex-row"}>
      <label className="sr-only" htmlFor={`newsletter-${source}`}>
        Email address
      </label>
      <Input
        id={`newsletter-${source}`}
        type="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="you@company.com"
        className="h-11 flex-1 bg-background px-4 text-base sm:text-sm"
      />
      <Button type="submit" disabled={state === "saving"} className="h-11 px-5">
        {state === "saving" ? <Loader2 className="size-4 animate-spin" /> : null}
        {state === "saving" ? "Subscribing…" : "Subscribe"}
      </Button>
      {state === "error" ? <p className="text-sm text-destructive sm:basis-full">{message}</p> : null}
    </form>
  )
}