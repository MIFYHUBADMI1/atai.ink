# Developer Portal — served at atai.ink/developers

The portal has ONE public location: the `/developers` subtree on the canonical
origin (`https://atai.ink`). The `developers.atai.ink` subdomain was retired —
it never got DNS, so any link or `rel=canonical` pointing at it was a dead end
for both users and crawlers.

## How it works

- The portal is the **same Next.js app**, served from `/developers`.
- `lib/env.ts` builds every portal link from the pinned public origin
  (`SITE_URL`, default `https://atai.ink`), so links and canonicals resolve to
  `https://atai.ink/developers/...` in production and to a relative
  `/developers` on localhost and preview deploys.
- `app/developers/layout.tsx` sets `metadataBase` to the canonical origin and
  canonicalizes the portal to `/developers`; `app/sitemap.ts` lists that path and
  `app/robots.ts` allows it.
- One host, one cookie: no domain widening is needed to keep the portal signed in.

## Optional — a separate staging host

If you ever want the portal on its own host for a staging deploy, that is an
opt-in, not a default:

| Variable | Value | Effect |
|---|---|---|
| `NEXT_PUBLIC_DEV_PORTAL_HOST` | e.g. `developers.staging.atai.ink` | `proxy.ts` rewrites that host into the `/developers` subtree and the portal's links/canonicals move to it. Unset = same-origin. |

Set it only after the DNS record and the hosting-platform domain entry exist,
otherwise you re-creates the dead-link problem this change removed.

## Verify

1. Visit `https://atai.ink/developers` → logged-out users land on
   `/login?next=/developers`; after login the portal loads.
2. Click "Developer portal ↗" from any project's **Runtime** nav, or "Open
   developer portal ↗" from **Runtime → API keys**.
3. From `/sdk`, "Try it in the playground" and the API-keys callout both open the
   portal, and `curl` examples point at `https://atai.ink/api/runtime/v1`.
4. View source on a portal page: `<link rel="canonical"
   href="https://atai.ink/developers">` — no subdomain.
5. `https://atai.ink/sitemap.xml` contains `https://atai.ink/developers`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Portal link goes to a subdomain | `NEXT_PUBLIC_DEV_PORTAL_HOST` is set in that deploy | Unset it, or point it at a host that actually resolves. |
| Canonical points at the wrong host | `NEXT_PUBLIC_SITE_URL` is set to something else | Unset it — the default pins the public origin to `https://atai.ink`. |
| SSL warning on a new host | Certificate not yet issued | Wait a few minutes after adding the domain on the host. |
