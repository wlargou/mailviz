# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working Preferences

- **Always use the Chrome extension (Claude in Chrome MCP)** for verifying UI changes — not the preview tools. The app requires Google OAuth authentication, so the preview browser can only see the login page. The Chrome extension has the authenticated session.
- **Always use the Carbon MCP tools** (`docs_search`, `code_search`, `get_charts`) when building or modifying UI. Look up the correct Carbon component, variant, and props before implementing. Don't guess Carbon API — check it.
- **Follow IBM Carbon Design System patterns** for all UI work. Use Carbon tokens (`var(--cds-*)`) for colors, never hardcode hex values in component styles. Check the Carbon search pattern docs for search UIs, the Carbon data table patterns for tables, etc.
- **Commit frequently** — don't accumulate too many unrelated changes. Separate refactoring commits from feature commits.
- **Don't ask the user to verify manually** — verify changes yourself using Chrome extension screenshots and interaction.

## Development Commands

```bash
# Start everything (PostgreSQL + concurrent server & client)
docker compose up -d && npm run dev

# Individual workspace commands
npm run dev --workspace=server    # tsx watch on port 3002
npm run dev --workspace=client    # Vite on port 5174 (strictPort — fails if taken)

# Database
npm run db:up                     # Start PostgreSQL (host port 5435)
npm run db:down                   # Stop PostgreSQL
npm run db:migrate                # prisma migrate dev
npm run db:seed                   # prisma db seed

# Verify (what CI runs)
npm run typecheck                 # Both workspaces — esbuild/Vite strip types without checking them
npm test                          # Vitest, both workspaces

# Prisma (run from server/)
npx prisma generate               # After schema changes
npx prisma migrate dev --name X   # Create new migration
npx prisma migrate deploy         # Apply migrations (prod/CI)
npx prisma studio                 # GUI database browser

# Build
npm run build --workspace=client  # vite build → client/dist/
npm run build --workspace=server  # esbuild → server/dist/
```

## Testing & CI

- **Vitest in both workspaces.** `npm test` runs server then client.
- **The server suite runs against a real Postgres**, creating and dropping its own `mailviz_test_<random>` database per run. Read `server/src/test/README.md` before writing or debugging server tests — it covers the per-run database, the single-fork requirement, `TEST_DATABASE_URL` / `TEST_DATABASE_BASE_URL`, and the two-user factory convention.
- **CI** (`.github/workflows/ci.yml`): prisma generate → `migrate deploy` against an empty DB → typecheck both → test both → build both → `npm audit` (non-blocking).
- **Run server tests from `server/`**, e.g. `cd server && npx vitest run src/services/foo.test.ts`. The harness shells out to `prisma migrate deploy --schema=src/prisma/schema.prisma`, a path relative to the working directory, so `vitest --root server` from the repo root fails before any test runs.
- **The server suite takes ~12 minutes.** It is a single fork against a real Postgres and truncates every table between tests; the three route-smoke files are roughly half of it. Prefer running the files you touched while iterating.
- **Tests are audited by mutation, not just written.** A test that passes is not evidence until you have broken the code it covers and watched it go red — 39 of the first 1018 tests here survived exactly that check and had to be repaired. Vacuous shapes to avoid: `every()` on a possibly-empty array, asserting an echoed `meta.limit` instead of the row count, seeding a fixture in the state the endpoint writes, and a bare `rejects.toThrow()` where the point is *which* error.

## Architecture

**Monorepo** with npm workspaces: `client/` (React + Vite) and `server/` (Express + Prisma). Both use ESM.

