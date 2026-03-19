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
npm run dev --workspace=client    # Vite on port 5173

# Database
npm run db:up                     # Start PostgreSQL (port 5433)
npm run db:down                   # Stop PostgreSQL
npm run db:migrate                # npx prisma migrate dev
npm run db:seed                   # npx prisma db seed

# Prisma (run from server/)
npx prisma generate               # After schema changes
npx prisma migrate dev --name X   # Create new migration
npx prisma migrate deploy         # Apply migrations (prod)
npx prisma studio                 # GUI database browser

# Build
cd client && npx vite build       # Client → client/dist/
cd server && node esbuild.config.js  # Server → server/dist/
```

## Architecture

**Monorepo** with npm workspaces: `client/` (React + Vite) and `server/` (Express + Prisma). Both use ESM.

### Server (`server/src/`)
- **Entry**: `index.ts` → creates HTTP server, initializes WebSocket (`/ws`), starts background sync schedulers
- **Pattern**: Routes → Controllers → Services → Prisma. Zod validators in `validators/`.
- **Auth**: Google OAuth login → JWT access (15min) + refresh (7d) tokens in httpOnly cookies. Middleware in `middleware/auth.ts`.
- **Shared Prisma**: Single instance in `lib/prisma.ts` — import from there, never `new PrismaClient()`.
- **Gmail helper**: `lib/gmail.ts` exports `getGmailClient()` — use instead of manual oauth2Client + google.gmail pattern.
- **Real-time**: `websocket.ts` broadcasts events (`wsEmit`). Clients auto-refresh on `emails:synced`, `email:updated`, etc.
- **Background jobs**: `jobs/emailSyncScheduler.ts` (60s) and `jobs/calendarSyncScheduler.ts` (120s) poll Google APIs.
- **Build**: esbuild with `bundle: false` (required for Prisma), ESM format, Node 22 target.

### Client (`client/src/`)
- **UI**: IBM Carbon Design System (g100 dark theme). Components from `@carbon/react`, `@carbon/ibm-products`, `@carbon/icons-react`.
- **State**: Zustand stores in `store/` (auth, tasks, calendar, ui).
- **API**: Axios client in `api/client.ts` with `withCredentials: true` and 401 → redirect to `/login`.
- **Routing**: React Router v6. `ProtectedRoute` wraps authenticated pages inside `AppShell` (header + sidebar).
- **Styles**: SCSS partials in `styles/` — `index.scss` imports `_dashboard`, `_calendar`, `_mail`, `_compose`, `_settings`, `_login`, `_global-search`. All colors use Carbon tokens (`var(--cds-*)`).
- **Dev proxy**: Vite forwards `/api` and `/ws` to `http://localhost:3002`.

### Database (PostgreSQL 16)
- Schema: `server/src/prisma/schema.prisma`
- Key models: User ↔ GoogleAuth (1:1), Task (dynamic string status via TaskStatus model), Email (Gmail sync), CalendarEvent, Customer ↔ Contact, Label
- Task statuses are dynamic (stored in `task_statuses` table), not enum. The Kanban board reads from this table.
- Emails auto-link to customers via domain extraction from sender addresses.

## Key Patterns

- **Error throwing in services**: `throw Object.assign(new Error('msg'), { status: 404 })` — caught by `middleware/errorHandler.ts`
- **Gmail sync**: Best-effort pattern — DB updated first, Gmail API call wrapped in try/catch to not block on API failures
- **Modals inside SidePanel**: Use `createPortal(modal, document.body)` to escape SidePanel overflow constraints
- **Global search**: `GET /api/v1/search?q=` queries emails, tasks, events, customers, contacts in parallel (4 results each)
- **Batch API pattern**: `POST /batch/{action}` with `{ ids: string[] }` body. Resolves thread IDs from email IDs, acts on all emails in threads.
- **Optimistic UI**: For bulk/single email actions, update state immediately, then fire API call. Revert state on failure.
- **Carbon Checkbox click issues**: Carbon's `Checkbox` component captures clicks via internal `<label>`. Workaround: use native `<input type="checkbox">` in a wrapper div with its own click handler and `stopPropagation`.

## Gotchas & Lessons Learned

- **Prisma migrate dev is interactive** — won't work in non-interactive shells. For CI/scripts, create migration directories manually and use `prisma migrate deploy`.
- **Enum to string migration**: When changing a Prisma enum to a string column, write raw SQL: `ALTER TABLE ... ALTER COLUMN ... TYPE VARCHAR USING ...::text`, then `DROP TYPE IF EXISTS "EnumName"`.
- **Vite 8 requires Node 22.12+** — Railway's `nodejs_22` nixPkg is 22.11.0. We use Vite 6 for compatibility.
- **Multiple tsx watch processes**: If the server behaves erratically (500 errors after reconnecting Gmail), check for stale `tsx watch` processes: `pkill -f "tsx watch"` and restart.
- **Carbon icon imports**: `@carbon/icons-react` has no `LogoGoogle` icon. If Vite cache causes import errors after removing an icon, clear `.vite` cache.
- **SCSS file size**: The monolithic `index.scss` was split into partials (`_dashboard`, `_mail`, etc.). New component styles go in their own `_componentname.scss` partial and get `@import`ed in `index.scss`.
- **SidePanel z-index**: Carbon SidePanel is z-index 8000. Dropdowns/modals that must float above it need z-index 8001+.
- **Rate limits**: Email send (10/min), bulk ops (20/min), sync (5/min), login (20/15min). Defined in route files, not app.ts.

## Environment Variables

Copy `.env.example` to `.env`. Required for Google integration:
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- `JWT_SECRET`, `JWT_REFRESH_SECRET` (auto-generated in dev)
- `TOKEN_ENCRYPTION_KEY` (hex, 32 bytes — encrypts Google tokens at rest)
- `ALLOWED_EMAILS` (comma-separated whitelist, empty = open access)

## Deployment (Railway)

Configured via `nixpacks.toml`. Uses Node 22 via nixPkgs. Build: `npm ci` → client vite build → server esbuild + prisma generate → `prisma migrate deploy && node dist/index.js`.


## Database Schema

The database schema is defined in the ./server/@prisma/schema.prisma file. Reference it anytime you need to understand the structure of data stored in the database.

