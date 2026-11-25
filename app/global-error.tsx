"use client"

import { useEffect, useRef } from "react"

import { buildClientErrorReport, reportClientError } from "@/lib/client-error-report"

/**
 * The last boundary: errors thrown by the root layout itself.
 *
 * It replaces `app/layout.tsx`, so it must render its own `<html>` and `<body>`,
 * and it cannot rely on the app's CSS or providers. Styling is therefore inline
 * and deliberately plain. It still reports and still prints the digest, so even
 * this failure is diagnosable.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry?: () => void }) {
  const report = buildClientErrorReport("global", error)
  const reported = useRef<string | null>(null)
  useEffect(() => {
    const key = `global:${report.message}:${report.digest ?? ""}`
    if (reported.current === key) return
    reported.current = key
    void reportClientError(report)
  }, [report])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b0b0c",
          color: "#f5f5f5",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: 520, width: "100%" }}>
          <p style={{ fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase", color: "#a1a1aa", margin: 0 }}>
            Atai
          </p>
          <h1 style={{ fontSize: 24, margin: "8px 0 0", lineHeight: 1.25 }}>Atai hit an unexpected error</h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: "#a1a1aa", marginTop: 12 }}>
            The page could not be drawn. Your account, credits and businesses are unaffected.
          </p>
          {report.digest ? (
            <p
              style={{
                marginTop: 16,
                padding: "8px 12px",
                borderRadius: 8,
                background: "#18181b",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 12,
                color: "#e4e4e7",
                wordBreak: "break-all",
              }}
            >
              Reference: {report.digest}
            </p>
          ) : null}
          <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
            <button
              type="button"
              onClick={() => (retry ? retry() : window.location.reload())}
              style={{
                border: "none",
                borderRadius: 999,
                background: "#f5f5f5",
                color: "#0b0b0c",
                padding: "10px 16px",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <a
              href="/"
              style={{
                borderRadius: 999,
                border: "1px solid #3f3f46",
                color: "#e4e4e7",
                padding: "10px 16px",
                fontSize: 14,
                textDecoration: "none",
              }}
            >
              Go to the home page
            </a>
          </div>
        </div>
      </body>
    </html>
  )
}
