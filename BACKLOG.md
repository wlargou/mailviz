# MailViz Backlog

Working order: **Phase 1 → 2 → 3 → 4**. Phase 1 is cheapest per unit of value
(the backend already exists); Phase 4 is the one that de-risks everything else.

This file is committed deliberately, and it is the only roadmap anyone is obliged
to keep current. The earlier plans lived in `.claude/plans/`, which is gitignored:
they never survived a clone, and nothing in CI or review ever read them, so they
rotted. Two of them survive as design detail in `docs/plans/`; the Carbon audit
that used to live in `TODO-CARBON-AUDIT.md` is folded in below.

---

## Phase 1 — Built but unreachable

Backend, route and client wrapper all exist. Only the UI is missing, so these are
the cheapest items in the backlog.

- [x] **1.1 Label management UI** — `labelsApi.create/update/delete` have **zero
  callers**. Labels can currently only be created by `server/src/prisma/seed.ts`.
  You can attach labels to tasks but never create, rename or delete one.
  Add a Settings tab alongside Task Statuses / Company Categories / Deal Partners.
- [x] **1.2 Task assignment through its real endpoint** — `PATCH /tasks/:id/assign`
  is unused; `TaskDetailModal` sets `assignedToId` via the generic `PATCH /tasks/:id`.
  Consequence: the `task:assigned` notification and WebSocket event **never fire**.
  Assignment works, but nobody is told about it.
- [x] **1.3 Reschedule a scheduled email** — `emailsApi.updateScheduledEmail` has no
  caller. You can schedule and cancel, but not change the send time.
- [x] **1.4 Drag-to-reorder** — `PATCH /task-statuses/reorder` and
  `/company-categories/reorder` are fully built. No drag UI exists, so `position`
  is only ever set at creation time.
- [x] **1.5 Index Deals in global search** — `searchService` queries emails, tasks,
  events, customers and contacts. Deals are a first-class entity with their own
  page and are not searchable.
- [x] **1.6 "Shared with me" affordance** — `utils/accessControl.ts` genuinely works
  and shared items appear in the recipient's normal lists, but nothing marks them.
  There is no way to answer "what has been shared with me?". Needs at minimum a
  badge on shared rows, ideally a filter.
- [x] **1.7 Audit logging in `labelService`** — the only service with zero
  `auditService.log` calls. (Note: customer/deal/calendar services *do* log,
  3–4 actions each — an earlier audit claimed otherwise and was wrong.)

### Phase 1 follow-ups

- [ ] **Shared badge on email threads** — the badge + `ownership` query-param
  pattern from 1.6 applies to mail threads too, but `MailPage.tsx` was locked
  during that work. Reuse `shared/SharedBadge.tsx` and the `ownership` param.

## Phase 2 — Roadmap, scoped but not started

Design detail for 2.1 and 2.3 is in [`docs/plans/`](docs/plans/).

- [ ] **2.1 Gmail Pub/Sub real-time (live-email-sync Phase 4)** — the one
  architecturally significant item left. Production runs 60s polling as a
  deliberate stand-in. Needs: GCP topic/subscription, `gmailWatchService.ts`,
  `watchExpiration` on GoogleAuth, `POST /api/v1/webhooks/gmail`, and a
  `GMAIL_PUSH_ENABLED` strategy so local dev keeps polling.
- [~] **2.2 Sync resilience (live-email-sync Phase 5)** — partially done.
  - [x] Optimistic UI — was already implemented; the plan checkbox was stale.
  - [x] Bounded history-expiry catch-up. The 404 path fell through to a FULL
    initialSync, which with EMAIL_SYNC_MONTHS=0 re-synced the entire mailbox
    (111k messages here). Now bounded by SYNC_CATCHUP_DAYS (default 7).
  - [x] Sync-on-reconnect — `onReconnect` refetches in MailPage, CalendarPage
    and AppSideNav.
  - [x] `bottleneck` rate limiting — per-user Bottleneck Group wrapping every
    Gmail call at the single choke point (getGmailClient), with retry/backoff
    on 429 and rate-limit 403s only.
  - [x] WebSocket reconnect indicator — a "Reconnecting" tag in the header,
    shown only on a genuine drop (not first connect, not while connected).
  - [x] **Shared WebSocket** — was one socket per mounted hook (4 concurrent);
    now a single reference-counted connection.
