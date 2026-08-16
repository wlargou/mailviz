# Carbon Design System Audit — Fix Plan

**Status: 11 of 23 done, 5 partial, 7 open.** Re-verified against the source on
2026-08-16. Every checkbox below was checked against the code, not against the
previous state of this file — the boxes had never been maintained, and the old
progress table claiming 18/23 over-counted every band except P3: P0 was recorded
3/3 (really 1), P1 4/4 (really 2), P2 6/8 (really 3). Only P3's 5/8 happened to
be right, and then only by coincidence — it is a different 5.

Two structural things happened since this list was written and they matter for
reading it:

1. **The dashboard was rebuilt** (`ff860c0`, `021989c`, `8209088`).
   `NeedsAttention.tsx`, `FrequentContacts.tsx`, `MyDaySummary.tsx` and
   `QuickAddTask.tsx` no longer exist. Where an item named one of those files,
   the note below points at the successor component that inherited the problem.
2. **A large amount of Carbon work landed that this list never covered** — see
   "Landed since this audit" at the bottom. That work is why the file looked
   more finished than its checkboxes suggested.

---

## 🔴 P0 — Critical (Accessibility & Security) — 1 / 3

- [ ] **A1. Clickable divs missing keyboard accessibility** — **OPEN**
  - Add `role="button"`, `tabIndex={0}`, `onKeyDown` to all clickable `<div>` elements
  - Original files are gone; the pattern survived into the rebuilt dashboard.
    Still bare `<div onClick>` with no role/tabIndex/onKeyDown:
    `dashboard/TopCustomers.tsx:45`, `dashboard/RecentActivity.tsx:33`,
    `dashboard/RecentTasks.tsx:35`, `dashboard/ExpiringDeals.tsx:34`,
    `dashboard/UpcomingEvents.tsx:45`, `calendar/CalendarDayCell.tsx:127` (the
    day cell itself) and `:68`/`:79` (the overflow-popover rows).
  - Partial credit elsewhere: `shared/ThreadItemList`, `mail/MailPage`,
    `mail/ThreadDetail`, `mail/review/ReviewMailView`, `mail/review/CustomerSummary`
    and `tasks/TaskDetailModal` *do* carry `role="button"` + `onKeyDown`. The
    pattern is understood; it just was never applied to the dashboard or calendar.

- [ ] **A2. Missing aria-labels on icon-only buttons** — **PARTIAL**
  - [x] `CalendarDayCell` close button has `aria-label="Close"` (`CalendarDayCell.tsx:56`)
  - [ ] `ComposeToolbar` dropdown triggers still have none — the trigger is a
    bare `<div onMouseDown>` inside the hand-rolled `DropdownMenu`
    (`ComposeToolbar.tsx:74`), so there is no button to label. Fixing this is
    really C5: replacing `DropdownMenu` with Carbon `MenuButton` removes the
    problem rather than patching it.
  - The 21 color swatches carry only `title={color}` (a raw hex string), not an
    `aria-label`.

- [x] **A3. Settings "Add new status" input has no visible label** — **DONE**
  - `SettingsPage.tsx:906` uses `labelText="Add new status"` with the example
    text demoted to `placeholder`. Same treatment on "Add new category" (`:1037`),
    "Add new label" (`:1175`) and the Deal Partner fields (`:1276`, `:1285`).

## 🟠 P1 — High (Color Tokens & Inline Styles) — 2 / 4

- [x] **B1. Replace hardcoded hex colors in `_login.scss`** — **DONE**
  - Zero hex literals and zero `rgba()` literals remain in the file.

- [x] **B2. Replace hardcoded hex colors in `_compose.scss`** — **DONE**
  - Zero hex literals remain. (`#fef3bd` is gone.)

- [ ] **B3. ComposeToolbar TEXT_COLORS array** — **OPEN**
  - `ComposeToolbar.tsx:51-56` still holds all 21 raw hex values and the file
    does not import `@carbon/colors` at all. Worth doing now that it is cheap:
    the hand-written `carbon-colors.d.ts` stub that used to shadow the package's
    real types (and made half its exports unresolvable) was deleted in `544fec5`,
    so `@carbon/colors` now resolves its own 272 literal-typed constants.
  - Every value in the array *is* already a real Carbon palette colour — this is
    a naming/traceability fix, not a visual one.

