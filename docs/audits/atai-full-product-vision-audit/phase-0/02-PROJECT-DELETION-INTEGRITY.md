# 02 — Project deletion integrity (S-02 / D-01)

**Status: PASS — verified in the current tree, honest-disclosure variant for external teardown.**
Landed before this report in `91da59e` (cascade) and `fd27a30` (dialogs); Phase 0 re-verified it
against the working tree rather than re-implementing it.

## Original concern

Deleting a project could remove only the project document while leaving its Runtime API keys
active, linked records orphaned, and the generated application publicly reachable — i.e. a
founder who deleted a business would unknowingly leave live credentials and a live app behind.

## Verified deletion dependency map (current behavior)

`store.deleteProject(id, userId)` — `lib/store/mongo-store.ts:536-615` — runs the whole
sequence inside **one Mongo transaction** on a session, with ownership as part of the delete
filter (`deleteOne({ id, userId })`), so a request can never cascade a project it does not own.

| Collection | Records | Decision | Where |
|---|---|---|---|
| `projects` | 1 | **Deleted** (ownership-checked, atomic) | `:548` |
| `api_keys` | all active for the project | **Revoked**, not deleted: `status: "revoked"`, `revokedAt`, `revokedReason: "project_deleted"` | `:554-559` |
| `build_runs` | by `mirrorProjectId` | **Deleted** | `:560` |
| `project_attachments` | | **Deleted** | `:562` |
| assets, chats, planning runs, content items, brand profiles, growth tasks, campaigns, business lessons, analytics events, project likes, project GitHub links (11) | | **Deleted** via an explicit allowlist | `:567-582` |
| `project_runtime_config` | | **Deleted** | `:583-584` |
| `project_forks` | either direction | **Deleted** | `:585-588` |
| `cofounder_conversations` | `activeProjectId`, `projectContextReferences` | **Detached**, history kept (`$unset` / `$pull`) | `:589-599` |
| `cofounder_pending_actions` | pending/approved for the project | **Expired** | `:600-604` |
| credit ledger, payments/refunds, runtime usage, audit events | | **Retained on purpose** — accounting, refund and security evidence must survive the business that produced it. The allowlist exists so they cannot be caught by a wildcard. | `:566` comment |

Cached reads (`proj:<id>`, `projs:<userId>`) are invalidated after commit (`:609-610`).

## Credential revocation behavior

Revocation is by status, not deletion, so the audit trail keeps the key's identity while
`lib/runtime/auth/authenticate.ts` rejects it. Two independent guards make revocation
immediate:

1. The key lookup requires an active status.
2. Authentication **bypasses project caches** and re-reads the project (`authenticate.ts:182-191`);
   if the project row is gone the key authenticates as `invalid`. A stale cache therefore cannot
   keep a deleted project's key alive.

Revocation is idempotent (`updateMany` on `{ projectId, status: "active" }`) and inside the same
transaction as the delete, so a retry cannot leave a half-revoked state.

## External (Totalum) behavior — the honest-disclosure decision

`lib/integrations/totalum/service.ts` exposes no application delete, deactivate or
access-revoke operation — only record/secret operations. So §5.3C's "if teardown cannot be
verified, do not pretend" branch applies. The API response states it explicitly
(`app/api/projects/[id]/route.ts:283-288`):

```json
{ "deleted": true, "runtimeKeysRevoked": true, "externalResourcesRemoved": false,
  "warning": "Hosted apps, external files, domains and subscriptions are not removed or cancelled. Shut them down separately. Financial and audit records are retained." }
```

The same disclosure is shown **before** the founder confirms, in the project card delete dialog
(`components/project-card.tsx:84`) and the workspace delete dialog, and in the co-founder's
delete tool result (`lib/cofounder/tools/projects.ts:247`) — so a chat-driven deletion cannot
come back as a bare "Deleted successfully". No code path claims the external app was removed.

## Retry and failure behavior

Because the cascade is one transaction, any step that throws (revocation, a `deleteMany`, the
fork sweep) aborts the commit — the project survives with its keys intact rather than being
deleted with live credentials. There is no partial state to retry and no separate job queue was
built for this. Repeated DELETE calls after a committed deletion return 404 (`:275-281`), which
is safe; refunds and ledger entries are not part of deletion, so no double-refund path exists.

**Known gap (documented, not hidden):** if the transaction aborts, nothing records *why* on the
project; the operator sees the error and the API's `handleRouteError` path. §5.3F's "record the
failed step" is satisfied only by logs (`store.deleteProject` result lines), not by a stored
deletion state.

## Active-operation protection

- Runtime requests: rejected at authentication (revoked key / missing project).
- Builds: the launch and follow-up paths resolve the project and its key before charging; a
  deleted project cannot provision or authenticate.
- Webhooks: write payment/subscription facts keyed by stored ids and cannot recreate a project
  document; there is no upsert that revives a deleted project.
- Pending co-founder actions: expired as part of the cascade, so an approved-but-unrun action
  cannot act on a deleted project.

## Tests

`lib/store/mongo-store.deletion.test.ts` (5 tests): owner-checked transaction semantics; keys
revoked inside the same transaction; **no** revocation or cascade when the project is missing or
belongs to another user; revocation failure propagates out rather than committing an unsafe
deletion; cascade failure propagates; cached reads invalidated after commit.

Plus `authenticate` tests covering revoked/deleted-project keys, and the co-founder tool tests
covering the disclosure text.

## Remaining limitations

1. External teardown is impossible today, so deletion is **incomplete by design** and labelled
   as such. Founder follow-up is manual: shut down the hosted app, DNS/domain, and any
   subscriptions bought in their own names.
2. Retained financial records are still reachable through admin finance surfaces (intended) but
   not through the deleted project's keys (enforced).
3. If Totalum later exposes a delete/deactivate call, the response contract already has the
   right shape: flip `externalResourcesRemoved` only on provider confirmation, keep retries
   idempotent, and never mark deleted before that confirmation.
