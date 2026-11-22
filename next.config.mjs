/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Deliberate: media is served from ImageKit, which already resizes and
    // optimizes at the edge, and Vercel's optimizer would bill a second pass
    // over the same bytes. Do not flip this without measuring both.
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Nothing is meant to frame Atai: no partner widget, no embed surface.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self)" },
          // OAuth sign-in opens provider windows, so do not sever the opener.
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          // Report-only first: App Router ships inline bootstrap scripts, so an
          // enforced script-src needs nonces through middleware. Until that
          // lands, this collects the real violations instead of breaking pages.
          {
            key: "Content-Security-Policy-Report-Only",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              "connect-src 'self' https:",
              // Lesson videos and customer app previews are third-party frames.
              "frame-src https:",
              "media-src 'self' blob: https:",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ]
  },
}

export default nextConfig
