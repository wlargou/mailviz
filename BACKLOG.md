# MailViz Backlog

Working order: **Phase 1 → 2 → 3 → 4**. Phase 1 is cheapest per unit of value
(the backend already exists); Phase 4 is the one that de-risks everything else.

**Status as of 2026-09-05:** Phases 1, 3 and 4 are complete. Phase 2 has one
item left (2.1, Gmail push) and one deliberate omission (the custom recurrence
builder). Production runs **1.2.1.0**. The September correctness campaign
(PRs #1–#24) and what it left open are recorded at the bottom of this file,
together with the decisions that are waiting on a person rather than on code.

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

- [x] **3.1 Drafts** — Gmail is the source of truth (`users.drafts`), Postgres a
  mirror so the folder renders from one query. Explicit save rather than
  autosave: one save is one Gmail write, so a timer would be a quota problem.
  Sending uses `drafts.send`, which consumes the draft atomically.
- [x] **3.2 Contact dedupe / merge** — done. `contactMergeService.findDuplicates`
  proposes groups from three explainable rules (same address after cleanup; same
  local part modulo separators on the same root domain; initial form of it) with
  the last two requiring the display names to agree; "Find duplicates" on the
  Contacts page reviews them and merges only on confirmation. 106 groups on the
  real 11.4k-contact database, 36 of the 38 high-confidence ones being an address
  stored twice, once quote-mangled by calendar sync. Name-only matching was
  deliberately not offered — it produced 1,587 pairs, nearly all machine senders,
  including two different people sharing a captured display name. The merge is
  one transaction, and the losing addresses survive on `contact_email_aliases`
  so their mail is not orphaned.
- [x] **3.3 Mail Review pagination** — done. The review now pages per company
  (`ReviewCustomerGroup`, batches of 25 with "Load more"), and every group shows
  "Showing X of Y" against `getReviewSummary`'s thread count, so nothing is cut
  without saying so. The old `limit: '500'` was never even honoured —
  `parsePagination` caps `limit` at 100.
- [~] **3.4 Deal value — decided: not doing this.** Deals have no amount,
  currency, probability or close date, and will not get them. The model is
  coherent for *partner deal registration*: the question it answers is whether a
  partner approved your claim on a deal, not how much revenue is forecast.
  Adding value fields would invite pipeline expectations the rest of the app
  does not meet. Revisit only if Deals is deliberately repositioned as
  opportunity management, which is a different product.
- [x] **3.5 Email templates / snippets** — variables gated twice: unknown names
  rejected at save time, and compose refuses to send while any `{{…}}` survives
  in the final text. Unfilled variables stay verbatim rather than blanking, so
  the damage is visible to the sender. Insert goes at the cursor, never
  replacing the body — the compose window is never empty (the signature is
  seeded on open), so replace-if-empty would have been dead code.
- [x] **3.6 Snooze / follow-up** — state lives in `email_reminders`, not on the
  `emails` row, because the 60s sync rewrites every column there. Threads
  return unread at their real date; bumping `receivedAt` would corrupt the date
  filters, the review buckets and the dashboard.


- [~] **3.7 CSV import / export** — deprioritised. Useful for onboarding data
  or leaving, not for daily use. Not planned.
- [~] **3.8 Mail rules / filters** — deprioritised. Gmail's own filters already
  cover this for mail that syncs in. Not planned.

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
  - [x] Send / reply / forward / attachments — `emailService.outbound.test.ts`,
    `mimeBuilder.test.ts` and `composeValidator.test.ts`, added with the
    coverage sweep of 2026-08-19 and the header-escaping fix (PR #14).
- [x] **4.3 Client typecheck is blocking in CI** — `continue-on-error` removed.
- [x] **4.4 The suite was audited by mutation.** 39 of the first 1018 tests
  survived breaking the code they covered and were repaired (see the CLAUDE.md
  testing notes for the vacuous shapes to avoid). Server: 70 files; client: 30.

---

## Follow-ups from the test work

- [x] **`sortBy` whitelists** — all four services now validate `sortBy` and
  `sortOrder` against an allow-list instead of passing the raw query value to
  Prisma's `orderBy`.
- [x] **The suite is concurrency-safe** — each run creates and drops its own
  `mailviz_test_<random>` database, so parallel runs cannot truncate each
  other's fixtures.
- [x] **Gmail send paths tested** — see 4.2.
- [ ] **CI `verify` duration is drifting.** ~8 minutes for every PR until #22,
  then 20–25 minutes on #22 and #24 and 16 on the merge of #24. Local is ~12.
  Probably loaded runners, but the three route-smoke files are roughly half the
  runtime, and splitting them into their own job is the next step if it recurs.

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
- [x] **Mail Review's unread filter is client-side** — done with 3.3. The toggle
  now sends `isRead=false` to `findAllThreads`, so the unread view is its own
  server-side query rather than a filter over an already-truncated page.
- [ ] **Mail Review uses a custom collapsible** rather than Carbon `Accordion`.

## Data-quality bug found while building contact dedupe

- [x] **`extractDomain` / `domainToCompanyName` do not understand multi-part
  public suffixes.** Fixed in `domainResolver`, and `contactMatching`'s stricter
  local copy now delegates to it so the two cannot drift. Repaired on the dev
  database with `scripts/repairJunkDomains.ts` (dry-run by default): 767 emails
  and 469 contacts moved onto 135 real companies, 31 junk customers removed,
  totals unchanged and zero orphans. **Run the script on any other environment
  that carries this data.** Original text: An address at `someone@acme.co.ma` yields the domain
  `co.ma` and a company named **"CO"**, not `acme.co.ma` / "Acme". Every
  organisation on a country-code second-level domain therefore collapses into
  one junk customer per suffix.

  Measured on the real database: **766 emails and 443 contacts** sit under
  customers literally named "CO" and "COM" — `co.ma` alone holds 673 emails and
  278 contacts belonging to many different companies, and there are 28 such
  buckets (`co.uk`, `co.jp`, `co.il`, `com.tn`, `com.br`, …).

  This is not cosmetic: those emails are linked to the wrong customer, so the
  per-company views, the dashboard's top-customers list and Mail Review's
  grouping are all wrong for that mail.

  Fixing it needs a public-suffix list (the `psl` package, or a pinned subset)
  plus a backfill that re-derives `domain` for existing customers and re-links
  their emails and contacts. The backfill is the hard part — it has to merge
  into whatever correct customer already exists rather than creating duplicates,
  which is exactly what `contactMergeService` now does for contacts.

- [x] **Test fixtures have leaked into the development database.** Cleaned:
  532 of 533 users were test data (one real account, `l.walid@powerm.ma`).
  Deleted with verification that the real account's row counts did not move; all
  86 share rows were checked first and none mixed a test user with the real one.
  The per-run test database plus the new guard in `test/setup.ts` prevent a
  recurrence. Original text: Customers
  named "Alice Corp", "Bob Corp", "Alpha Corp" and "Example" exist on
  `acme.test`, `shared-domain.test` and `msw9…-N.example.com` domains. Harmless,
  but they pollute the customer list and any count taken from it. Worth a
  cleanup query once someone confirms they are not referenced by real mail.

## Sync audit — fixed

- [x] **The history cursor was taken after the initial sync, not before.** Mail
  arriving during a first sync was in neither half: too late for the id list, too
  early for a feed starting at the end. With `EMAIL_SYNC_MONTHS=0` a first sync is
  one `messages.get` per message — hours on a large mailbox — so everything
  received while it ran was lost silently.
- [x] **A failed message fetch was swallowed and forgotten.** `.catch(() => null)`
  skipped it while the cursor moved past, so a transient 500 cost a message
  permanently with nothing to show it existed. Failures are now recorded on
  `google_auth.sync_failed_message_ids` and retried each sync; a 404 (genuinely
  deleted) is dropped rather than retried forever.
- [x] **Outbound mail was filed under the account's own company.** "Powerm" was
  the largest customer in the database at 33,309 emails, 32,359 of them the
  user's own sent mail, while the recipient's company showed none of it. Fixed in
  `upsertMessage`, and repaired with `scripts/refileOwnDomainEmails.ts`: 20,974
  emails moved onto the counterparty, 12,335 genuinely internal ones unlinked,
  totals unchanged, the 120 colleague contacts kept. The calendar importer already
  did this correctly via the attendee `self` flag.
- [x] **Sync and mail events were broadcast to every connected client.** All of
  `sync:status`, `sync:progress`, `emails:synced`, `email:updated` and
  `email:sent` used `wsEmit`, so one account's activity refetched every other
  account's client and leaked its mailbox volume and email ids. Now
  `wsEmitToUser` — which the same file already used correctly for scheduled sends.

## Sync audit — still open

- [x] **Calendar sync had no tests at all**, while being the only Google-facing
  path that deletes rows in bulk. It built its client inline, so there was nothing
  to substitute a fake for; `lib/calendar.ts` now mirrors the `lib/gmail.ts`
  choke point and `test/calendarMock.ts` fakes the API.

- [x] **A routine calendar sync-token expiry wipes and re-imports the calendar.**
  The clean-slate `deleteMany({ userId })` is replaced by a reconciliation scoped
  to what the sync could actually see: Google-sourced events, inside the window,
  absent from a full response. Events outside the window and events created
  locally and never pushed now survive, and `deleted` reports real removals
  instead of counting its own wipe.
- [x] **The calendar sync token comes from a different query than the data.** The
  token request now carries `singleEvents: true` and drops the empty
  `timeMin==timeMax` range, so it describes the same view the data was imported
  in. Google withholds `nextSyncToken` from any request with `timeMin`, `timeMax`
  or `orderBy`, which is why it still has to be a separate call.
- [x] **One account's initial sync starves every other account.** The guard is
  now per account (`jobs/perUserRunner.ts`), shared by both schedulers, with
  accounts running concurrently up to `SYNC_MAX_CONCURRENT_ACCOUNTS` (3). The
  guard is still needed per account so two syncs cannot race one history cursor.
  The two sync-status endpoints answer for the requesting account rather than
  globally — asked globally they reported "syncing" because somebody else was.
- [x] **`extractDomain` does not validate.** It now rejects anything that is not
  a syntactically valid hostname, so mangled Exchange and Domino fragments produce
  no customer. Whitespace stripping still happens first — that is deliberate, and
  how wrapped headers are recovered. **The 6 existing junk customers are not
  cleaned up**; they hold no mail, so it is cosmetic.
- [x] **Mailing lists become customers.** Two exclusions: `List-Id` (RFC 2919) on
  a message means it was distributed by a list, so it creates no companies or
  contacts at all; and known list hosts plus `lists.`/`groups.` prefixes are never
  companies. Keyed off `List-Id` rather than `List-Unsubscribe` on purpose — the
  latter is on ordinary vendor marketing, and a real supplier should still become
  a company. **Existing list customers are not cleaned up** — see the new item
  below.
- [x] **Login does not trigger a sync.** The OAuth callback now kicks off mail and
  calendar syncs for that account, deliberately un-awaited: a first sync can run
  for hours and the browser is waiting on the redirect. The per-account guard
  makes a concurrent scheduler tick a no-op.
- [x] **Progress stalls on failures.** Progress is driven by messages *attempted*
  rather than by `synced`, and the event now carries `processed` and `failed`
  alongside `synced`.

## Cleanup left after the sync fixes

- [ ] **Existing mailing-list customers are still in the database.**
  `connectedcommunity.org` (12,758 emails) and `googlegroups.com` (3,735) remain
  as customers with their contacts; the fix only stops new ones. Re-filing them is
  not the same problem as the `co.ma` repair — those messages belong to no company
  at all, so the right move is to unlink them and delete the customer, which needs
  a decision about the contacts harvested from those lists.
- [ ] **Six customers on invalid domains** (`powerm.ma/o=`, the Domino fragment)
  still exist. They hold no mail. One `deleteMany` once someone confirms the
  contacts under them are not wanted.

## Follow-ups from onboarding

- [ ] **The welcome overlay has no focus trap.** It covers the app and is
  announced as `aria-modal`, and focus moves into it on mount with Escape to
  dismiss, but Tab can still reach the app underneath. Either trap focus or mark
  the shell `inert` while it is open.
- [ ] **`/dev/onboarding` is a dev-only preview route** (`import.meta.env.DEV`,
  so it is tree-shaken from production builds). It exists because every
  authenticated screen sits behind Google OAuth, which makes UI review impossible
  without a live session. Worth extending to the other hard-to-reach screens, or
  removing once there is a better answer.

## Follow-ups from templates and snooze

- [ ] **Snooze/reply race.** The snooze scheduler and the mail sync are
  independent, so a follow-up can fire between a reply landing at Gmail and the
  sync importing it. `fire()` re-checks, which narrows the window without
  closing it. The real fix is 2.1 (Pub/Sub).
- [ ] **Snoozed mail still counts** in `getReviewSummary` and the dashboard —
  reminders are excluded from the mail folders only. Arguably correct; decide.
- [ ] **A snoozed-then-trashed thread shows in Trash but not in Snoozed**, since
  the Snoozed folder defaults to `isTrashed: false`.
- [ ] **Snoozing is owner-only** — a recipient of a shared thread cannot snooze
  it, since their view renders from the owner's rows.
- [ ] **No snooze action inside `ThreadDetail`** (the SidePanel); row action
  only. Needs `createPortal` per the modals-inside-SidePanel rule.
- [ ] **`{{today}}` renders with server-local `en-US` formatting.**
- [ ] **Templates are not shareable and are absent from global search.**
- [ ] **Normalize attendee addresses at ingest.** `calendarService.ts:491` passes
  the raw Google attendee address to `findOrCreateContact`, which dedupes on an
  exact string. Some arrive quote-wrapped, so a second contact is created for
  someone who already exists — 190 contacts carry a quoted address, and 36 of
  the 38 high-confidence duplicate groups are this one bug. Dedupe cleans up
  what exists; this stops it coming back.

## Bugs found by the Gmail sync tests

All four are fixed. Each characterisation test was converted into a regression
test in `server/src/services/emailService.sync.test.ts`, and each was watched
failing against the fix before being rewritten.

- [x] Sync counters discarded when the history id expired mid-pagination, so
  mail landed in the database while every open client was told nothing changed.
- [x] `isArchived` derived from the delta rather than the resulting label set,
  so trash-then-restore left a message permanently hidden from the inbox.
  Both write paths now share `flagsFromLabels`, so they cannot drift again.
- [x] `batchTrash`/`trash` appended `TRASH` unconditionally, growing
  `labelIds` on every call.
- [x] A 403 from the trailing `getProfile` escaped the reconnect translation,
  making the scheduler log a revoked grant every 60 seconds forever.

- [ ] **The rate limiter is still untestable at the Gmail mock seam** — it lives
  inside `getGmailClient()`, which those tests replace. Its backoff and retry
  need a unit test against `withGmailRateLimit` directly.

## Shell and navigation

- [x] **The side nav collapses to a Carbon rail, not to nothing.** It was already
  collapsible, but collapsed to zero width — reaching another page meant reopening
  the panel. Now `isRail`: a 48px icon strip that expands over the content on hover
  or focus. The choice is persisted like the theme, `SkipToContent` was added with a
  real target, and the content offset is driven by our own state rather than
  Carbon's `--expanded` class (which the rail also sets on hover, and would have
  reflowed the page by 208px every time the pointer crossed the nav).
  - [ ] **Unverified:** the `<1055px` breakpoint. The browser would not resize below
    ~2016px CSS pixels in testing, so the media query that zeroes the content margin
    below Carbon's `lg` has never been seen render.
  - [ ] **`!important` on the rail width.** Two classes already out-specify every
    width rule Carbon ships for that element and the computed value stayed 48px
    anyway. It works, but the reason it was needed is unexplained.

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
- [x] **List pages can sort.** Done in the query, not in `DataTable` — these pages
  fetch one page at a time, so a client-side sort would reorder twenty visible
  rows and present it as the whole set. All four services already accepted
  `sortBy`/`sortOrder`; nothing had ever sent them. Tasks was worse than "cannot
  sort": it spread `getHeaderProps`, so the arrows moved and the rows did not.
  Sortable now: Tasks 4 columns, Deals 3, Contacts 2, Customers 1.
  - [ ] **Still open from this item:** no `TableSelectRow` / `TableBatchActions`
    anywhere; `MailPage`'s bulk-action bar remains hand-rolled outside the table
    system. And Customers' count columns need aggregate SQL before they can sort.
- [x] **`ComposeToolbar`'s pickers are keyboard-usable.** Font and size are Carbon
  `OverflowMenu` (`MenuButton` needs a text label; these are icon triggers). The
  21-swatch colour grid is not a menu, so it stays bespoke but gained a real button
  trigger, `aria-haspopup`/`aria-expanded`, Escape-to-dismiss with focus returned,
  and swatches named "Blue 60" rather than announcing `#0f62fe`.
- [ ] `EventTooltip` is a hand-rolled global tooltip singleton; ~10 places use the
  native `title=` attribute. Carbon `Tooltip` is used nowhere.
- [ ] Carbon audit item C8: `_mail.scss` sets `.cds--content-switcher { width: 100% }`
  and `max-inline-size: none`, deliberately defeating Carbon's width cap.
- [ ] ~26 font sizes and ~59 spacing values sit off Carbon's scale. Left alone
  deliberately — forcing them would change the design. Needs a design decision.
  (Re-measured during the doc audit; the spacing figure was previously
  understated as 31.)
- [x] **Carbon A1 — keyboard access on clickable divs.** Done. Four dashboard
  rows became real `<button>`s; the two that contain a nested button
  (UpcomingEvents' Join, the calendar day cell's event pills) keep
  `role="button"` since buttons cannot nest. Also fixed a keyboard trap found
  on the way: the calendar overflow popover closed only on an outside
  mousedown, so a keyboard user could open it and not get out.
- [ ] **`role="button"` prunes its children from the accessibility tree.** ARIA
  gives `button` "children presentational: true", and browsers do prune — so on
  the two rows that had to stay divs, screen readers may not expose the nested
  Join button or event pills, even though Tab still reaches them. The same
  limitation exists in the `ThreadItemList` pattern these were modelled on.
  Fixing it means moving the row-level action onto a dedicated child control
  (e.g. the day number becomes the "go to day" button and the cell drops its
  role) — a design change, not a patch.
- [x] **Carbon B3 — `ComposeToolbar` colour array.** Now from `@carbon/colors`.
  They stay literal values rather than `var(--cds-*)` because they are written into
  the message body and must survive in a recipient's mail client. Asserted the
  resulting array is byte-identical to what shipped before.
- [ ] **Carbon B4 — inline `style={{}}` objects.** 114 across 30 files as of
  2026-09-05 (106 / 27 on 2026-08-18, "54+" when first filed — it is growing).
  Worst: `SettingsPage` (16), `CustomerDetailPage` (15),
  `TaskDetailModal` / `CalendarWeekView` / `CalendarDayView` (8 each).
  **Rescope before starting** — calendar views compute per-event pixel offsets
  and the badges paint per-record colours, so a real fraction are legitimately
  dynamic and should not be extracted.
- [x] **Carbon D2 — logo fallback.** It was broken in **seven** places, not one,
  and three of them had no placeholder at all — so a row with a logo and a row
  without were indented differently. One `shared/CompanyLogo` now keeps the failure
  in state rather than mutating a style, and always fills the slot.
- [x] **Carbon D5 — consistent empty states.** Density is a `size` prop, as
  suggested; `.card-empty` deleted rather than kept as an alias. At `sm` the icon is
  omitted unless asked for, and renders bare when it is — the 3rem disc was bigger
  than the message it decorated.
- [ ] `docs/database-schema.md` is committed now, but stale again: nothing on
  `EmailDraft`, `EmailTemplate`, `ContactEmailAlias`, `Contact.kind` /
  engagement, `User.timezone`, `TaskStatus.isTerminal`,
  `CalendarEvent.pendingSince` or `GoogleAuth.syncFailedMessageIds`. Regenerate
  from the schema, or delete it and point at `schema.prisma`.
- [ ] `docs/plans/*.md` and their gitignored `.claude/plans/*.md` originals have
  diverged. The committed copies are the ones that count; delete the originals
  or stop editing them.

## September 2026 correctness campaign — PRs #1–#24

Twenty-four PRs between 2026-09-01 and 09-04, all merged and deployed as
**1.2.1.0**. Recorded here because their leftovers live only in PR bodies
otherwise. What shipped, in one line each:

- Full code-analysis sweep (27 findings), keyboard access in the thread reader,
  multi-day event collapse, merge aliases, user timezones, terminal task
  statuses, a one-day notification-dismissal cooldown, the mailbox-wide read
  behind "eight recent rows" removed, rate limiting no longer keyed on Railway's
  single proxy IP, a four-part `VERSION` with an About dialog and a CI bump
  gate, By Company rebuilt twice (once to the design, once as one aligned grid
  on the List View's table), account defaults seeded at sign-in, HTML entities
  decoded across ~63 client surfaces and at the two server sites where Gmail's
  text becomes ours, task edits reaching every view without a reload, the edit
  panel fetching by id and saving only what changed, outgoing headers escaped,
  and seven calendar fixes: clearing fields, reporting a push Google rejected,
  the RSVP path no longer logging the user out, manual sync under the
  scheduler's guard, a per-project calendar rate limiter, pending-push
  protection with retry and a badge, and an update no longer clearing the Google
  guest list; disconnecting Google keeps events Google never had.

### Still open from those PRs

- [ ] **Tracking pixels.** The CSP permits remote images (PR #1) because mail
  does not render otherwise. Gmail and Outlook proxy images to avoid exactly
  this. Options: an image proxy, or a per-message "show images" toggle.
- [ ] **`calendar:sync:status` is emitted only from the scheduler**, so a cron
  tick's terminal `{syncing:false}` re-enables the Sync button during a manual
  sync. The resulting click is a 409 (PR #21), so the harm is closed; the
  flicker is not.
- [ ] **The full-sync `nextSyncToken` comes from a separate, unwindowed listing**
  whose events are discarded, so it can cover changes never applied.
  Pre-existing and single-sync (PR #21).
- [ ] **The calendar reconciliation has no create-during-sync guard.**
  `draftService` solves the same race with an `updatedAt < startedAt` clause
  (PR #23).
- [ ] **Stale-attendee window.** A PATCH omitting attendees now re-pushes the
  stored list, which can resurrect a guest removed in Google's own UI before the
  sync catches up. Narrower than what it replaced, and the same staleness the
  body already has for title, times and location (PR #24).
- [ ] **`/auth/google/disconnect-summary`** with real counts, mirroring
  `/account/summary` — whose own docstring notes that "this will delete all your
  data" is a sentence people click through (PR #24).
- [ ] **`retryFailedMessages` has no backoff** — a permanently failing message
  is retried every 60 seconds forever. Needs attempt counts, so a migration.
  Production had zero stuck messages when checked (PR #2); latent, not live.
- [ ] **`{{today}}` still renders server-local `en-US`** — the user timezone
  from PR #3 is not consulted (`templateService.ts`, `today:` in `render`).

### Deliberately not done, so it is not re-litigated as oversight

- `sendUpdates` keeping its default through `.partial()` — inert: both layers
  default to `'all'`, every caller is explicit, and a test documents why this
  is not the `updateDealSchema` bug (PR #21).
- A `.max()` on calendar description/location — would guess a limit Google
  does not document, and can be wrong in the rejecting direction (PR #21).
- jsonb `'null'` vs SQL NULL on `attendees` — 39 production rows,
  indistinguishable at every observation point; now a CLAUDE.md gotcha listing
  the conditions that would make it real (PR #24).
- Same-field last-write-wins in the task editor — an `updatedAt` precondition
  would fire constant false conflicts, since the Kanban drag bumps `updatedAt`
  on every card in a column. Needs a `version` column reorder does not touch,
  plus a conflict UI (PR #16).
- A delete tombstone for calendar events — no variant survives
  `@@unique([userId, googleEventId])` (PR #24).

## Task management — the ten features

Tasks are one of the app's two reasons to exist, and until 1.3.0 a task was a
title, a status and a due date. The plan, in build order — each one reuses
what the previous one adds:

- [x] **T1 Subtasks and checklists** (1.3.0). `Task.parentId`, two levels
  only, enforced in the service: a parent must be owned by the same account
  as its child, a subtask cannot have subtasks, and a task with subtasks
  cannot become one. A subtask inherits its parent's company unless told
  otherwise. Progress counts (`subtaskCount` / `subtaskDoneCount`) use the
  account's terminal statuses, like everything else since PR #4. Checklists
  are `task_checklist_items`: text, done, position; anyone who can open the
  task can tick one. Writes in both sections are immediate, not batched behind
  the panel's Save. Not done, deliberately: dragging a parent on the Kanban
  does not move its subtasks (they are their own cards, with a breadcrumb),
  and checklist items cannot be renamed or reordered from the UI yet — the
  endpoint accepts `text`, the UI just has no control for it.
- [x] **T2 Activity history and comments** (1.4.0). `GET /tasks/:id/activity`
  reads the audit log sideways — every row about the task, whoever wrote it —
  gated by the task's access rather than by the caller's own rows, and merges
  in `task_comments`. `TASK_UPDATED` now records `from` / `to` values, so the
  timeline reads "moved this from To do to Done" rather than "changed: status"
  (older rows degrade to the change names). Comments are plain text; the
  client resolves `@Name` to ids as they are picked and sends only those still
  in the text. Mentioned users get `TASK_MENTIONED`, the owner and assignee
  get `TASK_COMMENTED` unless they wrote it or were mentioned — nobody twice.
  Author-only edit; author or owner delete. A task notification now deep-links
  to `/tasks?task=<id>`, which opens the panel. Not done: the Activity page
  still shows only the caller's own rows (unchanged, by design); no reactions,
  no attachments on comments, no live refresh of an open timeline when someone
  else comments (the `task:commented` socket event is emitted, nothing
  subscribes yet).
- [x] **T3 Dependencies** (1.5.0). `task_dependencies` keyed on
  (blocker, blocked), cascade from both ends. Rules in the service: no
  self-dependency, the blocker must be owned by the blocked task's account (a
  share recipient may wire the owner's tasks together but not their own in),
  and the graph stays acyclic — a bounded breadth-first walk over "is blocked
  by" from the proposed blocker. The gate: `update` to a terminal status
  with an open blocker is a 409 `TASK_BLOCKED` naming the blockers, unless
  `force: true`, which the panel offers as "Complete anyway" and the audit row
  records as `forced`. `reorder` has no force — the board rolls the card back
  and shows the server's message. Rows carry `blockedByCount`,
  `openBlockerCount`, `blocksCount`; a red "Blocked" tag appears wherever the
  progress tags do; the list gains a Dependencies filter (`?blocked=`). Not
  done: no Gantt or critical path; "blocks" is read-only from the blocked
  task's side by design; the subtask checkbox on a blocked subtask shows the
  refusal but has no "anyway" — open the subtask's own panel for that.
- [x] **T4 Recurring tasks** (1.6.0). The calendar's recurrence presets moved
  to `utils/recurrence.ts` and `EventModal` imports them, so events and tasks
  share one vocabulary. `Task.recurrence` is one RRULE line (FREQ, optional
  INTERVAL, a single BYDAY or BYMONTHDAY — what `utils/recurrence.ts` on the
  server can advance; anything richer is refused by the validator). A rule
  needs a due date, on create and on update. Finishing an occurrence — panel,
  Kanban drag, subtask checkbox — creates the next: `nextOccurrence` steps
  from the old due date and lands strictly after now, keeping the weekday or
  day of month, clamping the 31st in short months. The spawn claims
  `recurrenceNextId` with a conditional `updateMany`, so an occurrence spawns
  once however many times it is reopened and finished; the unique index is the
  backstop. Copied: title, description, priority, estimate, company, assignee,
  labels, parent, the rule, and the checklist unticked. Not copied:
  dependencies (they were about that occurrence). The next occurrence opens
  in the account's first non-terminal status. Not done: no custom builder
  (same stance as the calendar), no "skip this occurrence", no end date or
  count.
- [x] **T5 Start dates, reminders and My Day** (1.7.0). `startDate` may not
  pass `dueDate` (400 `START_AFTER_DUE`, whichever of the two a PATCH moves).
  `remindAt` is an absolute instant; the forms offer it as three presets
  relative to the due date, and a time outside them is shown read-only.
  The notification scheduler's five-minute tick raises `TASK_REMINDER` for
  due reminders on unfinished tasks and stamps `reminderSentAt` first, so a
  reminder fires once; editing `remindAt` clears the stamp. `GET /tasks/my-day`
  buckets reachable, unfinished tasks into overdue / due today / starting
  today / coming up, with day boundaries in the user's timezone (the same
  helpers the dashboard uses), one bucket per task. The page sits in the side
  nav above Tasks; a row can be finished in place (the dependency gate still
  applies) or opened in the panel. Not done: no nav badge for My Day, no
  "snoozed mail returning today" bucket, no custom reminder time in the UI.
- [x] **T6 Links to contacts, deals and events** (1.8.0). `task_links`
  keyed on (task, entityType, entityId), polymorphic, so no foreign key to
  the target: the service checks on write that the target belongs to the
  task's account (contacts through their customer) and drops on read any
  link whose target is gone or foreign. `findById` resolves each link to a
  label, subtitle and, for events, the start. `GET /tasks?linkedTo=deal:<id>`
  is the reverse read; a malformed filter matches nothing. The panel's
  "Linked to" section searches all three types through the global search
  endpoint and opens each record where it lives. The contact page gains a
  Tasks tab and the event panel a Tasks block, both read-only (`LinkedTasks`).
  Not done: no Tasks column on the Deals page (the panel picker reaches deals
  already); no "create a task from this event" button; customers are
  deliberately not a link type — a task already has a company.
- [x] **T7 Time tracking** (1.9.0). `task_time_entries`: a running timer is
  an entry with no end; stopping writes the minutes (at least one). One
  timer per person across all tasks — a second start is a 409 `TIMER_RUNNING`
  naming the first, not a silent stop. Manual logs take minutes, a note and
  an optional time. Access, not ownership, to log; the logger or the task
  owner may delete. `trackedMinutes` on every row counts finished entries
  only, so a running timer inflates nothing until it stops. The panel's Time
  section: a ticking timer, a log line, the entries, and a bar drawn against
  the estimate that goes red past it; a clock tag on the rows; the company
  page's Tasks tab sums the time across its tasks. `GET /tasks/time/running`
  exists for a header chip. Not done: no header chip yet (a timer left
  running is visible only when its task is reopened), no reports or export,
  no editing an entry's minutes (delete and re-log).
- [x] **T8 Task templates and blueprints** (1.10.0). `task_templates`
  holds the tree as JSON (two levels, like tasks; due dates as day offsets
  from an anchor; labels checked against the account on save). A template
  is authored from a task — "Save as template" in the panel keeps its
  subtasks, checklist, labels, priority, estimate and the spacing of its due
  dates, with a share recipient's copy dropping labels they do not own — and
  applied from the Tasks page against a day and a company, optionally with
  links every created top-level task carries. The rows are created in one
  transaction, so a template never half-applies; the next occurrence status
  is the account's first non-terminal one. Settings → Workspace lists the
  templates for renaming and retiring. Not done: no tree editor in the UI
  (re-save the task to change the shape; the API accepts a full `items`
  PATCH), no template sharing between accounts, no "apply from this deal"
  button on the Deals page.
- [x] **T9 Saved views and table batch actions** (1.11.0). The list uses
  Carbon's `TableSelectAll` / `TableSelectRow` / `TableBatchActions` — the
  first table in the app to — with Move to, Complete, Assign, Add label and
  Delete. `POST /tasks/batch/{status,assign,label,delete}` (20/min, like
  mail) applies each row by the single-task rules — access for a status
  change, ownership for the rest, the dependency gate per row, a batch
  finish spawning the next occurrence — and reports the skipped ids with a
  reason rather than failing the batch; the toast says "Finished 3 tasks,
  1 skipped: Blocked by X". Saved views (`task_views`) are the list's filters
  and sort under a name, unique per account, picked from a menu in the
  toolbar. Not done: no grouping of the list (by status, assignee, week —
  the By Company tab is the one grouping and stays), no view sharing, no
  default view per account, and the Customers, Contacts and Deals tables
  still have no batch actions.
- [x] **T10 Email-to-task, second generation** (1.12.0). `mail_to_tasks`
  is many-to-many: the two single-column uniques that made it one-to-one
  are dropped (as indexes — see the CLAUDE.md gotcha), the pair stays
  unique. An email may be converted more than once (the old 409 is gone)
  and attached to an existing task (`POST /emails/:id/attach-to-task`,
  the convert modal's "Existing task" mode, the panel's Emails section);
  attaching needs the email — own, or in a shared thread — and the task.
  Mail that arrives on a linked thread after the link was made shows on
  the task's timeline as "Sam replied on the linked thread". Finishing a
  task from the panel offers, on a toast, to archive its linked emails that
  are still in the inbox. Not done: no thread deep link from the task (Mail
  opens on the inbox), no "unread replies" badge on the task row, no
  automatic re-open of a finished task when a reply arrives.

## Decisions waiting on a person

None of these is blocked on code. One line either way closes each.

- [ ] **Gmail Pub/Sub (2.1)** needs a GCP topic, subscription and push grant.
  Asked repeatedly without an answer; polling stays until then.
- [ ] **The 24-hour give-up window on pending calendar pushes**
  (`jobs/calendarPendingPush.ts`, `MAX_AGE_MS`). Past it a row stays protected
  and badged but stops retrying, waiting for a human. Chosen over letting Google
  eventually win, because silently discarding an edit is the bug that work
  closed. Keep, lengthen, or add a "retry now" action.
- [ ] **Mailing-list contacts.** Unlinking `connectedcommunity.org` and
  `googlegroups.com` is mechanical; whether the contacts harvested from those
  lists are wanted is not.
- [ ] **Snoozed mail counting** in `getReviewSummary` and the dashboard.
- [ ] **Tracking pixels** — accept, proxy, or toggle (above).
- [ ] **Off-scale type and spacing** — ~26 font sizes and ~59 spacing values
  sit off Carbon's scale. Normalising them changes the design.

## Operational loose ends

- [ ] **`railway ssh node /app/server/dist/scripts/backfillAll.js --apply` has
  never been run against production.** Only the `decodeTaskEntities` step has,
  by hand. Forgetting it once made the contact filters look broken. The dry run
  writes nothing; every step is idempotent.
