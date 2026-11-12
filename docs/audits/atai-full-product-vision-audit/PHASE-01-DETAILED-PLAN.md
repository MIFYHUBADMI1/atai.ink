# PHASE 01 — DETAILED PLAN: Test Reproducibility & CI

**Assignment:** ATAI — Audit Findings Validation & Gap-Closure Planning (deliverable 6)
**Date:** 2026-11-09
**Status:** PLAN ONLY — nothing below has been executed. Implementation starts on explicit founder approval.
**Goal:** a developer can execute this phase top-to-bottom without guessing. Every command is verified against the current tree (Windows 11, Git Bash, Node v24.18.0).

**Ground rules for the executor:**
- The working tree currently holds **79 uncommitted WIP files** (lessons/ads/studio). They must be committed separately by their owner or left uncommitted — **every command below stages by explicit path only; never `git add -A` / `git add .`**.
- `.env` / `.env.local` are never opened, moved, or committed.
- No application code changes in this phase — repo hygiene + CI config only.

---

## 0. Pre-flight (read-only checks, ~2 min)

```bash
cd /c/Users/USER/Desktop/mirrorsiteai
git rev-parse --abbrev-ref HEAD          # expect: main
git rev-parse --short HEAD               # expect: e7cc3b3 (or later — re-baseline if moved)
git status --porcelain | wc -l           # expect: ~79 (re-baseline if changed)

# The four stray artifacts that are TRACKED today (verified 2026-11-09):
git ls-files | grep -E "baseline-test|tmp-test|test-out"
#   .baseline-test.log
#   .tmp-test-phase1.log
#   .tmp-test-verify.log
#   test-out.txt

# The ignored test files that will be restored (verified 2026-11-09):
find lib app components packages -type f \( -name "*.test.ts" -o -name "*.test.tsx" \) | wc -l   # 209
ls packages/atai-sdk/tests | wc -l       # part of the 209? no — counted separately, see 1.2
ls proxy.test.ts                          # 1 stray at repo root
find lib app components packages -path "*__tests__*" -type f | wc -l   # any non-test helpers inside __tests__ dirs must also be restored
```

Suite is known green on this tree: 210 files / 2,499 tests / 409 s (validated 2026-11-09). If your run differs, **stop and reconcile before touching gitignore**.

---

## 1. Stage 1 — Restore test tracking (one commit)

### 1.1 Edit `.gitignore`

Remove lines 25–31 (the comment + six patterns):

```diff
-# Test files are kept locally but not tracked/deployed
-**/*.test.ts
-**/*.test.tsx
-**/*.spec.ts
-**/*.spec.tsx
-**/__tests__/**
-packages/atai-sdk/tests/**
```

Lines 9–11 (`.env`, `.env*.local`, `.tmp/`) **stay exactly as they are**.

### 1.2 Stage exactly the test files

Enumerate first, verify the list contains ONLY test files, then stage:

```bash
git ls-files -o --exclude-standard \
  | grep -E '(^|/)__tests__/|(^|/)[^/]+\.(test|spec)\.(ts|tsx)$|^packages/atai-sdk/tests/|^proxy\.test\.ts$' \
  > /tmp/tests-to-add.txt

wc -l /tmp/tests-to-add.txt        # expect ~210 + any __tests__ helper files found in pre-flight
grep -vE '\.(test|spec)\.(ts|tsx)$|__tests__/|atai-sdk/tests/' /tmp/tests-to-add.txt   # must print NOTHING

xargs -a /tmp/tests-to-add.txt git add
git status --porcelain | grep '^A' | wc -l    # added count == file count above
git status --porcelain | grep -vc '^A'        # WIP files must remain UNSTAGED — expect the pre-WIP count
```

If the grep guard prints anything, remove that path from the list — it is not a test file.

### 1.3 Commit (pathspec-only, per repo convention)

```bash
git commit -m "test: track the vitest suite (210 files) and drop the blanket test ignore rules" -- $(cat /tmp/tests-to-add.txt) .gitignore
```

**Rollback:** `git revert <sha>` — additive only, nothing else depends on it.

---

## 2. Stage 2 — Artifact hygiene (one commit; needs founder approval)

The four stray logs/txt files are tracked today. They are cleanup candidates, not user work — but deletion requires founder sign-off per the audit rules. On approval:

```bash
git rm --cached .baseline-test.log .tmp-test-phase1.log .tmp-test-verify.log test-out.txt
```

Add ignore patterns so local runs never re-track outputs (append to `.gitignore` under a new `# Test/log artifacts` section):

```gitignore
*.log
test-out.txt
```

Commit:

```bash
git add .gitignore
git commit -m "chore: untrack stray test logs and ignore local test artifacts" -- .gitignore .baseline-test.log .tmp-test-phase1.log .tmp-test-verify.log test-out.txt
```

`git rm --cached` untracks without deleting the working copy — the files stay on disk.

**Rollback:** `git revert <sha>`; files return to tracking (working copies never left disk).

---

## 3. Stage 3 — Prove the suite is hermetic (no env files needed)

Do **not** move or rename `.env` files. Clear the environment for the child process only:

```bash
env -i PATH="$PATH" HOME="$HOME" npm test
```