- [~] **2.3 Calendar create-flow gaps** — partially done. (Attendees,
  sendUpdates, Google Meet, colorId and the date/time pickers were already
  shipped — that plan's gap table was stale.)
  - [x] **Recurrence on create** — presets (Daily / Weekly on <weekday> /
    Monthly on day N / Yearly) anchored to the start date. Custom builder
    deliberately omitted; an unrecognised existing RRULE is shown read-only
    and never rewritten.
  - [x] Reminders — useDefault toggle plus up to 5 (method, minutes) rows,
    enforcing Google's caps (5 overrides, 40320 minutes).
  - [x] Visibility — Calendar default / Public / Private.
  - [ ] Custom recurrence builder (INTERVAL/COUNT/UNTIL/multi-BYDAY).

## Phase 3 — Genuine product gaps

- [ ] **3.1 Drafts** — Gmail drafts are not synced at all. No save-and-return in
  compose. The most conspicuous absence for a mail client.
- [ ] **3.2 Contact dedupe / merge** — auto-discovery creates contacts from every
  sender domain across ~111k emails and 11k contacts. There is no merge, no
  dedupe, no "is this the same person" affordance. Most likely to bite at this
  data volume.
- [ ] **3.3 Mail Review pagination** — `ReviewMailView.tsx` hardcodes `limit: '500'`
  and filters client-side, so reviewing a long period silently truncates.
- [ ] **3.4 Deal value** — deals have no amount, currency, probability or close
  date; statuses are TO_CHALLENGE / APPROVED / DECLINED. Coherent for *partner
  deal registration*, which is what this is. But the schema cannot answer "how
  much is in flight". Only worth doing if pipeline reporting is a goal — decide
  before building.
- [ ] **3.5 Email templates / snippets** — zero references anywhere.
- [ ] **3.6 Snooze and follow-up reminders** — zero references anywhere.
- [ ] **3.7 CSV import / export** — no way to get data in or out.
- [ ] **3.8 Mail rules / filters** — no client-side rules engine.

## Phase 4 — Testing

Done. **195 server + 8 client tests**, run in CI against a real Postgres with a
per-run database. See `server/src/test/README.md` for how the harness works and
why it is not mocked.

Standing this up found four pre-existing bugs, all invisible to typecheck and
build: a cross-tenant leak in mail search, six "per-user" unique indexes a
migration only believed it had dropped, a migration chain that could not apply to
an empty database, and a `decrypt()` edge case. Three of the four were
multi-tenant.

- [x] **4.1 Test harness** — Vitest in both workspaces, running against a real
  Postgres (`mailviz_test`). A mocked Prisma would have passed the deal leak,
  so the DB is the point. CI creates the database and runs both suites.
- [x] **4.2 Money paths**
  - [x] Multi-tenant isolation: deals, tasks, emails, contacts, customers,
    accessControl — including the search-plus-filter combination that caused
    the original leak.
  - [x] OAuth token encryption, incl. the legacy-plaintext passthrough.
  - [x] JWT sign/verify and the access/refresh secret separation.
  - [x] validate middleware (the Zod v4 `.errors` 500 regression).
  - [x] Gmail incremental sync, initial sync and the bounded history-expiry
    catch-up — mocked at the `getGmailClient()` seam (`src/test/gmailMock.ts`).
  - [x] The batch email actions, including that they cannot cross tenants.
  - [ ] Send / reply / forward / attachments — still uncovered.
- [x] **4.3 Client typecheck is blocking in CI** — `continue-on-error` removed.

---

## Follow-ups from the test work

- [x] **`sortBy` whitelists** — all four services now validate `sortBy` and
  `sortOrder` against an allow-list instead of passing the raw query value to
  Prisma's `orderBy`.
- [x] **The suite is concurrency-safe** — each run creates and drops its own
  `mailviz_test_<random>` database, so parallel runs cannot truncate each
  other's fixtures.
- [ ] **Gmail send paths still untested** — sync and batch operations are now
  covered; send, reply, forward and attachments are not.

## Departures from the shipped plans

Recorded here because `notification-system.md` and `001-mail-review.md` are not
being kept — the plans described work that shipped, and only these divergences
are still worth knowing.

- [ ] **`EMAIL_RECEIVED` notifications were never built.** The notification plan
  specified the type; there are zero server references. It was the only
  heuristic-driven type, which is probably why it was dropped — but nothing
  recorded that decision.
- [ ] **The notification panel is hand-rolled**, not `@carbon/ibm-products`
  `NotificationsPanel` as planned: no `badgeCount`, and a flat list with relative
  timestamps instead of day-bucketed grouping.
- [ ] **Mail Review's unread filter is client-side**, applied after the fetch
  rather than as `isRead=false` server-side — so it cannot recover threads the
  500-row cap (3.3) has already dropped. Fixing 3.3 without this leaves the
  filter still lossy.
- [ ] **Mail Review uses a custom collapsible** rather than Carbon `Accordion`.

## Bugs found by the Gmail sync tests

Characterisation-tested and named `— KNOWN BUG` in
`server/src/services/emailService.sync.test.ts`, so each test turns red when the
bug is fixed. A fourth (sync counters discarded on history expiry) is already
fixed.

- [ ] **`isArchived` disagrees between the two write paths.** `upsertMessage`
  computes `isArchived = !INBOX && !TRASH` (false for trashed mail); the
  incremental `labelsRemoved` handler sets it true from INBOX-removal alone.
  Gmail sends a trash as one record that removes INBOX and adds TRASH, so the
  flag depends on which path touched the row last. Masked while `isTrashed` is
  true — but `untrash()` clears only `isTrashed`, so trash-then-restore leaves
  the message flagged archived and it never returns to the inbox view.
- [ ] **`batchTrash`/`trash` accumulate duplicate TRASH labels.**
  `[...labelIds.filter(l => l !== 'INBOX'), 'TRASH']` strips idempotently but
  appends unconditionally, so `labelIds` grows on every call. Reachable
  normally, since the batch actions fan out over a whole thread and re-trash
  messages already in it. `batchArchive` is unaffected (removal only).
- [ ] **A 403 from the trailing `getProfile` escapes the reconnect translation**
  (`emailService.ts:66`, outside the try/catch). It surfaces with no `status`,
  so `emailSyncScheduler.ts` treats a revoked Gmail grant as unexpected and logs
  it every 60 seconds forever, and the HTTP layer answers 500 instead of 403.
- [ ] **The rate limiter is untestable at the Gmail mock seam** — it lives inside
  `getGmailClient()`, which those tests replace. Its backoff and retry need a
  unit test against `withGmailRateLimit` directly.

## Carried-over quality items

Not blocking, but known and deliberate.

- [ ] `CustomerDetailPage`'s edit Modal is not consolidated with
  `CustomerCreateModal` — it has a Category dropdown the create form lacks, so
  reusing it would silently drop category editing. Fix by adding category support
  to the create component first.
- [ ] Thread-row markup exists in **three** near-identical copies (`MailPage`,
  `ReviewMailView`, `shared/ThreadItemList`).
- [ ] `shared/PageHeader` is used by 3 of ~14 pages; the rest hand-roll the same
  markup and therefore have no breadcrumbs.
- [ ] The four main list pages (Customers, Contacts, Deals, Tasks) use `DataTable`
  as a styling shell only — they pass throwaway rows and destructure just
  `getTableProps`, so **none of them can sort**. No `TableSelectRow` /
  `TableBatchActions` anywhere; the bulk-action bar in `MailPage` is hand-rolled
  outside the table system.
- [ ] `ComposeToolbar` still uses a hand-rolled `DropdownMenu` (no keyboard nav,
  no ARIA) — should be Carbon `MenuButton`, as the dashboard Create menu now is.
- [ ] `EventTooltip` is a hand-rolled global tooltip singleton; ~10 places use the
  native `title=` attribute. Carbon `Tooltip` is used nowhere.
- [ ] Carbon audit item C8: `_mail.scss` sets `.cds--content-switcher { width: 100% }`
  and `max-inline-size: none`, deliberately defeating Carbon's width cap.
- [ ] ~26 font sizes and ~59 spacing values sit off Carbon's scale. Left alone
  deliberately — forcing them would change the design. Needs a design decision.
  (Re-measured during the doc audit; the spacing figure was previously
  understated as 31.)
- [ ] **Carbon A1 — keyboard access on clickable divs.** A P0 from the Carbon
  audit that was never started. Bare `<div onClick>` with no `role="button"`,
  `tabIndex` or `onKeyDown`: `dashboard/TopCustomers.tsx:45`,
  `RecentActivity.tsx:33`, `RecentTasks.tsx:35`, `ExpiringDeals.tsx:34`,
  `UpcomingEvents.tsx:45`, and `calendar/CalendarDayCell.tsx:127` plus its
  overflow-popover rows at `:68`/`:79`. Mechanical: the correct pattern is
  already implemented in six other components (`ThreadItemList`, `MailPage`,
  `ThreadDetail`, `ReviewMailView`, `CustomerSummary`, `TaskDetailModal`).
- [ ] **Carbon B3 — `ComposeToolbar` colour array.** `ComposeToolbar.tsx:51-56`
  holds 21 raw hex values and never imports `@carbon/colors`. Every value is
  already a real Carbon palette colour, so this is traceability, not a visual
  change. Cheap now that the `carbon-colors.d.ts` stub which shadowed the
  package's real types is gone.
- [ ] **Carbon B4 — inline `style={{}}` objects.** 106 across 27 files (was
  "54+" when first filed). Worst: `SettingsPage` (16), `CustomerDetailPage` (15),
  `TaskDetailModal` / `CalendarWeekView` / `CalendarDayView` (8 each).
  **Rescope before starting** — calendar views compute per-event pixel offsets
  and the badges paint per-record colours, so a real fraction are legitimately
  dynamic and should not be extracted.
- [ ] **Carbon D2 — logo fallback.** `TopCustomers.tsx:56` shows the company
  initial when there is no logo URL, but `onError` at `:53` only sets
  `display: none` — so a Clearbit 404, the exact case this was filed for, renders
  nothing. Point `onError` at the same placeholder element.
- [ ] **Carbon D5 — consistent empty states.** `shared/EmptyState.tsx` is used by
  10 components, but all five dashboard cards use ad-hoc `.card-empty` divs
  (`TopCustomers:35`, `RecentTasks:29`, `RecentActivity:27`, `ExpiringDeals:25`,
  `UpcomingEvents:28`) and the Review flow uses its own
  (`ReviewMailView:195`, `CustomerSummary:115`). If the cards need a denser
  look, add a `size` prop rather than keeping two markup families.
- [ ] `docs/database-schema.md` is untracked and 3 migrations stale (missing
  `AuditLog`, `Notification`, `User.signature`). Commit and regenerate, or delete.
