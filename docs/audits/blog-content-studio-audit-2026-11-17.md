# Blog, Content Studio & newsletter — implementation audit

**Date:** 2026-11-17
**Scope:** the blog / Content Studio / newsletter implementation delivered by the previous coding agent, plus the repo-wide consequences of the MongoDB driver change to `ignoreUndefined: true`.
**Method:** read every changed file against the code it calls; each finding below cites the file and line it was observed on and the fix that is now in the tree.

**Status of verification:** findings 1–13 and 15–19 have been executed against, not only reviewed — see "Verification run" at the end of this document. The two items marked *Open finding* (14 and 17) are deliberately not implemented and therefore not tested.

---

## Findings fixed

### 1. Every field-clearing write silently did nothing — repo-wide (critical)

The MongoDB client is configured with `ignoreUndefined: true`, so a key whose value is `undefined` is **omitted** from the serialised document. In an update that means `$set: { x: undefined }` does not clear `x` — it does not write anything at all. The same applies to filters: `{ x: undefined }` serialises to `{}` and matches everything.

The affected code cleared optional fields with `$set`, so the values stayed in the database while the code believed they had been removed.

Fixed by routing every clearing write through the existing helper `buildUpdate` (`lib/db/update.ts`), which turns `undefined` into `$unset`:

| File | What was not cleared |
| --- | --- |
| `lib/auth/users.ts:178-208` | `googleId` / `imageUrl` when an identity was linked or unlinked |
| `lib/auth/users.ts:267` | every credential and preference on a soft-deleted account |
| `lib/feedback/service.ts:891` | `incidentId` when reports were detached from an incident |
| `lib/feature-requests/service.ts` | blank release note / release link |
| `lib/integrations/github/push.ts:64` | `pushError` after a successful push |
| `lib/billing/dodo-event-processing.ts:413` | `nextBillingDate` when a renewal has no next date |
| `lib/blog/store.ts:920` | blank fields in a newsletter campaign |

Checked and left alone: the provisioning store, metering, pricing service, market service, export filters, multimodal adapters and the co-founder model catalog already used `$unset` or a full document replacement.

### 2. `setArticleStatus` sent an empty `$unset` — every status change but publish failed (critical)

`lib/blog/store.ts:604-605` built an update object that could contain `$unset: {}`. MongoDB rejects an empty update operator with `The '$unset' is empty` (code 10003), so archiving, unpublishing, restoring and moving to review all failed in production. The unit tests did not catch it because the MongoDB mock mirrors the driver, not the server.

Fixed: the schedule is cleared only for the actions that clear it, and the update is built through `buildUpdate`, which omits empty operators.

### 3. A scheduled article could not be edited after its time had passed

`lib/blog/store.ts:528-533` re-validated the stored schedule on every content save. Once a scheduled article's time had passed, the validation rejected the save, so the article could never be corrected before it went live.

Fixed: a schedule the admin did not touch (`status === "scheduled"` and no new `scheduledFor`) is no longer re-validated.

### 4. Built-in categories could be deleted, and a rename duplicated them

The seeded categories had no marker, so the admin could delete one and the public category list then fell back to the seed — the delete looked successful and the category came back. Renaming one created a second row with the same slug.

Fixed: built-ins are materialised with a `default-` id prefix (`lib/blog/store.ts:223-234`), merged by id so a rename cannot duplicate a slug (`lib/blog/store.ts:251`), and a delete of a built-in is refused with a 409 and an explanation (`lib/blog/store.ts:741-758`). The admin list shows a "Built-in" badge and disables the delete button (`components/admin/blog/categories-manager.tsx:121,154`).

### 5. A comparison with no competitor name either blocked the whole save or vanished (high)

Adding a comparison without a competitor tag produced an empty `competitorName`, which the schema rejected — a 422 on the *entire article save*, so the admin could not save anything else either. The first fix (dropping an unnamed comparison) silently deleted comparison rows the admin had written.

Fixed on all three levels:

- `lib/blog/admin-schema.ts:82` — an empty shell is stored as *no* comparison; a comparison that has content but no name is rejected with `Name the competitor, or clear the comparison you started.` so rows can never disappear unnoticed.
- `components/admin/blog/article-editor.tsx:514-560` — the Comparison tab asks for the competitor name next to the "Add comparison" button and the button stays disabled until there is one; an existing comparison can be removed with "Remove comparison".
- `components/admin/blog/comparison-editor.tsx` — warns while the name is empty.
- `lib/blog/audit.ts` — new `comparison-unnamed` error finding for a stored comparison without a name.
- `components/blog/comparison-table.tsx` — a nameless comparison renders as "Side by side comparison" instead of "Atai vs : side by side".