Expected: 210 files / 2,499 tests green. If any test fails here, it reads a real local secret — that test gets a mock before CI goes live (flag it to the founder; do not "fix" by pointing at real credentials).

CI will independently prove the same thing on a clean machine; this step de-risks the first CI run.

---

## 4. Stage 4 — CI workflow (one commit)

Create `.github/workflows/ci.yml`:

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    services:
      mongo:
        image: mongo:7
        ports: ['27017:27017']
        options: >-
          --health-cmd "mongosh --eval 'db.runCommand({ping:1})'"
          --health-interval 10s --health-timeout 5s --health-retries 5
    env:
      MONGODB_URI: mongodb://localhost:27017/mirrorsiteai-ci
      NEXT_PUBLIC_APP_URL: https://atai.ink
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - name: Typecheck
        run: npx tsc --noEmit
      - name: Unit suite
        run: npm test
      - name: Build
        run: npx next build
```

Design notes (why each piece):
- **Mongo service container**: the suite is fully mocked and needs no DB, but `next build` prerendering may read Mongo at build time on some routes. The container makes the build gate work regardless; it costs seconds.
- **`NEXT_PUBLIC_APP_URL`** is the known canonical origin (public value, not a secret). If the first build run reports other missing build-time envs, add **placeholder, non-secret** values only — never copy real secrets into CI.
- **One job, sequential gates**: typecheck fails fastest; test is the main net; build catches prerender/RSC errors nothing else can (per Windows verification record, ~16 min locally — budget 45).
- **No lint gate**: ESLint is broken (v9/legacy mismatch) by design for now — adding it would give a permanently red pipeline.

Commit:

```bash
git add .github/workflows/ci.yml
git commit -m "ci: three-gate pipeline (typecheck, vitest, next build) with mongo for build-time reads" -- .github/workflows/ci.yml
```

Push and watch the first run (`gh run watch` or the Actions tab). **First-run diagnostic table:**

| Symptom | Cause | Remedy |
|---|---|---|
| `npm ci` fails on native deps | Windows-only artifacts in lockfile | regenerate lockfile, re-run |
| Test failures naming env vars | a test reads a real secret (Stage 3 should have caught it) | mock the var in that test |
| Build fails on a missing `NEXT_PUBLIC_*` | page reads a build-time public var | add non-secret placeholder to `env:` |
| Build fails calling an external API during prerender | route prerendering reaches Totalum/Dodo | mark that route dynamic (`force-dynamic`) — **that is an application change: get founder approval for each route** |
| Timeout >45 min | cold cache | accept on first run; cache warm afterwards |

**Rollback:** delete the workflow file; CI is purely additive.

---

## 5. Stage 5 — Branch protection (founder's manual step, ~2 min)

GitHub → repo → Settings → Branches → Add rule for `main`:
1. Require a pull request before merging — **or**, for a solo operator, "require status checks to pass" without PR enforcement is acceptable; choose and record the choice.
2. Required status check: `verify` (the job name above).
3. Do **not** allow force pushes or deletions of `main`.

This is a GitHub-settings action, not code — the executor documents it done, the founder clicks it.

---

## 6. Stage 6 — Error tracker (R-09) — **separate decision, not in the first CI commit**

Stdout-only logging means production incidents are discovered by users. Fixing it needs (a) a vendor choice (Sentry or equivalent — founder's call), (b) a dependency install, (c) a small logger hook — all legitimate, all **out of scope until the founder picks a vendor**. Placeholder acceptance criterion: prod errors visible in the tracker within 5 minutes of occurrence, with project/user context attached.

---

## 7. Verification checklist (phase exit)

| # | Check | Command / method | Expected |
|---|---|---|---|
| 1 | Tests tracked | `git ls-files | grep -cE '\.test\.(ts|tsx)$'` | ≥ 210 |
| 2 | Ignore rules gone | `grep -n 'test' .gitignore` | no test-pattern lines; env lines intact |
| 3 | Clean-clone green | fresh `git clone` → `npm install` → `env -i PATH="$PATH" HOME="$HOME" npm test` | 210 / 2,499 green |
| 4 | CI green on main | Actions tab / `gh run list --limit 1` | `verify` success, three gates |
| 5 | Pipeline actually bites | push a scratch branch with a deliberately failing assertion | `verify` fails < 30 min, then delete branch |
| 6 | Stray artifacts untracked | `git ls-files | grep -E 'baseline-test|tmp-test|test-out'` | empty (after founder approval) |
| 7 | WIP untouched | `git status --porcelain` | the 79 WIP files still present and uncommitted |

---

## 8. Effort and sequencing

| Stage | Effort | Blocked by |
|---|---|---|
| 1 Restore tests | ~30 min (enumeration + guard checks) | founder approval to proceed |
| 2 Artifact hygiene | ~10 min | founder approval for `rm --cached` |
| 3 Hermetic proof | ~10 min | stage 1 |
| 4 CI workflow | ~30 min + first-run watching (~30 min) | stages 1–3 |
| 5 Branch protection | ~2 min (founder) | stage 4 |
| 6 Error tracker | founder decision + ~1 h | independent |

**Total: half a day including the first CI run.** This phase unlocks Phase 2 (security & trust integrity) which every later phase depends on.
