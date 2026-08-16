# MailViz — CRM with Gmail & Google Calendar Integration

A full-stack CRM with deep Gmail and Google Calendar integration. Manage customers, contacts, deals, tasks, and email in one workspace with real-time sync.

![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)
![React](https://img.shields.io/badge/React-19-61dafb)
![Express](https://img.shields.io/badge/Express-5-000)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791)
![Carbon](https://img.shields.io/badge/Carbon_Design-IBM-171717)

## Features

### Email Management
- **Bidirectional Gmail sync** — email syncs from Gmail; archive, trash, star, and read actions sync back
- **Real-time updates** — background poll every 60s with WebSocket push to the browser
- **Thread view** — grouped conversations, inline body rendering, attachment previews
- **Compose** — rich text (Tiptap), attachments, recipient autocomplete, reusable signature
- **Scheduled send** — queue an email or reply for later, reschedule or cancel it; a scheduler delivers it and reports back over WebSocket
- **Mail Review** — a guided catch-up flow for a chosen period: pick a date range, review a per-company summary, then work through the mail company by company
- **Email-to-task** — turn any email into a tracked task
- **Search & filtering** — folder (Inbox/Sent/Starred/Archived/Trash/Scheduled), sender, date range, customer, read status, attachments
- **Smart linking** — email is auto-linked to customers and contacts by sender domain

### Deals
- Deal registration with partners, status, and expiry tracking
- Expiring deals surface on the dashboard and generate notifications
- Deal partners managed in Settings

### Task Management
- **Kanban board** with drag-and-drop (dnd-kit) and **list view**
- **Dynamic statuses** — user-defined, drag-reorderable, managed in Settings (not a fixed enum)
- Priority levels, due dates, estimated effort
- **Labels** — create, rename, recolour, and delete in Settings; attach any number to a task
- Customer association and per-task assignment (assignee is notified)

### Calendar
- Google Calendar sync, bidirectional
- Month, week, and day views (week starts Monday)
- Event create/edit with location, attendees, Google Meet links, and colors
- **Recurrence on create** — Daily / Weekly / Monthly / Yearly presets anchored to the start date
- Reminders (up to 5 method/minutes overrides, or the calendar default) and visibility (default/public/private)
- RSVP from inside the app

### Customer & Contact Management
- Company profiles with domain, logo, category (drag-reorderable in Settings), VIP flag, and notes
- **Auto-discovery** — companies and contacts are created automatically from email domains
- Contact directory with role, phone, and email
- Per-customer activity: email, tasks, events, and attachments in one place

### Collaboration
- **Sharing** — share email threads, tasks, and deals with other users
- Shared items appear in the recipient's normal lists (enforced server-side in `utils/accessControl.ts`),
  carry a **Shared** badge, and can be filtered to owned-only or shared-only on Tasks and Deals
- **Notifications** — in-app bell for overdue/due-soon tasks, starting events, expiring deals, and shares
- **Audit log** — an Activity page recording actions across email, tasks, and contacts

### Dashboard
- Task summary tiles and a task-status donut
- Recent email and recent tasks
- 14-day email volume chart (sent vs received)
- Top customers, upcoming events, expiring deals

### Real-Time Sync
- WebSocket server pushes sync events to all connected browsers — one shared, reference-counted
  connection per tab, with a "Reconnecting" indicator in the header when it drops
- Background schedulers: email (60s), calendar (120s), scheduled send (30s), notifications (5 min)
- Incremental sync via the Gmail History API — only fetches what changed. When Gmail expires the
  history token, catch-up is bounded to `SYNC_CATCHUP_DAYS` rather than re-syncing the whole mailbox
- Per-user Gmail rate limiting (`lib/gmailLimiter.ts`, Bottleneck) with backoff on 429/rate-limit 403
- Reconnecting the socket refetches mail, calendar, and sidebar counts
- Live unread badge in the sidebar

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 6, TypeScript 5.9 |
| UI | IBM Carbon Design System (g100 dark theme) |
| Charts | @carbon/charts-react, D3.js |
| Editor | Tiptap |
| State | Zustand |
| Backend | Express 5, TypeScript |
| Database | PostgreSQL 16 (Docker) |
| ORM | Prisma 6 |
| Auth | Google OAuth 2.0 → JWT in httpOnly cookies |
| APIs | Gmail API, Google Calendar API |
| Real-time | WebSocket (ws) |
| Scheduling | node-cron |
| Validation | Zod 4 |

## Getting Started

### Prerequisites

- **Node.js 22** (see `.nvmrc`; Vite 6 is pinned for Node 22 compatibility)
- **Docker** and Docker Compose (for PostgreSQL)
- A **Google Cloud Console** project with OAuth 2.0 credentials

### 1. Clone and install

```bash
git clone https://github.com/wlargou/mailviz.git && cd mailviz && npm install
```

### 2. Start the database

```bash
npm run db:up
```

PostgreSQL 16 listens on host port **5435** (container port 5432).

### 3. Configure environment

```bash
cp .env.example .env && cp .env.example server/.env
```

> **Important:** the server loads `server/.env`, not the repo-root `.env` — `dotenv.config()` reads
> from the working directory, and the workspace dev script runs inside `server/`. The Prisma CLI
> also reads `server/.env` when run from that folder. Keep both files in sync, or treat
> `server/.env` as the source of truth. A stale root `.env` is silently ignored.

Generate the three secrets:

```bash
node -e "const c=require('crypto');for(const k of ['JWT_SECRET','JWT_REFRESH_SECRET','TOKEN_ENCRYPTION_KEY'])console.log(k+'='+c.randomBytes(32).toString('hex'))"
```

`TOKEN_ENCRYPTION_KEY` encrypts Google OAuth tokens at rest with AES-256-GCM. **If it is unset, tokens
are stored in plaintext** — `utils/encryption.ts` falls back silently. Existing plaintext tokens keep
working after you set it and are re-encrypted on next write.

### 4. Set up Google OAuth

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create or select a project
2. Enable the **Gmail API** and **Google Calendar API**
3. **Credentials** → create an **OAuth 2.0 Client ID**
4. Add `http://localhost:3002/api/v1/auth/google/callback` as an authorized redirect URI
5. Copy the client ID and secret into your env files

The redirect URI is bound to the **backend** port (3002), so changing the frontend port does not require a Google Console change.

### 5. Run migrations

```bash
npm run prisma:generate --workspace=server && cd server && npx prisma migrate deploy && cd ..
```

### 6. Start the app

```bash
npm run dev
```

- **Frontend** → http://localhost:5174
- **Backend** → http://localhost:3002

### 7. Connect your Google account

Open **Settings** → **Connect Google Account**, authorize Gmail and Calendar, and sync begins automatically.

## Development Commands

```bash
npm run dev          # Postgres must be up; runs server + client concurrently
npm run db:up        # Start PostgreSQL
npm run db:down      # Stop PostgreSQL
npm run db:migrate   # prisma migrate dev (interactive — needs a real TTY)
npm run db:seed      # Seed dev data
npm run typecheck    # tsc --noEmit across both workspaces
npm run test         # Vitest, both workspaces
npm run build        # Build client then server
```

Note that `npm run build` does **not** typecheck — Vite and esbuild strip types without reading them.
Run `npm run typecheck` (CI does) to actually check them.

The server suite runs against a **real PostgreSQL** (`npm run db:up` first), not a mocked Prisma —
it exists to catch cross-tenant leaks, which are where-clause bugs a mock would happily accept.
Each run creates and drops its own `mailviz_test_<random>` database. See
[`server/src/test/README.md`](server/src/test/README.md) for pinning a database, the single-fork
constraint, and how to write a test here.

## Ports

These were chosen to avoid colliding with other local projects. Change them in `docker-compose.yml`,
`client/vite.config.ts`, and your env files if needed.

| Service | Port |
|---------|------|
| PostgreSQL | 5435 |
| Backend API + WebSocket | 3002 |
| Frontend (Vite) | 5174 |

Vite runs with `strictPort: true` so a taken port fails loudly instead of silently shifting — a shifted
port would break `CLIENT_URL` and the OAuth flow.

## Project Structure

```
mailviz/
├── client/                     # React frontend
│   └── src/
│       ├── api/                # Axios API clients
│       ├── components/
│       │   ├── audit/          # Activity log page
│       │   ├── auth/           # Login, protected route
│       │   ├── calendar/       # Calendar views and event modals
│       │   ├── contacts/       # Contact directory
│       │   ├── customers/      # Customer profiles
│       │   ├── dashboard/      # Dashboard widgets and charts
│       │   ├── deals/          # Deal registration
│       │   ├── layout/         # Shell, sidebar, header, search, notifications, ConnectionStatus
│       │   ├── mail/           # Threads, compose, and review/ subflow
│       │   ├── settings/       # Google account, statuses, categories, labels, partners, signature
│       │   ├── shared/         # Reusable components (SharedBadge, PageHeader, …)
│       │   └── tasks/          # Kanban board and task modals
│       ├── hooks/              # Custom hooks (shared WebSocket, etc.)
│       ├── store/              # Zustand state stores
│       ├── styles/             # SCSS partials, imported by index.scss
│       ├── types/              # TypeScript interfaces
│       └── utils/              # Helper functions
│
├── server/                     # Express backend
│   └── src/
│       ├── config/             # Environment config
│       ├── controllers/        # HTTP request handlers
│       ├── jobs/               # Email, calendar, scheduled-send, notification schedulers
│       ├── lib/                # Shared Prisma client, Gmail helper, Gmail rate limiter
│       ├── middleware/         # Auth, validation, error handling
│       ├── prisma/             # Schema and migrations
│       ├── routes/             # API route definitions
│       ├── services/           # Business logic
│       ├── test/               # Vitest harness: per-run DB, factories, Gmail mock (see its README)
│       ├── types/              # Express type augmentation
│       ├── utils/              # Pagination, domain resolver, encryption, access control
│       ├── validators/         # Zod request validation
│       ├── websocket.ts        # WebSocket server
│       └── index.ts            # Entry point
│
├── .github/workflows/ci.yml    # Migrate, typecheck, test, build, audit
├── BACKLOG.md                  # Committed roadmap
├── docker-compose.yml          # PostgreSQL container
└── package.json                # Monorepo root
```

## API Overview

All endpoints are prefixed with `/api/v1`. Every group except `auth` sits behind `requireAuth`.

| Resource | Mount | Notes |
|----------|-------|-------|
| Auth | `/auth` | Google OAuth login/callback, `/me`, logout, connect/disconnect, users list, signature |
| Emails | `/emails` | Threads, actions, compose/reply/forward, attachments, scheduled send, sharing, `/review-summary` |
| Tasks | `/tasks` | CRUD, reorder, assign, sharing |
| Task statuses | `/task-statuses` | User-defined Kanban columns, reorderable |
| Customers | `/customers` | CRUD, VIP, linked events and attachments |
| Company categories | `/company-categories` | Customer tagging, reorderable |
| Contacts | `/contacts` | CRUD, VIP, lookup by email |
| Deals | `/deals` | CRUD and sharing |
| Deal partners | `/deal-partners` | Partner directory |
| Calendar | `/calendar` | Events CRUD, RSVP, sync |
| Labels | `/labels` | Task labels, managed in Settings |
| Dashboard | `/dashboard` | Aggregate stats, sidebar nav counts |
| Search | `/search` | Global search across 6 entity types (4 results each) |
| Notifications | `/notifications` | In-app notification feed |
| Audit logs | `/audit-logs` | Activity history |

Batch actions follow `POST /emails/batch/{action}` with a `{ ids: string[] }` body.
Tasks and deals accept `?ownership=owned|shared` to separate your own items from ones shared with you.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://mailviz:mailviz_dev@localhost:5435/mailviz_db?schema=public` |
| `PORT` | Backend server port | `3002` |
| `NODE_ENV` | Environment | `development` |
| `CLIENT_URL` | Frontend URL (CORS + post-login redirect) | `http://localhost:5174` |
| `GOOGLE_CLIENT_ID` | OAuth 2.0 client ID | — |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 client secret | — |
| `GOOGLE_REDIRECT_URI` | OAuth callback URL | `http://localhost:3002/api/v1/auth/google/callback` |
| `JWT_SECRET` | Signs access tokens (15 min) | insecure dev default |
| `JWT_REFRESH_SECRET` | Signs refresh tokens (7 d) | insecure dev default |
| `TOKEN_ENCRYPTION_KEY` | 32-byte hex; encrypts Google tokens at rest | unset → **plaintext** |
| `ALLOWED_EMAILS` | Comma-separated login whitelist | empty → open access |
| `SYNC_INTERVAL_SECONDS` | Email sync poll interval | `60` |
| `EMAIL_SYNC_ENABLED` | Toggle background email sync | `true` |
| `EMAIL_SYNC_MONTHS` | Initial-sync window in months; `0` = the whole mailbox | `0` |
| `SYNC_CATCHUP_DAYS` | Window re-listed when Gmail expires the history token (bounds the fallback so it can't become a full re-sync) | `7` |
| `CALENDAR_SYNC_ENABLED` | Toggle background calendar sync | `true` |
| `CALENDAR_SYNC_INTERVAL_SECONDS` | Calendar poll interval | `120` |
| `CALENDAR_SYNC_PAST_MONTHS` | How far back calendar sync reaches | `24` |
| `CALENDAR_SYNC_FUTURE_MONTHS` | How far forward calendar sync reaches | `12` |
| `GMAIL_MAX_CONCURRENT` | Concurrent Gmail calls per user | `5` |
| `GMAIL_MIN_TIME_MS` | Minimum spacing between Gmail calls per user | `50` |
| `GMAIL_MAX_RETRIES` | Retries on 429 / rate-limit 403 | `5` |
| `GMAIL_RETRY_BASE_MS` | Backoff base | `1000` |
| `GMAIL_RETRY_MAX_MS` | Backoff cap | `32000` |
| `LOGO_DEV_TOKEN` | logo.dev key for company logos | a public demo key |

The five `GMAIL_*` values feed the per-user Bottleneck limiter in `lib/gmailLimiter.ts`. The defaults
cap one user at roughly 100 of Gmail's 250 quota units/second, leaving headroom for calls that do not
route through it — raise them only if you know the quota you are spending.

`JWT_SECRET`, `JWT_REFRESH_SECRET`, `ALLOWED_EMAILS`, and `TOKEN_ENCRYPTION_KEY` all have permissive
dev fallbacks so the app boots without them. **Set all four in production.**

## Roadmap

**[`BACKLOG.md`](BACKLOG.md) is the roadmap** — the one file anyone is obliged to keep current. It is
committed deliberately: the earlier plans lived in `.claude/plans/`, which is gitignored, so they
never survived a clone and rotted unnoticed.

It is ordered by cost-to-value — Phase 1 (backend already built, UI missing) is complete; Phase 2 is
the scoped-but-unstarted work carried over from those plans; Phase 3 is genuine product gaps; Phase 4
is testing.

Two design documents survive in [`docs/plans/`](docs/plans/), because they hold detail a backlog line
cannot: [`live-email-sync.md`](docs/plans/live-email-sync.md) (the Pub/Sub design behind item 2.1) and
[`event-creation-enhancement.md`](docs/plans/event-creation-enhancement.md) (why shipping without a
custom recurrence builder is acceptable). The Carbon audit that used to live in
`TODO-CARBON-AUDIT.md` has been folded into the backlog — it had started to contradict it.

## Known Gaps

- **No Gmail push.** Phase 4 of the sync work (Google Cloud Pub/Sub) is not started — production runs
  60s polling as a deliberate stand-in. The one architecturally significant item left.
- **No drafts.** Gmail drafts are not synced at all, and compose has no save-and-return. The most
  conspicuous absence for a mail client.
- **No contact dedupe or merge.** Auto-discovery creates a contact for every sender, so there is no
  way to collapse duplicates — the gap most likely to bite at real mailbox volume.
- **Mail Review has no pagination** — `ReviewMailView` fetches a fixed 500 threads and filters
  client-side, so long review periods truncate silently.
- **No templates, snooze, CSV import/export, or mail rules.** Zero references to any of them.
- **Gmail send paths are untested.** Sync and the batch actions run against a mocked Gmail API, but
  send, reply, forward, and attachments have no coverage.
- **Two reverted fixes remain unsolved**: the Carbon SidePanel close-button tooltip showing on mount,
  and the email volume chart's opaque `g100` background (a CSS override in `_dashboard.scss` masks it).
- **The four main list pages cannot sort.** Customers, Contacts, Deals, and Tasks use Carbon
  `DataTable` as a styling shell only. See `BACKLOG.md` for the rest of the known quality debt.

## License

MIT