### 6. Table-of-contents links pointed at anchors that did not exist (high)

The blog outline, the docs outline, the resources/lessons outline and the renderer each built their own anchor ids, and the duplicate-heading scheme differed between them (`-1` vs `-2`). H3 and H4 headings had no id at all, so an outline entry for them linked nowhere.

Fixed with a single walker: `markdownHeadingEntries` in `lib/resources/media.ts:131` produces every heading with the anchor the renderer will use, and `lib/blog/content.ts:57` (`markdownToc`) delegates to it. `components/resources/markdown-article.tsx` now assigns the same ids to H3/H4.

### 7. The FAQ section was rendered twice and appeared in the outline (medium)

The article body kept the FAQ markdown, and the page also rendered a FAQ accordion — so the same questions appeared twice, and the outline listed a section that had been pulled out of the body.

Fixed with `splitFaqSection` (`lib/blog/content.ts:75`): the body and the FAQ are separated once, the page renders both, and the outline is built from the body that is actually rendered (`app/blog/[slug]/page.tsx:51`).

### 8. Prose containing `<` was mangled

`sanitizeBlogText` removed anything between angle brackets, so a phrase like "pricing < $50" lost part of its text. Now only real tags are removed (`lib/blog/sanitize.ts:62,100`).

### 9. An IndexNow failure was invisible (medium)

The publish route already returned the indexing result, but the editor ignored it, so a failed submission ping looked identical to a successful one.

