# MailViz Backlog

Working order: **Phase 1 → 2 → 3 → 4**. Phase 1 is cheapest per unit of value
(the backend already exists); Phase 4 is the one that de-risks everything else.

This file is committed deliberately. The earlier roadmap lived in `.claude/plans/`,
which is gitignored, so it never survived a clone.

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

From `.claude/plans/`. Fold those plans into this repo so they stop being
machine-local.

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
  - [ ] `bottleneck` rate limiting for batch operations — not installed.
  - [ ] WebSocket reconnect indicator in the UI — the hook reconnects silently;
    nothing ever tells the user they are disconnected.
  - [ ] **Found while testing:** every mounted `useEmailWebSocket` instance opens
    its OWN socket, so the app holds 3+ concurrent connections (MailPage,
    CalendarPage, AppSideNav, AppShell) and each drop/reconnect happens N times.
    Should be a single shared connection via context or a store.
- [~] **2.3 Calendar create-flow gaps** — partially done. (Attendees,
  sendUpdates, Google Meet, colorId and the date/time pickers were already
  shipped — that plan's gap table was stale.)
  - [x] **Recurrence on create** — presets (Daily / Weekly on <weekday> /
    Monthly on day N / Yearly) anchored to the start date. Custom builder
    deliberately omitted; an unrecognised existing RRULE is shown read-only
    and never rewritten.
  - [ ] Reminders (popup/email X minutes before) — absent everywhere.
  - [ ] Visibility (default/public/private) — absent everywhere.
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

The single largest risk. There is still no test file anywhere in the repo. CI now
runs typecheck, migrations and builds, which catches compile-level breakage, but
nothing verifies behaviour.

This session alone found a SQL injection, a validation path that returned 500 on
every failure, and a field that silently could not be set. All three were
invisible to the build.

- [ ] **4.1 Test harness** — Vitest for both workspaces; wire into `.github/workflows/ci.yml`.
- [ ] **4.2 Cover the money paths, in this order:**
  - multi-tenant `userId` isolation (`utils/accessControl.ts`, every `findAll`)
  - OAuth token encryption/decryption incl. the plaintext-fallback path
  - Gmail incremental sync + history fallback
  - the batch/optimistic email actions
- [ ] **4.3 Make client typecheck blocking in CI** once it has stayed at 0 for a while
  (currently `continue-on-error: true`).

---

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
- [ ] 27 font sizes and 31 spacing values sit off Carbon's scale. Left alone
  deliberately — forcing them would change the design. Needs a design decision.
- [ ] `docs/database-schema.md` is untracked and 3 migrations stale (missing
  `AuditLog`, `Notification`, `User.signature`). Commit and regenerate, or delete.