### Server (`server/src/`)
- **Entry**: `index.ts` → creates HTTP server, initializes WebSocket (`/ws`), starts background sync schedulers
- **Pattern**: Routes → Controllers → Services → Prisma. Zod validators in `validators/`.
- **Auth**: Google OAuth login → JWT access (15min) + refresh (7d) tokens in httpOnly cookies. Middleware in `middleware/auth.ts`.
- **Shared Prisma**: Single instance in `lib/prisma.ts` — import from there, never `new PrismaClient()`.
- **Gmail helper**: `lib/gmail.ts` exports `getGmailClient()` — use instead of manual oauth2Client + google.gmail pattern. It is also the rate-limit choke point (see Key Patterns).
- **Real-time**: `websocket.ts` broadcasts events (`wsEmit`): `emails:synced`, `email:updated`, `email:sent`, `sync:status`, `sync:progress`, `calendar:synced`, `calendar:sync:status`.
- **RFP register** (`services/rfpService.ts`, `services/rfpStorage.ts`): tenders plus their dossiers. The only place the app stores file bytes — Gmail attachments are streamed on demand and never kept. Uploads stream through multer to `RFP_STORAGE_DIR` under `<userId>/<uuid>.<ext>`, extension from a mime whitelist; the uploaded filename is kept only as a label because it is user input that may contain a path. A tender has **lots** (`RfpLot`, at least one, each with its own budget) and a **response** of dossiers (`RfpFolder`) holding pieces (`RfpFolderItem`, with a status); a piece's prepared files are `RfpDocument` rows with `itemId` set, so they share storage, preview and download with the tender's own documents but are excluded from its dossier list. `rfps.budget` is the lots' total, written only by `recomputeBudget` in `rfpCompositionService` — never set it directly. The dossier kinds and their default pieces live in `utils/rfpComposition.ts` and are served as `GET /rfps/catalogue`; the offers are per lot, everything else is per tender. A piece's files are its **versions** (`rfp_documents.version`, unique per item, with `uploaded_by_id`); uploading always puts the piece back to In progress. **Verifiers** (`RfpVerifier`, owner-chosen among the people the tender is shared with) approve or request changes on the current version (`RfpItemVerification`, one row per verifier and piece). The rule lives in `rfpVerificationService`: with verifiers, a piece that has a file is Ready exactly when every verifier approved its current version — anything that moves either side must end in `syncItemStatus`, and a manual Ready before that is a 409.
- **Background jobs** (all node-cron, started in `index.ts`): `emailSyncScheduler` (`SYNC_INTERVAL_SECONDS`, default 60s), `calendarSyncScheduler` (`CALENDAR_SYNC_INTERVAL_SECONDS`, default 120s), `scheduledSendScheduler` (30s), `notificationScheduler` (5min).
- **Build**: esbuild with `bundle: false` (required for Prisma), ESM format, Node 22 target.

### Client (`client/src/`)
- **UI**: IBM Carbon Design System (g100 dark theme, g10 light toggle). Components from `@carbon/react`, `@carbon/ibm-products`, `@carbon/icons-react`, `@carbon/charts-react`.
- **State**: Zustand stores in `store/` (auth, tasks, calendar, notification, ui).
- **API**: Axios client in `api/client.ts` with `withCredentials: true` and 401 → redirect to `/login`.
- **Routing**: React Router v7 (`react-router-dom`). `ProtectedRoute` wraps authenticated pages inside `AppShell` (header + sidebar).
- **WebSocket**: one module-level socket, reference-counted across subscribers, behind `hooks/useEmailWebSocket.ts`. Never open your own — subscribe through the hook.
- **Styles**: SCSS partials in `styles/`, `@use`d by `index.scss` (which is a pure manifest). `_base.scss` holds app-level base CSS and loads first. All colors use Carbon tokens (`var(--cds-*)`).
- **Dev proxy**: Vite forwards `/api` and `/ws` to `http://localhost:3002`.

### Database (PostgreSQL 16)
- Schema: `server/src/prisma/schema.prisma`
- Key models: User ↔ GoogleAuth (1:1), Task (dynamic string status via TaskStatus model), Email (Gmail sync), CalendarEvent, Customer ↔ Contact, Deal ↔ DealPartner, Label, ScheduledEmail, AuditLog, Notification, and the `*Share` join tables (EmailThreadShare, DealShare, TaskShare).
- Task statuses are dynamic (stored in `task_statuses` table), not enum. The Kanban board reads from this table.
- Emails auto-link to customers via domain extraction from sender addresses.
- **Everything user-scoped is multi-tenant.** Uniques are composite on `user_id` (`(user_id, domain)`, `(user_id, gmail_message_id)`, …). Never add a global unique to a user-scoped table, and never build a `where` that can drop the ownership filter — `server/src/prisma/tenantUniques.test.ts` and the service tests exist for exactly this.

