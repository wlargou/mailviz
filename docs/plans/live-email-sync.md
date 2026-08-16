# Live Bidirectional Email Sync with Gmail

> **Committed deliberately.** This plan used to live in `.claude/`, which is gitignored, so it
> never survived a clone — and it silently rotted, because nothing in CI or review ever read it.
> Its remaining work is item **2.1** in [`BACKLOG.md`](../../BACKLOG.md), which is the roadmap
> anyone is obliged to keep current. This file is the *design* detail behind that one line;
> update it in the same commit as the work, or delete it when Phase 4 ships.

## Status: PHASES 1–3 AND 5 COMPLETE — PHASE 4 (Pub/Sub) NOT STARTED

Phase 5 was completed after Phase 4 was deferred: the resilience work stands on its own, and
polling is a deliberate stand-in for push rather than a stopgap waiting on it.

---

## Phase 1 — Gmail Actions + Scope Upgrade + Archive/Trash Support
> **Status: COMPLETE ✅**

### 1a. Upgrade OAuth scope `gmail.readonly` → `gmail.modify`
- [x] Update `SCOPES` in `server/src/services/googleAuthService.ts`
- [x] Add scope mismatch detection in `getStatus()` to prompt re-auth
- [x] Add re-auth warning banner + "Reconnect Google" button in Settings page

### 1b. Add archive/trash fields to Email model
- [x] Add `isArchived` and `isTrashed` to Prisma schema
- [x] Run migration `20260317024859_add_email_archive_trash_fields`

### 1c. Add archive/trash/unarchive/untrash actions to emailService
- [x] `archive(id)` — remove INBOX label on Gmail + set `isArchived = true`
- [x] `unarchive(id)` — add INBOX label on Gmail + set `isArchived = false`
- [x] `trash(id)` — call `messages.trash()` on Gmail + set `isTrashed = true`
- [x] `untrash(id)` — call `messages.untrash()` on Gmail + set `isTrashed = false`

### 1d. Add new API routes
- [x] `PATCH /emails/:id/archive`
- [x] `PATCH /emails/:id/unarchive`
- [x] `PATCH /emails/:id/trash`
- [x] `PATCH /emails/:id/untrash`

### 1e. Update incremental sync to handle archive/trash labels
- [x] Detect INBOX added/removed → update `isArchived`
- [x] Detect TRASH added/removed → update `isTrashed`
- [x] Update `labelIds` array on label changes
- [x] Derive `isArchived`/`isTrashed` in `upsertMessage()` from labels

### 1f. Update client API + UI
- [x] Add `archive()`, `unarchive()`, `trash()`, `untrash()` to `client/src/api/emails.ts`
- [x] Add archive/trash actions to ThreadDetail overflow menu
- [x] Add "Archived" and "Trash" folder tabs in MailPage
- [x] Hide trashed emails from non-trash views by default
- [x] Update `EmailMessage` type with `isArchived`, `isTrashed`
- [x] Update `GoogleStatus` type with `needsReauth`

---

## Phase 2 — Automated Polling Sync (Background Sync)
> **Status: COMPLETE ✅**

### 2a. Background sync scheduler
- [x] Install `node-cron` dependency
- [x] Create `server/src/jobs/emailSyncScheduler.ts` — poll every 60s via `emailService.syncFromGmail()`
- [x] Start scheduler on server boot in `index.ts`
- [x] Add `SYNC_INTERVAL_SECONDS` env var (default 60)
- [x] Add `EMAIL_SYNC_ENABLED` env var (default true) to disable if needed

### 2b. Sync status tracking
- [x] Add `isSyncing` flag to prevent concurrent syncs
- [x] Log sync results (new emails count, errors)
- [x] Add `GET /emails/sync-status` endpoint
- [x] Add `getSyncStatus()` to client API
- [x] Initial sync runs 5s after server boot

---

## Phase 3 — WebSocket for Client Push
> **Status: COMPLETE ✅**

### 3a. WebSocket server setup
- [x] Install `ws` dependency
- [x] Create `server/src/websocket.ts` with `initWebSocket(server)` and `wsEmit(event, data)`
- [x] Capture HTTP server in `index.ts` and pass to `initWebSocket()`
- [x] Client connection tracking + logging