Fixed: `components/admin/blog/article-editor.tsx:158` reports what actually happened — accepted, not accepted (with the provider's message), or not configured — appended to the publish message. The persisted status and error are also shown on the Discoverability page.

### 10. A failed save before a publish looked like a publish (medium)

If the save that precedes a publish failed, the action stopped silently. The editor now says the article was not published (`components/admin/blog/article-editor.tsx:288-293`).

### 11. The Bing Webmaster status was reported as if it were connected

`lib/blog/search-console.ts:228` now reports the real state from the stored verification token, and the performance route fetches the three sources in parallel (`app/api/admin/blog/performance/route.ts:20`).

---

### 12. Publishing from the "new article" screen did nothing at all (critical — this is the reported symptom)

The Publishing panel is fully rendered on `/admin/blog/articles/new`, so the status dropdown offered "Published" and the panel offered "Schedule publication" / "Send to review". All of them called `runAction`, whose first line was `if (!articleId) return` — the new article has no id, so the click was a silent no-op. Nothing was created, nothing was published, and the admin got no message at all, which is exactly "it is saved or something happens that even I the admin don't understand … its never published".

`components/admin/blog/article-editor.tsx:331-373` now creates the draft as part of the action (`ensureCreated`, line 305) and then applies the step to the id the server returned, so one click takes an unsaved article to published. On success the editor moves to the article's own URL and hands the outcome over through `sessionStorage` (`stashFlash`, line 136), because that navigation remounts the component and would otherwise drop the message.

Two adjacent instances of the same class of bug were fixed at the same time:

- **Header honesty** (`article-editor.tsx:475-493`). The status line used to print `"published · last saved just now"` even when the save had failed and even when nothing had ever been stored. It is now a chip plus a separate, factual note: "Not stored yet — nothing is public…", "Unsaved changes", "Saving…", "Last save failed…", or "Saved <date>. Not public yet."
- **Audit on an unsaved draft** (`article-editor.tsx:409`). `runAudit` had the same silent `if (!articleId) return`; the button is now disabled with a reason until the draft exists.

Also: the create route was the only blog route that returned the raw Mongo document instead of an admin view, so it leaked `_id` and omitted `href`/`publicUrl` (`app/api/admin/blog/route.ts:39`).

### 13. There was no way to read an article before publishing it (high)

The Preview button linked to `/blog/<slug>` for any stored article — but the public route resolves through `publicArticles()`, which only returns published rows, so a draft hit `notFound()` (`app/blog/[slug]/page.tsx:41`), and on the unsaved New screen the button fell back to the bare `/blog` index. In practice the admin could not see what they were writing without publishing it first.

Fixed by rendering the article inside the editor: `components/blog/article-preview.tsx` reuses the live page's own body renderer (`ArticleBody` → `MarkdownArticle`), the same leading-H1 strip and `markdownToc(splitFaqSection(...))` outline, plus `ComparisonTable`, so markdown that looks wrong there will look wrong publicly. The editor gained a Preview tab as its first tab (`components/admin/blog/article-editor.tsx:594-625`), the button now switches to that tab, and only a *published* article offers "View live page" (`:470-473, 503-511`). Category/author/tag chips stay unlinked on purpose — following one would drop unsaved work.

### 14. Open finding, NOT fixed — a scheduled article goes live silently (high)

Scheduled publication does work: `promoteDueScheduled` (`lib/blog/store.ts:118-150`) persists the flip to `published` on the next public read, so nothing needs a redeploy. But the automation that a manual publish performs lives only in the route handler (`app/api/admin/blog/[id]/status/route.ts:48`) and never runs for a scheduled promotion:

- **Subscribers are not emailed.** `announceArticle` is called from the status route, so the article that went live at 09:00 announces itself to nobody — which contradicts the brief that a new article should reach the newsletter automatically.
- **IndexNow is not pinged**, for the same reason.
- **`revalidateBlogSurfaces` is not called** — the promotion only clears the 60s in-process cache (`:143`), so ISR pages (`export const revalidate = 300`) can keep the article off `/blog` for up to five minutes after its scheduled time.

The clean fix is a cron that promotes due articles through the same code path as a manual publish (status change → announcement → IndexNow → revalidation). `vercel.json` currently carries two crons, both billing sweeps. Not implemented: adding a scheduled job changes deployment behaviour, so it is the owner's call.

### 15. The toolbar could insert Markdown that never renders (high)

The formatting library was never missing — `react-markdown` + `remark-gfm` are installed (`package.json:37,39`) and `components/resources/markdown-article.tsx` renders headings, lists, tables, quotes, code and rules. What made articles look "unformatted" to readers was the editor producing Markdown that is not at the start of a line: `MarkdownToolbar` declared a `block` flag on the heading/list/quote/table tools (`markdown-toolbar.tsx:30-48`) and then ignored it, so clicking Heading 2 in the middle of a paragraph inserted `## Title` inline. Markdown only recognises a heading, a list item or a table at the beginning of a line, so the reader saw the literal characters `## Title`.

Fixed: block tools now pad the insertion with newlines when it does not already sit on its own line, and the caret accounts for that padding (`markdown-toolbar.tsx:73-74, 81`). The Table tool, which had the same problem and was worse (a table needs three lines), is now marked `block`.

Two further fidelity gaps were closed in the stored document, applied identically to the live page and the Preview tab so neither can look better than the other:

- `normalizeBlogBody` (`lib/blog/content.ts:44-70`) drops the leading `# Title` line, demotes any other in-body H1 to H2 (the hero owns the only H1, and an undemoted one rendered as an unstyled heading absent from the outline), and repairs pasted `##Title` / `-item` into parseable form. It is line-wise and fence-aware, so `# comment` inside a code sample and `-50% off` in prose are untouched. Used at `app/blog/[slug]/page.tsx:48` and `components/blog/article-preview.tsx:44`.
- The body field now states the two rules that surprise authors (`article-editor.tsx:784-788`): a blank line separates paragraphs while a single line break does not, and raw HTML is stripped rather than rendered.

Not changed on purpose: `remark-breaks` was **not** installed. Turning single line breaks into `<br>` would silently re-flow every other page that shares `MarkdownArticle` — `/docs`, `/resources`, `/lessons` — for a rule that Markdown defines deliberately. The audit also still flags a body H1 (`lib/blog/audit.ts:122`) instead of only fixing it, so the author learns where the source is wrong.

### 16. A page reload destroyed the article being written (high)

Nothing reaches the server until the draft exists, so on `/admin/blog/articles/new` a reload, a crashed tab or "Leave site?" deleted every word typed. Even on a stored article the up-to-2.5-second window before autosave was unsaved work, and the only protection was the browser's leave-page warning — which an admin trained to click through it clicks through.

The editor now keeps a rolling snapshot in this browser and gives it back on the next load (`article-editor.tsx:158-260` helpers, `:346-378` wiring):

- Written 800ms after any change, keyed per article (`atai:blog-editor-draft:<id>`, or `:new`), and skipped entirely when the editor still holds only the blank template.
- Dropped the moment the server provably holds the same writing: after a successful save (`:423`) or a successful create (`:482`), so a snapshot never outlives the content it protects.
- Offered back, never applied silently. On mount the snapshot is compared to what the editor just loaded (`draftFingerprint`, `:210`); identical means it is deleted quietly, different means a banner appears with its timestamp and Restore / Discard. The check runs once per article, because `router.refresh()` hands down a new `article` object every time.
- Restoring merges **writing only** — title, slug, description, excerpt, body, category, tags, SEO, author, related slugs, competitor, comparison, image (`recoveredContent`, `:230`). Publishing state is not in the snapshot comparison and not in the merge, so recovering can never roll an article back from published to draft, un-schedule it, or overwrite what is already public.
- The status line no longer over-promises: when `localStorage` is unreachable (private mode, full quota) the probe at `:330-339` switches the New-screen note to "This browser cannot keep a local copy, so create the draft before closing the tab."

This is a browser-local safety net, not a second store: it is per-device, per-tab-family, and cleared with the browser's site data. The durable copy is still the database, and the header still says plainly when the article is not stored.

### 17. Open finding, NOT fixed — write-time sanitising can shorten content silently

`sanitizeBlogMarkdown` runs on every create and update (`lib/blog/store.ts:439`), and the editor adopts the server's copy. If an author pasted `<div>…</div>` markup, the tags disappear and nothing tells them the stored text differs from what they typed. The renderer would not have shown it either way, so no reader sees broken output — but the admin does lose the source. Reporting this needs a return-shape change through the store and three routes; the editor-level hint (finding 15) is the interim mitigation.

## Checked and found correct

- **Subscriber → admin page → publish → email.** The public subscribe route (`app/api/blog/newsletter/route.ts`) rate-limits per address and per reader, files the address under a normalised source label, and re-subscribes an address that had unsubscribed. The admin newsletter page lists the subscribers and the campaign history. Publishing runs `announceArticle`, which honours the automatic-announcement toggle, sends through Resend with a per-recipient idempotency key, and never blocks the publish — a mail failure is reported back to the admin instead.
- **Unsubscribed readers are excluded at the audience query**, not at the call site, so no sending path can reach them.
- **Public rendering is safe by construction** — react-markdown runs without `rehype-raw`, dangerous URL schemes are neutralised at write time, and the stored document is sanitised as a second layer.
- **The audit is rule-based and specific** — it names the missing element and the fix, and it never publishes anything.

## Not yet verified

- The MongoDB-specific failures in findings 1 and 2 cannot be covered by the unit mock; they need the real driver or a staging check.
- Finding 14 (scheduled publication side effects) has no automation to test until a cron exists.
- No live Resend send has been made from this working tree; the provider call is covered by mocked-fetch tests only, and `RESEND_FROM_EMAIL` on the deployment is the owner's change.

Suggested order when the owner green-lights testing: the blog and auth suites → the full suite in a single run → `npx next build` → the grouped commits.

## Verification run — 2026-11-17

The owner then authorised tests and the build.

- `npx vitest run lib/blog components/blog` → 10 files, 189 tests, all passing.
- `npx vitest run` (full suite, single run) → **268 files, 3168 passed, 2 todo, 0 failed**, 575s.
- `npx next build` → **exit 0**. Compiled in 2.1min, 222 static pages generated in 52s, no error or warning lines in the log, and every Content Studio route (`/admin/blog…`, `/api/admin/blog…`, `/blog/[slug]`) is present in the route table.
- Re-run after the layout pass (findings 20–23) → **exit 0** again: compiled in 107s, 222/222 static pages in 79s, zero error or warning lines.

Two things the run surfaced, both fixed rather than worked around:

### 18. Two Bing status tests were asserting against the pre-fix shape (test debt, not a product bug)

`lib/blog/search-console.test.ts` still called `bingWebmasterStatus()` synchronously and read only `metricsAvailable`, because at `HEAD` the function guessed `verified: true` and needed no settings (`git show HEAD:lib/blog/search-console.ts:227-240`). The finding-11 fix made it asynchronous and settings-backed, so the two tests received `undefined` for every property — they failed for the right reason, and the assertion that mattered (`verified`) was simply never exercised.

Updated: the suite now mocks the `@/lib/blog/store` boundary it depends on, awaits the status, and keeps the original two cases plus a third that states the actual bug — an API key alone must not be reported as a verified site. 10 tests passing.

### 19. The markdown work had no regression cover

`normalizeBlogBody` and the shared repair were untested, so a future refactor could silently return literal `##Title` text to readers. Added: 6 cases in `lib/blog/content.test.ts` (title strip, in-body H1 demotion with its outline entry, fences untouched, `##Quick`/`-first` repaired, `#hashtag`/`-50% off`/`---` left alone, repaired heading keeps the outline anchor) and 3 cases in `components/blog/blog-components.test.tsx` that render the Preview through the real pipeline and assert the reader gets `<h2>`/`<li>`/`href="#quick-start"` instead of raw syntax, exactly one `<h1>`, and an explicit empty-body message.

---

## Second pass — layout, reported by the owner on 2026-11-17

### 20. The admin sidebar could not be collapsed (missing capability)

`components/admin/admin-shell.tsx` rendered a fixed `w-60` rail on `lg+` with no way to narrow it; below `lg` it became a drawer. Added a desktop rail collapse (`admin-shell.tsx:18, 36-56, 60-68`):

- Persisted per browser in `localStorage` (`atai:admin-sidebar-collapsed`), read **after** mount so the server pass and the first client pass render the same markup — the same hydration rule the rest of the app follows.
- `w-60` → `w-[68px]` with `transition-[width]` and a `motion-reduce` opt-out.
- Collapsed mode keeps every destination reachable: icons centred, `aria-label` + `sr-only` name on each link, `aria-current="page"`, and the existing `title` description promoted to `Label — description` so hovering still explains the section. Group headings are replaced by a seam rather than being clipped to two characters.
- The toggle itself carries `aria-expanded`, an `aria-label` and a title, and only the desktop rail gets one (`onToggleCollapsed` is undefined in the mobile drawer, where collapsing makes no sense).

### 21. A long article title stretched the studio surfaces

Every list used `truncate` on an **inline** `<Link>`, which does nothing: truncation needs a block box, so a long headline simply grew the row — and a headline with a long unbroken token (a URL-like title) widened the page itself. Replaced with wrapping inside a bounded box (`line-clamp-2` + `break-words` + `min-w-0`/`flex-1`), because a clipped title is worse than a two-line one:

- `components/admin/blog/studio-dashboard.tsx:132, 158, 184` — Recently updated, Most read and Content needing attention.
- `components/admin/blog/articles-manager.tsx:305` — the Article column is capped at `26rem` so one headline cannot push the eight other columns sideways; the slug line gets `break-all`, which is correct for a URL path.
- `components/admin/blog/seo-panel.tsx:43` — the SERP preview was one clipped line; two clamped lines is both nothing-hidden and closer to what Google actually renders.
- `components/blog/article-preview.tsx` (share card title), `components/blog/article-card.tsx:44` and `app/blog/[slug]/page.tsx:93` — public headings wrap instead of overflowing on narrow screens.

### 22. The studio page grew as tall as the article (the reported "stretched as long as the article is")

`components/ui/textarea.tsx` carries `field-sizing-content`, the shared auto-growing default. In the body field that meant a 4,000-word article produced a 4,000-word-tall input and the whole studio page scrolled with it. The editor now overrides the default (`article-editor.tsx:785`): `field-sizing-fixed`, `min-h-[420px]`, `max-h-[70vh]`, `overflow-y-auto` — a tall article scrolls inside its own box and the page stays one screenful-plus-the-panel.

The Preview tab had the same shape problem from the other side: it renders the entire article inline, so it grew to the full document height. It is now a bounded frame (`article-editor.tsx:812`) with a one-line caption explaining that the frame scrolls while the published page is a continuous article — so the admin is not misled into thinking the reader sees a boxed region.

### 23. The tab strip was unbreakable on a small screen

`TabsList` is `w-fit` with a fixed `h-8` row and `whitespace-nowrap` triggers, so Preview / SEO / Comparison / Audit / History overflowed a phone instead of wrapping — horizontal page scroll, and the right-hand tabs unreachable. The editor's strip now wraps (`article-editor.tsx:799`): `w-full flex-wrap justify-start` plus `group-data-horizontal/tabs:h-auto`, which is the same variant prefix the base style uses, so `tailwind-merge` actually resolves the conflict (a plain `h-auto` would have lost to `group-data-horizontal/tabs:h-8`).

### Verification of this pass, and its limit

- `npx vitest run components/blog lib/blog app/blog` → 10 files, 189 tests passing.
- `npx vitest run` → 268 files, 3168 passed, 2 todo, 0 failed (274s).
- `npx next build` → see the build line in the "Verification run" section above; it is re-run for this pass.
- **Not browser-verified.** These are layout outcomes (a wrapped strip, an internal scrollbar, a collapsed rail) and this environment cannot reach `localhost` from the browser tooling, so no screenshot or computed-style check was taken. The build proves the markup compiles and prerenders; the visual behaviour needs a look from the owner at `/admin/blog`, an article with a very long title, and a phone-width window.