## Key Patterns

- **Error throwing in services**: `throw Object.assign(new Error('msg'), { status: 404 })` — caught by `middleware/errorHandler.ts`
- **Gmail sync**: Best-effort pattern — DB updated first, Gmail API call wrapped in try/catch to not block on API failures
- **Gmail rate limiting**: `lib/gmailLimiter.ts` — a per-user Bottleneck Group (Gmail's quota is charged per user) plus retry with exponential backoff on 429 / 403 `rateLimitExceeded`. It is applied inside `getGmailClient()`, so any new Gmail call gets throttling for free by going through that helper. Do not construct `google.gmail(...)` directly — that bypasses it.
- **Carbon container rubric** (Create Flows pattern — pick by complexity, don't default to SidePanel):
  - `Modal` (sm) — a couple of fields. e.g. ShareDialog, ConvertToTaskModal.
  - `SidePanel` — medium complexity *and the user needs page context* (reading mail beside the list, a detail panel next to its row).
  - `TearsheetNarrow` — medium complexity that may obscure the page. e.g. CustomerCreateModal, ContactModal.
  - `Tearsheet` (wide) — complex or interactive flows. e.g. MailComposeModal, EventModal. Pass `selectorsFloatingMenus` for anything appending to `<body>` (flatpickr), or the focus-wrap steals focus.
- **Tearsheet vs SidePanel gutters**: SidePanel supplies its own body gutters (`.create-side-panel__form-item`); Tearsheet hands the body full width and content owns its gutters (`.tearsheet-form__item`, which carries `padding-inline`).
- **Modals inside SidePanel**: Carbon's `Modal` renders inline, and a `position: fixed` element inside a fixed/transformed SidePanel resolves against the wrong containing block. Use `createPortal(modal, document.body)`. Tearsheets don't need this — `TearsheetShell` self-portals. `SaveAsTemplateModal` shipped without the portal: the backdrop dimmed the panel alone and the dialog was off-screen — every modal opened from inside a SidePanel needs it.
- **Global search**: `GET /api/v1/search?q=` queries emails, tasks, events, customers, contacts, deals in parallel (4 results each)
- **Batch API pattern**: `POST /batch/{action}` with `{ ids: string[] }` body. Resolves thread IDs from email IDs, acts on all emails in threads.
- **Optimistic UI**: For bulk/single email actions, update state immediately, then fire API call. Revert state on failure.
- **Carbon `Tag` ignores `renderIcon` at `size="sm"`.** The icon slot is only rendered for `md` and `lg`. For a small tag with an icon, put the icon in the children (see `TaskProgressTags`).
- **Carbon `NumberInput` loses keystrokes when controlled.** It keeps its own copy of `value` and syncs it from the prop one render late, so between two quick keystrokes the DOM is reset to the previous number — typing 1500000 left 1000. `userEvent` in jsdom does not reproduce it; only a real browser does. For money use a `TextInput` kept as typed and parsed once (`BudgetInput` + `parseBudget`, which also reads the Avis' "1 500 000,00").
- **Carbon `ComboBox` has no `hideLabel`**; use `titleText` and accept the label. Its `onChange` hands `selectedItem` as `T | null | undefined`, so type the handler's parameter optional.
- **Carbon `Modal` renders its content while closed** (hidden, not unmounted). A form inside a closed Modal is still in the DOM: a `TextInput` seeded with the task title is a second "display value" for a test, and a primary button labelled "Save" collides with the page's own. Mount the Modal only while open when its fields mirror something on the page.
- **`git stash` without `-u` leaves new files behind.** Hopping to another branch and `git add -A`-ing there commits them into that branch. Stash with `-u` before switching, and note that `git stash pop` refuses to restore an untracked file that now exists as a tracked one — `git checkout HEAD -- <file>` and `git stash drop` is the way out.
- **Column widths set by `nth-child` shift when a column is added.** `.tasks-table` sized its columns by position, so the selection column added in 1.12 became column 1 and inherited the Title's 40% while every other column moved one over. When you add a column (selection, expand, actions), re-index every positional width rule for that table, and check it in the browser at full width, not in a scaled screenshot.
- **Rows open their record through `utils/rowOpen.ts`.** `openRowOnClick(open)` on a `TableRow` ignores clicks on the row's own controls (buttons, links, checkboxes, menus, `.clickable-tag`); the record's name stays a real `<button className="table-title-button">` for the keyboard. Row actions go in one `OverflowMenu` with Delete last (`isDelete hasDivider`) — not a strip of icons with a red trash on every row.
- **Carbon's `OverflowMenu` in jsdom:** the trigger is named by `iconDescription` (not `aria-label`, which names the menu list), and the open menu stays `visibility: hidden` because jsdom cannot position it. Query items with `findAllByRole('menuitem', { hidden: true })` and pick by `textContent` — a hidden element's accessible name computes to `""`, so `{ name }` never matches.
- **Stylesheets are empty under Vitest** however they are imported (`?raw`, `import.meta.glob`), so a value a test must see — like a colour token — belongs in a TS map applied inline, not only in SCSS. `PRIORITY_COLOR` in `PriorityBadge.tsx` is the example. And in g100, `support-warning` and `support-caution-minor` are the same yellow (#f1c21b): never use both to tell two states apart.
- **A link inside a clickable row stops propagation.** `openRowOnClick` ignores real buttons and links, but a `<span onClick>` (the customer name on a deal row) is neither — without `e.stopPropagation()` it navigates *and* opens the row.
- **Carbon `ContentSwitcher` needs a selected switch to be reachable.** Its switches take `tabIndex={0}` only when selected, so `selectedIndex={-1}` leaves the whole switcher out of the tab order. The mail folder bar adds a folder opened from More to the switcher instead (`MailFolderBar`).
- **Carbon `Search` swallows Escape.** It clears itself and stops the event, so a dialog that closes on Escape must listen in the capture phase (`addEventListener('keydown', fn, true)`) — see `CommandPalette`.
- **Portalling to `<body>` leaves the `<Theme>`.** The light/dark switch is a `<Theme>` wrapper in `AppShell`, so anything created with `createPortal(…, document.body)` keeps the default g100 tokens in light mode. App-wide overlays (the command palette) render inside the shell instead; Carbon's own modals are unaffected.
- **Carbon `Modal` inside a table toolbar can scroll the page sideways.** Closed, it is still in the DOM and measured wider than the page there; focus moving into a nearby menu scrolled `#main-content` horizontally. Mount such a modal only while open, and on `<body>` — `TaskViewsMenu`'s Save view.
- **Tooltips on icon buttons in a panel or a scroll area: `autoAlign`, never a CSS override.** Carbon's IconButton/Button tooltip is `position: absolute` in a `position: relative` container; a rule forcing the container `static` and the popover `fixed` "to escape scrollable containers" put every tooltip in the thread reader ~100px from its button, because the SidePanel's `transform` makes it the containing block for `fixed`. `autoAlign` (floating-ui) places against the real containing block and flips at edges. `Button`'s types omit `autoAlign` though its runtime passes it on — use `IconButton` (`label` + icon child). In jsdom an autoAlign button's name comes out empty (floating-ui keeps the tooltip `visibility: hidden`, and the name is `aria-labelledby` to it); read the label as a browser does — see `labelled()` in `ThreadDetail.test.tsx`.
- **Carbon's classic `OverflowMenu` renders under a SidePanel.** Its options float at z-index 6000 (`floating`), the panel is 8000. Inside a panel use the v12 menu — `<FeatureFlags enableV12Overflowmenu><OverflowMenu label=…><MenuItem …/></OverflowMenu></FeatureFlags>` — which is Carbon's `Menu` at 9000. Its props are not in `OverflowMenu`'s TS types; `ThreadDetail` casts it once.
- **Quoted mail history is folded by `utils/mailQuotes.ts`**, which marks everything from the first quote marker on (Outlook web/desktop, Gmail, Apple Mail, Yahoo) with `data-mv-quoted`. Replies Mailviz sends use Gmail's `gmail_quote` markup, which the outgoing sanitiser allows by class name only — recipients' clients fold it too.
- **Carbon Checkbox click issues**: Carbon's `Checkbox` component captures clicks via internal `<label>`. Workaround: use native `<input type="checkbox">` in a wrapper div with its own click handler and `stopPropagation`.

## Gotchas & Lessons Learned

- **`server/.env` is the file that is loaded, not the repo-root `.env`.** dotenv reads from the working directory and `npm run dev --workspace=server` runs inside `server/`. A stale root `.env` is silently ignored — copy `.env.example` to **both**.
- **Prisma 7 keeps its config in `server/prisma.config.ts`, not `package.json`.** The `prisma` key is gone, and so is `datasource.url` in the schema — v7 rejects it outright (`P1012`). Both the schema path and the connection URL live in the config file, which is not optional here because the schema is at the non-default `src/prisma/schema.prisma`. `npx prisma generate` and `migrate deploy` find it with no `--schema` flag, which is what the Railway build and start commands rely on.
- **The generated Prisma client lives in `server/generated/`, deliberately outside `src/`.** `esbuild.config.js` globs every `.ts` under `src/` as an entry point and tsconfig includes `src/**/*`, so generating there would pull thousands of generated files into both the build and the typecheck. Only `src/lib/prismaClient.ts` knows the path — everything else imports the barrel, because `@prisma/client` no longer resolves in v7. `src/lib/` and `dist/lib/` are both one level under the workspace root, so the same relative import works before and after the build.
- **A driver adapter is mandatory in Prisma 7.** `new PrismaClient()` with no arguments does not open a connection, and `datasourceUrl` is removed. Use `new PrismaPg({ connectionString })` from `@prisma/adapter-pg` — note the export is `PrismaPg`, not `PrismaAdapterPg`.
- **`npm audit` reports 4 high, all of them from Prisma, and none of them actionable.** Two advisories, neither cleared by Prisma 7, whose `fixAvailable` is a downgrade to 6.x:
  - `deepmerge-ts` via `prisma`/`@prisma/config` — `deepmerge` used as the merger for CLI config loading with every remote input disabled.
  - `mysql2` via `@prisma/client` → `prisma` — a MySQL auth-plugin downgrade. This app talks to Postgres through `@prisma/adapter-pg` and never loads the MySQL driver, so there is no path to it.

  This line said "stays at 3 high" until 2026-09-01, when CI reported 4 — `mysql2` had been added to the tree by a Prisma release. Count the advisories rather than trusting the number here, and expect it to drift again.
- **Prisma migrate dev is interactive** — won't work in non-interactive shells. For CI/scripts, create migration directories manually and use `prisma migrate deploy`.
- **Migrations must apply to an EMPTY database.** CI proves this every run, as does the test suite. A migration that backfills a column from another table and then sets it `NOT NULL` passes locally and fails on a fresh clone and on first deploy.
- **`DROP CONSTRAINT IF EXISTS` does not drop a `CREATE UNIQUE INDEX`.** An index created that way is not a constraint, so the `ALTER TABLE ... DROP CONSTRAINT IF EXISTS` succeeds silently and the unique stays live. Six pre-user-scoping global uniques survived five months that way and blocked multi-user entirely (fixed in `20260816120000_drop_pre_user_scoping_unique_indexes`). Use `DROP INDEX IF EXISTS`.
- **Enum to string migration**: When changing a Prisma enum to a string column, write raw SQL: `ALTER TABLE ... ALTER COLUMN ... TYPE VARCHAR USING ...::text`, then `DROP TYPE IF EXISTS "EnumName"`.
- **`@types/react` must stay in the workspace root `package.json`.** Every `@carbon/*` package hoists to root; if React's types live only in `client/node_modules`, Carbon's own `.d.ts` files cannot resolve `react` and every React-derived Carbon type silently collapses (`keyof TableBodyProps` became just `'aria-live'`; charts became "not a JSX component"). Root also pins `react`/`react-dom` 19 because Carbon declares an 18 peer — otherwise npm parks 18 at the root and hoisted consumers (`@testing-library/react`) resolve the wrong copy.
- **Vite 8's default CSS minifier cannot build this app.** Vite 8 switched `build.cssMinify` to Lightning CSS, which fails to parse the CSS Anchor Positioning Carbon ships — `@position-try` with a nested selector, in `@carbon/styles/scss/components/date-picker/_date-picker-next.scss`. The build transforms all 1928 modules and then dies with `[lightningcss minify] Unexpected token Delim('.')`. `vite.config.ts` pins `cssMinify: 'esbuild'`, which is what Vite 6 used, so this is the status quo rather than a workaround. Revisit when Lightning CSS supports the at-rule.
- **IBM Plex is loaded manually, not by Carbon.** Carbon's `$font-path` default (`~@ibm/plex`) is a webpack-ism Vite cannot resolve, so `index.scss` sets `$css--font-face: false` and `main.tsx` imports `@ibm/plex-sans` / `@ibm/plex-mono`. Re-enable Carbon's font emission and the app silently renders in Helvetica.
- **Check Railway's Node version before trusting a Node floor — it moves.** Vite 6 is pinned here because Vite 8 needs Node 22.12+ and Railway shipped 22.11.0 when that was tried (see `0af4b3e`, an upgrade rolled back after two failed workarounds). That is no longer true: `railway ssh node -v` reports **v22.19.0** as of 2026-08-21, which clears 22.12 — and with it the floors on Vite 8, juice 12 and Prisma 7. Nixpacks resolves the minor from a pinned nixpkgs archive (currently `23f9169c…`, visible in `railway logs --build`), so this drifts without any change on our side. Re-check with `railway ssh node -v` rather than reading this line.
- **`.nvmrc` is pinned to Railway's exact Node, and that is deliberate.** It used to be the bare string `22`, which meant `setup-node` resolved the newest 22.x while production ran 22.19.0 — so a package whose `engines.node` fell between the two passed CI and failed at deploy, during `npm ci`, before the build phase (Prisma 7's `preinstall` gate calls `process.exit(1)`). CI cannot catch that class of failure unless it runs the same version production does. When `railway ssh node -v` reports something newer, update `.nvmrc` and `engines.node` together — do not widen them back to a major.
- **Multiple tsx watch processes**: If the server behaves erratically (500 errors after reconnecting Gmail), check for stale `tsx watch` processes: `pkill -f "tsx watch"` and restart.
- **Carbon icon imports**: `@carbon/icons-react` has no `LogoGoogle` icon. If Vite cache causes import errors after removing an icon, clear `.vite` cache.
- **SCSS partials use `@use`, not `@import`** (`@import` is removed in Dart Sass 3.0). New component styles go in their own `_componentname.scss` and get `@use`d in `index.scss`. `@use` scopes each file, so a partial needing `type.type-style()`, `$spacing-*` or `colors.*` declares its own `@use` header — it does not inherit them.
- **SidePanel z-index**: Carbon SidePanel is z-index 8000. Dropdowns/modals that must float above it need z-index 8001+.
- **Rate limits**: Email send (10/min), bulk ops (20/min), sync (5/min) — defined in `routes/emails.ts`. Login (20/15min) is in `app.ts`.
- **Zod `.partial()` does NOT drop a `.default()`.** It moves the field into an optional wrapper with the default still inside, so an absent field on a PATCH still parses as the default value. `updateDealSchema` silently reset every edited deal to `TO_CHALLENGE` this way. Re-declare the field without its default: `base.partial().extend({ status: statusSchema.optional() })`.
- **Zod `.trim()` belongs before `.min()`, not after.** A trailing `.transform(s => s.trim())` runs *after* the length check, so `'   '` satisfies `min(1)` and is then stored as `''`. Four schemas had this.
- **`z.string().url()` does not restrict the scheme.** `javascript:` and `data:text/html` are well-formed URLs and parse clean. Any URL that ends up in an `href` or `window.open` needs an explicit `.refine(u => /^https?:\/\//i.test(u))` — see `dealPartnerValidator.ts`.
- **sanitize-html deletes `<style>` blocks and their contents**, so CSS inlining (juice) must run *before* sanitising, not after. Reversed, juice receives HTML whose stylesheet is already gone and is a no-op. Sanitising still runs last, which is what keeps it safe.
- **Nodemailer strips Bcc from a built message unless `compiled.keepBcc = true`.** Correct for SMTP (the envelope carries them) but wrong for Gmail's `users.messages.send`, which has no envelope and reads recipients off the raw message — Bcc'd addresses were silently dropped from every send.
- **A bare `null` through `as unknown as Prisma.InputJsonValue` writes jsonb `'null'`, not SQL NULL.** Prisma neither throws nor coerces, so `attendees IS NULL` does not find those rows — 39 of them in production, all from the calendar sync. Use `jsonb_typeof(col) = 'null'` to find them, or `Prisma.DbNull` to avoid making more; `remindersColumn` in `calendarService` shows the correct shape. Left unfixed deliberately: the only SQL-level filter on that column is Prisma's `array_contains`, which emits a `JSONB_TYPEOF(...) = 'array'` guard that excludes jsonb-null and SQL NULL identically, and every JS reader sees `null` for both. It becomes a real bug the moment anything queries `{ attendees: null }`, indexes the column, or is sensitive to `jsonb_typeof`.
- **Prisma's P2025 has no `.status`.** An `update`/`delete` whose `where` carries the ownership filter raises it when the row is not the caller's, so it used to fall through `errorHandler` to a 500. It is now mapped to 404 centrally; a service that wants a specific message should still pre-check and throw its own `AppError`.

## Environment Variables

Copy `.env.example` to **both** `.env` and `server/.env` — only `server/.env` is actually read (see Gotchas). Defaults live in `server/src/config/env.ts`.

- `DATABASE_URL` (dev default: localhost **5435**), `CLIENT_URL` (dev default: `http://localhost:5174`), `PORT` (3002)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` — the redirect URI is bound to the backend port, so moving the frontend port needs no Google Cloud Console change
- `JWT_SECRET`, `JWT_REFRESH_SECRET` (deterministic dev fallbacks — set in production)
- `TOKEN_ENCRYPTION_KEY` (hex, 32 bytes — encrypts Google tokens at rest; **unset = plaintext storage**, it falls back silently)
- `ALLOWED_EMAILS` (comma-separated whitelist, empty = open access). Each entry is a whole address, or a whole domain written with its leading `@` — `@powerm.ma` admits everyone at that domain but not at a subdomain of it, and never at a domain that merely ends with it. Matching lives in `utils/allowedEmails.ts` with tests; it is the only thing between a Google account and the data.
- `RFP_STORAGE_DIR` — where tender documents are written. **On Railway this must be a mounted volume**; an unmounted path is rebuilt on every deploy and loses every document silently, because uploads keep succeeding. Empty locally = `<server cwd>/uploads/rfp`.
- Sync: `SYNC_INTERVAL_SECONDS`, `EMAIL_SYNC_ENABLED`, `CALENDAR_SYNC_ENABLED`, `CALENDAR_SYNC_INTERVAL_SECONDS`, `EMAIL_SYNC_MONTHS`, `CALENDAR_SYNC_PAST_MONTHS`, `CALENDAR_SYNC_FUTURE_MONTHS`, `SYNC_CATCHUP_DAYS` (bounds the catch-up when Gmail rejects the history token, default 7)
- Gmail throttling: `GMAIL_MAX_CONCURRENT` (5), `GMAIL_MIN_TIME_MS` (50), `GMAIL_MAX_RETRIES` (5), `GMAIL_RETRY_BASE_MS` (1000), `GMAIL_RETRY_MAX_MS` (32000)
- Tests: `TEST_DATABASE_URL` / `TEST_DATABASE_BASE_URL` — see `server/src/test/README.md`

## Versioning

The version lives in one place: the repo-root **`VERSION`** file, as
`major.minor.patch.build` — four components, so a rebuild of unchanged code can
be told apart from a change to it.

**Bump it in the commit that ships the change.** The deployed container has
neither `.git` nor any Railway variable carrying the commit (both checked), so
the version is only accurate because it is committed alongside the code it
describes. Nothing derives it at runtime.

- The server reads `VERSION` at startup and serves it from **`GET /api/version`**
  — public and outside `/api/v1` on purpose, because "what is deployed" is
  usually asked while something is broken, and needing a session to answer it
  makes it useless exactly then. It carries version, start time and environment,
  and nothing else; the shape is the security boundary.
- The client has it substituted at build time (`__APP_VERSION__`, via `define`
  in `vite.config.ts`) and shows both its own and the server's in the About
  dialog. They can legitimately differ — a tab holds the bundle it loaded — and
  the dialog says "Reload to update" when they do.
- A missing `VERSION` degrades to `"unknown"` with a warning rather than
  throwing. An app that will not boot because it cannot say what it is would be
  worse than one that admits it does not know.

**CI enforces the bump.** A pull request that changes anything under `client/`
or `server/` — excluding tests and `server/src/test/` — fails unless `VERSION`
changed in the same branch. It is a separate job from `verify`: no database, no
install, no build, so it answers in seconds and says exactly one thing.

```bash
curl -s https://mailviz.rkube.io/api/version | jq .data
# { "version": "1.0.1.0", "releasedAt": "..." }
```

The endpoint carries **two fields and no more**. It is served to the internet,
so its shape is the security boundary — the environment name and process start
time were deliberately removed, and a test pins the exact key set so neither
comes back by accident. `releasedAt` is the BUILD time, substituted by esbuild;
process start would relabel every container restart as a release.

## Deployment (Railway)

**A volume is required since 1.15.** RFP documents are the only bytes this app keeps on disk. Attach a Railway volume, mount it (e.g. `/data`), and set `RFP_STORAGE_DIR=/data/rfp`. Without it uploads appear to work and vanish at the next deploy.

Configured via `nixpacks.toml` + `railway.json`. Node 22 via nixPkgs. Build: `npm ci` → client vite build → server `prisma generate` + esbuild. Start: `cd server && npx prisma migrate deploy && node dist/index.js`. Healthcheck: `/api/health`.

### Running a script against production

**`railway run` does not do what it sounds like.** It runs the command *on your
machine* with the production environment injected, and `DATABASE_URL` is
`postgres.railway.internal:5432` — a hostname that only resolves inside
Railway's network. `railway run npm run backfill …` therefore fails with
"Can't reach database server", every time.

Run it inside the container instead. `esbuild.config.js` globs every `.ts` under
`src/`, so the scripts ship compiled in `dist/` and need no `tsx`:

```bash
railway ssh node /app/server/dist/scripts/backfillAll.js           # dry run
railway ssh node /app/server/dist/scripts/backfillAll.js --apply
```

Quoting is mangled through `railway ssh`, so pass a plain argv — `sh -c "cd … && …"`
silently loses the `cd`. For ad-hoc queries from your own machine, use the
Postgres service's public proxy instead of the internal host:
`DATABASE_URL=$(railway variables --service Postgres --json | jq -r .DATABASE_PUBLIC_URL)`.


## Database Schema

The database schema is defined in the ./server/src/prisma/schema.prisma file. Reference it anytime you need to understand the structure of data stored in the database.