- [ ] **B4. Eliminate inline `style={{}}` objects** — **OPEN, and larger than when written**
  - Was "54+"; now **106 occurrences across 27 files**. Worst offenders:
    `settings/SettingsPage.tsx` (16), `customers/CustomerDetailPage.tsx` (15),
    `tasks/TaskDetailModal.tsx` (8), `calendar/CalendarWeekView.tsx` (8),
    `calendar/CalendarDayView.tsx` (8), `contacts/ContactDetailPage.tsx` (7),
    `audit/ActivityLogPage.tsx` (7).
  - Not all 106 are extractable. Calendar week/day views compute pixel offsets
    per event, `PriorityBadge`/`CategoryTag` paint a per-record colour, and
    `EventTooltip` positions itself — those are genuinely dynamic. The item
    should be rescoped to the static ones before anyone starts.

## 🟡 P2 — Medium (Layout & Components) — 3 / 8

- [~] **C1. Adopt Carbon 2x Grid for page layouts** — **PARTIAL, deliberately**
  - [x] Dashboard (`DashboardPage.tsx`, `TaskSummaryTiles.tsx`), Settings,
    `CustomerDetailPage`, `ContactDetailPage` use `<Grid>`/`<Column>`.
  - [ ] List pages do not — and that is intentional. `432c6b3`
    ("remove unnecessary Grid/Column wrappers from list pages") reverted them
    after `f2eed95`/`b125790`/`4807f89` cycled on Grid's gutters fighting
    `app-content` padding. The original sub-task ("list pages: full-width single
    column") is satisfied; it just isn't satisfied *with* `Grid`.

- [~] **C2. Standardize page headers** — **PARTIAL**
  - [x] The shared component exists: `components/shared/PageHeader.tsx`
    (title, subtitle, breadcrumbs, actions slot, `padded` variant), styled in
    `_base.scss:153`.
  - [ ] Only 3 of ~14 pages use it — `ActivityLogPage`, `ContactDetailPage`,
    `CustomerDetailPage`. `CustomersPage`, `SettingsPage`, `CalendarPage`,
    `TasksPage` and the three Review views hand-roll the identical
    `.page-header > .page-header__info > h1` markup, and so get no breadcrumbs.
  - Already tracked in `BACKLOG.md` → Carried-over quality items.

- [x] **C3. Use Carbon `<Breadcrumb>` for detail page navigation** — **DONE**
  - `PageHeader.tsx:23` renders `<Breadcrumb noTrailingSlash>` / `<BreadcrumbItem>`
    with `navigate()` on click. No "Back to Customers ←" / "Back to Contacts ←"
    text links remain anywhere. (The one surviving "Back to Mail" is
    `review/PeriodSelector.tsx:30` — a flow-exit button, not detail-page nav.)

- [~] **C4. Replace custom buttons with Carbon Button variants** — **1 of 4**
  - [x] `.recent-activity__view-all` → `<Button kind="ghost" renderIcon={ArrowRight}>`
        (`UpcomingEvents.tsx:75`; the class name is kept for layout only)
  - [ ] `.contact-copy-btn` → still a raw `<button>` (`ContactsPage.tsx:169`)
  - [ ] `.mail-search__clear` → still a raw `<button>` (`MailSearchBar.tsx:185`;
        it does at least carry `aria-label="Clear search"`)
  - [ ] `.mail-search__clear-all` → still a raw `<button>` (`MailSearchBar.tsx:226`,
        no label of any kind)

- [ ] **C5. Replace custom dropdown in ComposeToolbar** — **OPEN**
  - `ComposeToolbar.tsx:58` still defines a local `DropdownMenu`: a `<div>`
    trigger, `useState` open flag and a `document` `mousedown` listener. No
    keyboard navigation, no ARIA, no focus management.
  - Prefer Carbon `MenuButton` + `MenuItem`, matching what `DashboardPage.tsx:123`
    now does — that migration is the worked example.
  - Also closes the open half of A2.

- [x] **C6. Settings: replace Disconnect button** — **DONE**
  - `SettingsPage.tsx:644`: `<Button kind="danger--ghost" size="sm" renderIcon={Misuse}>`,
    gated behind a confirmation `Modal` (`:1332`).

- [x] **C7. Settings: add contrast border to color swatches** — **DONE**
  - `.settings-status-dot` carries `border: 2px solid var(--cds-border-subtle-01)`
    with `--cds-border-strong-01` on hover and a `--cds-focus` outline
    (`_settings.scss:141`). `.settings-color-option` mirrors it and marks the
    selected swatch with `--cds-text-primary` plus a `--cds-layer-02` ring.

- [ ] **C8. ContentSwitcher width on Mail page** — **OPEN, deliberate**
  - `_mail.scss:115` sets `.cds--content-switcher { width: 100% }` and
    `.cds--content-switcher-btn { flex: 1; max-inline-size: none }`, defeating
    Carbon's width cap on purpose so the switcher spans the mail list column.
  - This needs a design call, not a code change. Tracked in `BACKLOG.md`.

## 🟢 P3 — Low (Polish & Consistency) — 5 / 8

- [x] **D1. Apply Carbon type styles via SCSS mixins** — **DONE**
  - **129 `type-style()` calls** across 12 partials (was 6 at audit time):
    `_dashboard` 35, `_calendar` 33, `_mail` 19, `_compose` 15, `_notifications` 5,
    `_settings` 5, `_global-search` 5, `_review` 4, `_share` 3, `_login` 2,
    `_base` 2. Every partial now declares its own
    `@use '@carbon/react/scss/type' as type` header.
  - Residual: 26 raw `font-size:` literals survive (mostly `0.8125rem` /
    `0.6875rem` / `0.625rem` micro-type in calendar chips and compose). Left
    deliberately — see the design-decision note in `BACKLOG.md`.

- [ ] **D2. Dashboard "Needs Attention" — add fallback avatar** — **OPEN (successor: `TopCustomers`)**
  - `TopCustomers.tsx:56` renders the company initial when there is **no** logo
    URL, but `onError` at `:53` merely sets `display: none` — so when a Clearbit
    logo 404s (the exact case this item was filed for) the row shows nothing.
    Swap the `onError` handler to fall back to the same `--placeholder` element.

- [x] **D3. Dashboard "View all" links** — **DONE**
  - All four dashboard cards use `<Button kind="ghost" size="sm" renderIcon={ArrowRight}>`:
    `RecentActivity.tsx:50`, `RecentTasks.tsx:55`, `ExpiringDeals.tsx:63`,
    `UpcomingEvents.tsx:75`.
  - Out of scope but noted: `GlobalSearch.tsx:345` still has a raw
    `<button className="global-search__view-all">`.

- [ ] **D4. Calendar event tooltips** — **OPEN**
  - Truncated event names *do* get a tooltip, but via a hand-rolled global
    singleton: `calendar/EventTooltip.tsx` attaches `mouseover`/`mouseout` to
    `document`, reads a `data-tooltip` attribute and portals a positioned `<div>`
    into `<body>`. Mouse-only — no focus trigger, no ARIA, no dismissal.
  - Carbon `Tooltip` is used **nowhere in the app**; ~17 places fall back to the
    native `title=` attribute (SettingsPage colour pickers ×8, `ThreadDetail`
    ×2, `ComposeToolbar`, `ContactsPage`, `NotificationBell`, `VipBadge`,
    `ConnectionStatus`, `MailComposeModal`, `ActivityLogPage`).
  - Tracked in `BACKLOG.md`.

- [ ] **D5. Consistent empty states** — **OPEN**
  - `shared/EmptyState.tsx` exists and is used by 10 components, but the
    dashboard cards bypass it entirely for ad-hoc `.card-empty` divs —
    `TopCustomers.tsx:35`, `RecentTasks.tsx:29`, `RecentActivity.tsx:27`,
    `ExpiringDeals.tsx:25`, `UpcomingEvents.tsx:28` — and the Review flow uses
    its own `.review-customers__empty` (`ReviewMailView.tsx:195`,
    `CustomerSummary.tsx:115`).
  - The dashboard cards may legitimately need a denser variant; if so, add a
    `size` prop to `EmptyState` rather than keeping two markup families.

- [x] **D6. Customer/Contact table column alignment** — **DONE**
  - Both pages share one `table-cell--center` class on header and cell
    (`CustomersPage.tsx:189/219/222/225`, `ContactsPage.tsx:139/194`), with the
    Carbon-`Tag`-specific `display: inline-flex` fix in `_dashboard.scss:410`.

- [x] **D7. Split monolithic SCSS** — **DONE**
  - `index.scss` is now **1.4 KB** of `@use` directives (was 83 KB) over 14
    partials. Largest is `_calendar.scss` at 23 KB; `_dashboard.scss` 20 KB,
    `_mail.scss` 19 KB. Further splitting is optional, not blocking.

- [x] **D8. Mail thread hover action tooltips** — **DONE**
  - All five hover actions in `shared/ThreadItemList.tsx:87-121` are Carbon
    `<Button kind="ghost" hasIconOnly>` with an `iconDescription`, so Carbon
    renders the tooltip: Star/Unstar, Reply All, Trash/Restore, Mark as
    read/unread, Convert to task.

---

## Landed since this audit was written

None of this was on the original list; it is the bulk of the Carbon work that
actually shipped, and it is why the file read as more complete than its
checkboxes.

- **IBM Plex actually loads now** (`ce15b90`). Carbon's `$font-path` defaults to
  `'~@ibm/plex'`, a webpack convention Vite does not resolve, so Carbon's 90
  `@font-face` rules emitted dead `url(~@ibm/plex/...)` paths and **the whole app
  silently rendered in Helvetica**. `index.scss` now sets
  `$css--font-face: false` and `main.tsx` imports Plex from `@ibm/plex-sans` /
  `@ibm/plex-mono` (the `-default` bundles: Latin at 300/400/600, ~8 KB of CSS
  each vs ~44 KB for `-all`).
- **Carbon upgraded**: `@carbon/react` 1.114, `@carbon/ibm-products` 2.96,
  `@carbon/icons-react` 11.86, `@carbon/charts-react` 1.27.
- **Container rubric applied** (`8b44f47`). `SidePanel` was the default container
  for every overlay — 15 SidePanels, 7 Modals, 0 Tearsheets. Six flows moved to
  the container Carbon's Create Flows pattern actually prescribes:
  ShareDialog and ConvertToTaskModal → `Modal sm`; MailComposeModal and
  EventModal → wide `Tearsheet`; CustomerCreateModal and ContactModal →
  `TearsheetNarrow`. **SidePanel 15 → 9**, and the 9 that remain are the cases
  the rubric describes (five ThreadDetail hosts, EventDetailModal,
  TaskDetailModal, TaskCreateModal, DealCreateModal).
- **SCSS migrated `@import` → `@use`** (`958f13b`). Zero `@import` remain; `@import`
  is deprecated and removed in Dart Sass 3.0. Alongside it: `type-style()` 6 → 129
  (D1), `$spacing-*` tokens 0 → 357, and `_mail.scss` colours tokenized via
  `color-mix()` (13 uses) so the mail palette follows the g10/g100 toggle
  instead of being pinned to dark.
- **Charts follow the theme** (`544fec5`). `EmailVolumeChart` and
  `TaskStatusDonut` both hardcoded `theme: 'g100'`, so they stayed dark in light
  mode — and the opaque background that produced is exactly what the
  transparency `!important` overrides in `_dashboard.scss` existed to hide.
  Both now read the theme from `uiStore`, and those overrides (including the
  reach into `svg.cds--cc--area`) were deleted rather than reworked. *Ten
  `!important` declarations do remain in `_dashboard.scss` — but they are
  unrelated `ClickableTile` layout overrides on `.kpi-tile` and `.kanban-card`,
  not the chart ones.*
- **Dashboard "Create" menu is Carbon `MenuButton` + `MenuItem`**
  (`DashboardPage.tsx:123`). It was a raw `<button>` toggling its dropdown with
  `document.querySelector(...).style.display` — no keyboard support, no
  outside-click, no ARIA.
- **Header search is stable Carbon** (`b52bdc4`). `GlobalSearch` now composes
  `Search` + `Dropdown` at `size="sm"`. It previously used
  `@carbon/ibm-products`' `previewCandidate__SearchBar` — an explicitly unstable
  preview component that needed eight `.c4p--*` / `.cds--*` internal overrides to
  fit a 2rem header and still rendered a stray submit button. Both replacements
  are 2rem at `sm`, so **all eight overrides are gone**.

---

## Progress Tracking

| Priority | Total | Done | Partial | Open |
|----------|-------|------|---------|------|
| P0 Critical | 3 | 1 | 1 | 1 |
| P1 High | 4 | 2 | 0 | 2 |
| P2 Medium | 8 | 3 | 2 | 3 |
| P3 Low | 8 | 5 | 1 | 2 |
| **Total** | **23** | **11** | **5** | **7** |

Done: A3, B1, B2, C3, C6, C7, D1, D3, D6, D7, D8
Partial: A2, C1, C2, C4, D2
Open: A1, B3, B4, C5, C8, D4, D5

Of the 7 open items, **C8 and D4 are already carried in `BACKLOG.md`** under
"Carried-over quality items", as is the C5 dropdown and the residual off-scale
type/spacing. This file and that section have started to overlap. Once A1, B3,
B4, D2 and D5 are folded into `BACKLOG.md`, this file has no independent reason
to exist and should be deleted rather than maintained in parallel.