### 3b. Emit events from sync + actions
- [x] `emails:synced` — when background sync finds new emails
- [x] `email:updated` — on markAsRead/Unread, toggleStar, archive/unarchive, trash/untrash
- [x] `sync:status` — syncing true/false at start/end of each sync cycle

### 3c. Client WebSocket hook
- [x] Create `client/src/hooks/useEmailWebSocket.ts`
- [x] Auto-reconnect with exponential backoff (1s → 30s max)
- [x] Dev-mode aware (connects to port 3002)
- [x] MailPage: auto-refresh thread list on `emails:synced` and `email:updated`
- [x] AppSideNav: auto-refresh unread badge count on any email event
- [x] Fallback 60s polling preserved in sidebar

---

## Phase 4 — Google Cloud Pub/Sub (Production Real-Time)
> **Status: NOT STARTED** — verified: no `gmailWatchService`, no `watchExpiration` column, no
> `/webhooks/gmail` route, no `GMAIL_PUSH_ENABLED` anywhere in the tree. Tracked as BACKLOG 2.1.

### 4a. GCP Setup
- [ ] Enable Pub/Sub API
- [ ] Create topic + subscription pointing to webhook URL
- [ ] Grant Gmail push publish rights

### 4b. Watch registration
- [ ] Create `server/src/services/gmailWatchService.ts`
- [ ] `watch()` call on startup + auto-renewal every 6 days
- [ ] Store `watchExpiration` in GoogleAuth

### 4c. Webhook endpoint
- [ ] `POST /api/v1/webhooks/gmail` — decode Pub/Sub notification, trigger incremental sync
- [ ] Validate Pub/Sub signature

### 4d. Environment-based strategy
- [ ] `GMAIL_PUSH_ENABLED=true` → Pub/Sub + webhook
- [ ] `GMAIL_PUSH_ENABLED=false` → polling fallback (Phase 2)

---

## Phase 5 — Resilience & Polish
> **Status: COMPLETE ✅**

- [x] Optimistic UI updates (immediate state change, rollback on error) — this was already
      implemented when the plan was written; the checkbox was simply never ticked.
- [x] Rate limiting with `bottleneck` for batch operations — `server/src/lib/gmailLimiter.ts`.
      A per-user Bottleneck Group wraps every Gmail call at the single choke point
      (`getGmailClient`), with retry/backoff on 429 and rate-limit 403s **only** — a plain 403 is
      a scope problem and must still surface as "reconnect", not be retried. Tuned by
      `GMAIL_MAX_CONCURRENT`, `GMAIL_MIN_TIME_MS`, `GMAIL_MAX_RETRIES`, `GMAIL_RETRY_BASE_MS`,
      `GMAIL_RETRY_MAX_MS`.
- [x] Smarter history fallback (re-sync 7 days instead of 3 months) — `SYNC_CATCHUP_DAYS`
      (default 7). The 404 path previously fell through to a full `initialSync`, which with
      `EMAIL_SYNC_MONTHS=0` re-synced the entire mailbox.
- [x] WebSocket reconnect indicator in UI — `client/src/components/layout/ConnectionStatus.tsx`.
      Shown only on a genuine drop: nothing renders while connected, and nothing renders during
      the first connection attempt on page load.
- [x] Sync-on-reconnect for missed changes — `onReconnect` on `useEmailWebSocket`, wired in
      `MailPage`, `CalendarPage` and `AppSideNav`. Fires only after a real drop, never on the
      first connect (covered by `useEmailWebSocket.test.tsx`).

### Not in the original plan, done alongside

- [x] **One shared WebSocket.** Each mounted hook opened its own socket (4 concurrent). Now a
      single reference-counted connection, which is also what makes a single
      `ConnectionStatus` indicator meaningful.

### Coverage

`server/src/services/emailService.sync.test.ts` exercises the incremental/initial sync paths and
the batch operations against a mocked Gmail API, including the bounded catch-up above. Send,
reply, forward and attachments remain untested.
