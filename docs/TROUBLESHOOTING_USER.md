# Troubleshooting & common problems

If something isn't working, start here. Find your problem, read the likely cause, and try the fix. If you're still stuck, there's a short section at the end on how to contact support so you get an answer fast.

> Tip: most fixes just need you to check a setting or refresh the page.

> **Need an account first?** [Create one](/register) or [sign in](/login). Forgot your password? [Reset it here](/forgot-password). New to Atai? Read the [Getting Started guide](/docs/onboarding).

## 1. Before you start: a 60-second check

Most problems people report turn out to be one of five things. Run through this list first — it resolves more cases than anything else on this page.

1. **Refresh the page.** Hard-refresh if you can: `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac). A stale page is the single most common cause of "it's not working."
2. **Check you're in the right project.** Many screens look identical across projects. Look at the project name before assuming data is missing.
3. **Check you're signed in as the right user.** If you have more than one account, you may be looking at the wrong one.
4. **Wait a moment, then try again.** Building, publishing, and analyzing all take time. If you clicked something and nothing happened, it may still be working.
5. **Try once more in a normal browser window.** Extensions and private/incognito windows cause a surprising number of odd failures.

If the problem survives all five, find it below.

## 2. How to describe a problem so it gets fixed

When something goes wrong, note these four things *before* you refresh or navigate away:

- **What you were trying to do** — "publish my project", "add a record to Orders".
- **What happened instead** — the exact message, copied or screenshotted.
- **When it happened** — roughly, plus your time zone if support is in another country.
- **What you'd already tried** — refreshed, signed out and in, different browser.

That's usually enough for support to reproduce it. Without it, the first three replies are spent guessing.

> **Never send your password.** No one at Atai will ever ask for it. If someone claiming to be support asks, it's not us.

## 3. Quick lookup — where to go

| I want to… | Go to |
|---|---|
| Verify my email | the link in your welcome email, or Settings |
| Reset my password | "Forgot password" on the sign-in page |
| See my credits or billing | Settings → Billing |
| Manage sessions / security | Settings → Security |
| Turn optional features on/off | Settings → Features |
| Watch a build in progress | your project's build / progress view |
| Change my plan | Settings → Billing → your subscription |
| Contact support | support@atai.ink |

## 4. Error message reference

Short explanations for messages you're most likely to see. Find the wording that matches what's on your screen.

| Message | What it usually means | What to do |
|---|---|---|
| **"Invalid credentials"** | Wrong password, unverified email, or the account was closed. | Reset your password, or verify your email. |
| **"Email not verified"** | Your account needs verification before it unlocks. | Open the link in your welcome email; resend if needed. |
| **"Not enough credits"** | Your balance is lower than the action needs. | Check Settings → Billing, or earn credits via referrals. |
| **"Unauthorized"** | A key is missing, wrong, or revoked. | Re-check the key in your app's secret settings. |
| **"Rate limited"** | Too many requests in a short time. | Slow down, wait a moment, retry. |
| **"Failed to save"** | A value doesn't match its field type, or a required field is empty. | Check each field and try again. |
| **"Not found"** | The item was renamed or deleted, or the link is old. | Open it from the list in your project instead. |
| **"Something went wrong"** | A temporary error with no further detail. | Refresh and retry; report it if it repeats. |
| **"Coming soon"** | The area is still being built or rolled out. | Use the version inside your project, or check back. |
| **"Session expired"** | You were signed out for security. | Sign in again. |

If your message isn't here, search this page for a few of its words — the sections below are grouped by area.

## Common problems

**Signing in**

### "Invalid credentials" or I can't log in
- *Cause:* wrong password, email not verified, or the account was closed.
- *Fix:* use [Forgot password](/forgot-password) on the sign-in page, or [sign in](/login) with Google. If you never verified your email, do that first at the [verification page](/verify-email). If you think your account was closed, contact support.

### It says "verify your email" and I feel locked out
- *Cause:* your account unlocks after you verify your email.
- *Fix:* open the verification link in your welcome email. If you didn't get it, use **Resend email** and check spam and promotions.

### The verification email never arrives
- *Fix:* on the [verification page](/verify-email), click **Resend**, wait a minute, and check spam and promotions. Still nothing? Contact support.

### I keep getting logged out
- *Cause:* sessions expire after a while for security.
- *Fix:* sign in again. You can review active sessions in Settings → Security.

### Google sign-in shows an error
- *Fix:* try signing in with email and password instead. If Google sign-in keeps failing, contact support.

### "Something went wrong" with no detail
- *Fix:* refresh and try again. If it keeps happening, contact support with a screenshot and the time it happened.

### I signed up but never got the welcome email
- *Fix:* check spam, promotions, and any filtered folders. Add the sender to your contacts and resend. If you signed up with a work email, ask your IT team whether external mail is being blocked.

**Credits & billing**

### "Not enough credits"
- *Cause:* your balance is lower than what the action needs.
- *Fix:* check Settings → Billing to see your balance and options, or earn free credits through referrals. Tip: use the standard build option for your first project, and refine your plan before building to avoid re-builds.

### Credits were taken but the action failed
- *Fix:* check your credit history in Settings → Billing. If a charge doesn't have a matching refund, contact support with your project name and the time.

### I paid but don't see the credits
- *Fix:* refresh the page. If you returned from checkout and still don't see them, check your credit history, then contact support with your receipt.

### The page shows credits but a build says I don't have enough
- *Fix:* refresh the page and check your credit history. If it still looks wrong, contact support.

### I need to change or cancel my plan
- *Fix:* go to Settings → Billing, open your subscription, and change or cancel it there.

### I was charged twice
- *Fix:* check your credit history first — a pending and a completed charge can look like two charges. If both completed, contact support with both receipt references and we'll sort it out.

**Building your app**

### My project is stuck on "Analyzing"
- *Cause:* analyzing a website can take several minutes.
- *Fix:* wait a little, then refresh. If it's been very long, use the retry option in your project workspace.

### My plan won't generate
- *Cause:* the website blocked access, or the description was too vague.
- *Fix:* try a clearer description or a different website, then retry.

### My build failed
- *Cause:* a temporary error, or the plan was very large.
- *Fix:* use **Retry** in the workspace. If it keeps failing, simplify the plan or try the more powerful build option.

### Small changes after building cost a lot
- *Cause:* changing the plan after building re-runs the build.
- *Fix:* get the plan right before building. After building, make small changes with the edit / instruction box instead of rebuilding.

### My app doesn't look like the plan
- *Cause:* the plan changed after the build, or the build used an older version.
- *Fix:* check the plan, make a small edit with the instruction box, or rebuild from the latest plan.

### My build finished but pages are blank
- *Fix:* refresh the preview. If it's still blank, open the browser console and note any red errors, then report them with a screenshot. Blank pages are usually a data problem — check that any table your app reads actually has records.

### I can't edit my app after building
- *Fix:* make sure the build has finished and you're in the project workspace, not the plan editor. If the edit box is disabled, wait for the build to complete, then try again.

**Publishing & domains**

### My published site shows an old or broken version
- *Fix:* refresh the page and re-publish from your project. Make sure the latest build is the one that's live.

### My custom domain won't connect
- *Cause:* the domain settings haven't finished updating, or the records are wrong.
- *Fix:* copy the exact settings shown in your project, wait for them to take effect (this can take a while), then try again. If you use a free Atai address, no setup is needed.

### My site loads for me but not for others
- *Cause:* you may be seeing a cached or preview version that isn't public yet.
- *Fix:* confirm the project is published, then open the live link in a private window. If it works there, your browser was showing an old copy.

### A page says "Coming soon"
- *Cause:* some areas are still being built or rolled out.
- *Fix:* use the version inside your project instead, or check back later.

### The free address stopped working
- *Fix:* check the project is still published and the build succeeded. Re-publish if unsure. If you changed your project's name, the address may have changed too.

**Database**

### A table says "not found"
- *Fix:* open **Database** in your project and choose the table from the list.

### I can't edit the ID or timestamps
- *Fix:* those are managed by Atai — this is expected. Add your own text field if you need a reference number.

### "Failed to save" a record
- *Fix:* check each field matches its type (for example, numbers where numbers belong) and fill in required fields, then save again.

### My app doesn't show the data I added
- *Fix:* refresh the app, confirm you're in the right project, and give it a moment to update.

### I deleted a record and need it back
- *Fix:* there's no undo inside the app. Restore from a backup or export if you have one. If the data matters, contact support quickly and describe exactly what was deleted.

### A link field shows nothing to choose
- *Fix:* the other table is probably empty. Add one record there first, then return to the link field.

**Developer & API keys**

### My app says "Unauthorized"
- *Fix:* make sure your key is set in your app's secret settings and still active in your project's developer / API settings. Rotate it if unsure.

### My key works locally but not live
- *Fix:* add the key to your hosting provider's secret settings and redeploy.

### I'm rate limited
- *Fix:* slow down and retry. Check your usage in your project settings.

### I think my key leaked
- *Fix:* revoke it immediately in your project's developer / API settings, create a new one, and update your app. Then review where the old key might have been exposed.

### The SDK says my configuration is invalid
- *Fix:* the key is missing or empty where your code runs. Load it from an environment variable and confirm it isn't undefined at startup.

**GitHub**

### Connecting GitHub fails
- *Cause:* the connected account doesn't have permission to the repository.
- *Fix:* reconnect with the right GitHub account and grant access to the repository.

### I connected GitHub but my changes don't appear
- *Fix:* check you're looking at the right branch, and that the connection is still listed in your project settings. Reconnect if it was revoked.

**Growth tools**

### A growth tool is greyed out
- *Fix:* check Settings for a toggle; if you can't enable it, it isn't available for your account yet.

### The SEO audit won't run
- *Fix:* publish your project first, then run the audit.

### Content or campaign output is generic
- *Fix:* add detail to your business plan — a clear offer, audience, and tone. Thin input produces thin output.

**Account & security**

### I want to change my email
- *Fix:* update it in your profile settings. You'll need to confirm the change by email.

### I want to delete my account
- *Fix:* contact support. Account deletion is handled carefully so your data and billing history are treated correctly.

### I don't recognize a sign-in
- *Fix:* change your password immediately in Settings → Security, sign out of all devices, and contact support.

### I lost access to my email address
- *Fix:* contact support from a message that proves you own the account, and explain the situation. Don't create a new account — that makes recovery harder.

## 5. Still stuck?

Contact support at **support@atai.ink**. Include:

1. **Your project name** (not your password — never send passwords).
2. **What you were trying to do.**
3. **What happened instead** — paste the exact message if you can.
4. **When it happened** (roughly).

With those four things, support can usually help quickly.

### What happens after you write

- You'll normally get a reply that either solves it or asks one clarifying question.
- If the issue is a bug, it gets logged with the details you sent — which is why the exact message and time matter.
- If you don't hear back within a couple of working days, reply on the same thread rather than starting a new one; that keeps the history together.

### Faster alternatives

- The [Getting Started guide](/docs/onboarding) answers most "how do I…" questions.
- The [Database Manager guide](/docs/database-manager) covers data problems.
- The [Runtime, SDK & API guide](/docs/runtime-api) covers keys and errors in code.
- The [Growth playbook](/docs/growth-marketing) covers anything marketing-related.

## 6. Related guides

- **[Getting Started guide](/docs/onboarding)** — the full walkthrough from sign-up to launch.
- **[Database Manager guide](/docs/database-manager)** — tables, records, and links.
- **[Runtime, SDK & API access](/docs/runtime-api)** — keys, errors, and integrations.
- **[Growth & marketing playbook](/docs/growth-marketing)** — growing after launch.
