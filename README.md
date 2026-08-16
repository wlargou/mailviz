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
- **Scheduled send** — queue an email or reply for later; a scheduler delivers it and reports back over WebSocket
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
- **Dynamic statuses** — user-defined, managed in Settings (not a fixed enum)
- Priority levels, labels, due dates, estimated effort
- Customer association and per-task assignment

### Calendar
- Google Calendar sync, bidirectional
- Month, week, and day views (week starts Monday)
- Event create/edit with location, attendees, Google Meet links, and colors
- Recurring event support, RSVP from inside the app

### Customer & Contact Management
- Company profiles with domain, logo, category, VIP flag, and notes
- **Auto-discovery** — companies and contacts are created automatically from email domains
- Contact directory with role, phone, and email
- Per-customer activity: email, tasks, events, and attachments in one place

### Collaboration
- **Sharing** — share email threads, tasks, and deals with other users
- Shared items appear in the recipient's normal lists (enforced server-side in `utils/accessControl.ts`)
- **Notifications** — in-app bell for overdue/due-soon tasks, starting events, expiring deals, and shares
- **Audit log** — an Activity page recording actions across email, tasks, and contacts

### Dashboard
- Task summary tiles and a task-status donut
- Recent email and recent tasks
- 14-day email volume chart (sent vs received)
- Top customers, upcoming events, expiring deals

### Real-Time Sync
- WebSocket server pushes sync events to all connected browsers
- Background schedulers: email (60s), calendar (120s), scheduled send (30s), notifications (5 min)
- Incremental sync via the Gmail History API — only fetches what changed
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
npm run build        # Build client then server
```

Note that `npm run build` does **not** typecheck — Vite and esbuild strip types without reading them.
Run `npm run typecheck` (CI does) to actually check them.

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
│       │   ├── layout/         # Shell, sidebar, header, search, notifications
│       │   ├── mail/           # Threads, compose, and review/ subflow
│       │   ├── settings/       # Google account, statuses, categories, signature
│       │   ├── shared/         # Reusable components
│       │   └── tasks/          # Kanban board and task modals
│       ├── hooks/              # Custom hooks (WebSocket, etc.)
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
│       ├── lib/                # Shared Prisma client, Gmail helper
│       ├── middleware/         # Auth, validation, error handling
│       ├── prisma/             # Schema and migrations
│       ├── routes/             # API route definitions
│       ├── services/           # Business logic
│       ├── types/              # Express type augmentation
│       ├── utils/              # Pagination, domain resolver, encryption, access control
│       ├── validators/         # Zod request validation
│       ├── websocket.ts        # WebSocket server
│       └── index.ts            # Entry point
│
├── .github/workflows/ci.yml    # Typecheck, migrate, build, audit
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
| Task statuses | `/task-statuses` | User-defined Kanban columns |
| Customers | `/customers` | CRUD, VIP, linked events and attachments |
| Company categories | `/company-categories` | Customer tagging |
| Contacts | `/contacts` | CRUD, VIP, lookup by email |
| Deals | `/deals` | CRUD and sharing |
| Deal partners | `/deal-partners` | Partner directory |
| Calendar | `/calendar` | Events CRUD, RSVP, sync |
| Labels | `/labels` | Task labels (CRUD exists; see Known Gaps) |
| Dashboard | `/dashboard` | Aggregate stats, sidebar nav counts |
| Search | `/search` | Global search across 5 entity types |
| Notifications | `/notifications` | In-app notification feed |
| Audit logs | `/audit-logs` | Activity history |

Batch actions follow `POST /emails/batch/{action}` with a `{ ids: string[] }` body.

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
| `CALENDAR_SYNC_ENABLED` | Toggle background calendar sync | `true` |
| `CALENDAR_SYNC_INTERVAL_SECONDS` | Calendar poll interval | `120` |

`JWT_SECRET`, `JWT_REFRESH_SECRET`, `ALLOWED_EMAILS`, and `TOKEN_ENCRYPTION_KEY` all have permissive
dev fallbacks so the app boots without them. **Set all four in production.**

## Roadmap

Plans live in `.claude/plans/`. Note that `.claude/` is gitignored, so these exist only on the
machine that wrote them — worth committing if the roadmap should survive a fresh clone.

| Plan | Status |
|------|--------|
| `live-email-sync.md` | Phases 1–3 done (Gmail actions, polling sync, WebSocket). **Phase 4 (Google Cloud Pub/Sub real-time) and Phase 5 (resilience & polish) not started** — production runs on 60s polling as a stand-in. |
| `event-creation-enhancement.md` | Phases 1–2 shipped (attendees, Meet, colors). Recurrence-on-create, reminders, and visibility still open. |
| `notification-system.md` | Shipped. |
| `001-mail-review.md` | Shipped. |

`TODO-CARBON-AUDIT.md` tracks Carbon Design System compliance. Its checkboxes are unmaintained —
trust the summary table and verify against source before starting an item.

## Known Gaps

- **No tests.** There is no test runner, no test files, and no coverage anywhere in the repo.
- **Labels have no management UI.** Full CRUD exists server-side and in `api/labels.ts`, but nothing
  calls create/update/delete — labels can only be created by the seed script.
- **Task assignment bypasses its own endpoint.** `TaskDetailModal` sets `assignedToId` via the generic
  `PATCH /tasks/:id`, so the `task:assigned` notification and WebSocket event never fire.
- **No "shared with me" view.** Shared items blend into normal lists with no badge.
- **Mail Review has no pagination** — it fetches a fixed 500 threads and filters client-side, so long
  review periods truncate silently.
- **Audit coverage is partial.** `customerService`, `dealService`, `calendarService`, and
  `labelService` write no audit entries, so those changes don't appear in the Activity log.
- **Client typecheck is not yet clean** — remaining errors are `@carbon/react` and
  `@carbon/charts-react` typing failures, pending a Carbon upgrade. CI runs it non-blocking.
- **Two reverted fixes remain unsolved**: the Carbon SidePanel close-button tooltip showing on mount,
  and the email volume chart's opaque `g100` background (a CSS override in `_dashboard.scss` masks it).

## License

MIT
