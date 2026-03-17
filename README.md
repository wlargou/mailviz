# MailViz — CRM with Gmail & Google Calendar Integration

A full-stack CRM application with deep Gmail and Google Calendar integration. Manage customers, contacts, tasks, and emails in one unified workspace with real-time sync.

![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)
![React](https://img.shields.io/badge/React-18.3-61dafb)
![Express](https://img.shields.io/badge/Express-4.21-000)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791)
![Carbon](https://img.shields.io/badge/Carbon_Design-IBM-171717)

## Features

### Email Management
- **Bidirectional Gmail sync** — emails sync from Gmail, and actions (archive, trash, star, mark read) sync back
- **Real-time updates** — background sync every 60s with WebSocket push to the browser
- **Thread view** — grouped conversations with inline body rendering and attachment previews
- **Smart linking** — emails are automatically linked to customers/contacts based on domain
- **Email-to-task conversion** — turn any email into a trackable task with one click
- **Search & filtering** — filter by folder (Inbox/Sent/Starred/Archived/Trash), sender, date range, customer, read status, and attachments

### Task Management
- **Kanban board** with drag-and-drop (powered by dnd-kit)
- **List view** with sorting and filtering
- **Priority levels** — Low, Medium, High, Urgent
- **Labels** with custom colors
- **Customer association** — link tasks to companies

### Calendar
- **Google Calendar sync** with bidirectional event management
- **Month, week, and day views**
- **Event creation/editing** with location, attendees, and conference links
- **Recurring event support**
- **Customer association** — link events to companies

### Customer & Contact Management
- **Company profiles** with domain, logo, notes, and website
- **Auto-discovery** — new companies and contacts are created automatically from email domains
- **Contact directory** with role, phone, and email
- **Activity view** — see all emails, tasks, and events for a customer in one place

### Dashboard
- **Metric tiles** — tasks by status, unread emails, events today
- **My Day** — today's events and due tasks in a timeline
- **Email volume chart** — 14-day sent/received bar chart
- **Task status donut** — visual breakdown of TODO/In Progress/Done
- **Needs Attention** — dormant customers with open tasks
- **Frequent Contacts** — top email correspondents
- **Top Customers** — most active companies
- **Quick Add Task** — create tasks without leaving the dashboard

### Real-Time Sync
- **WebSocket** server pushes sync events to all connected browsers
- **Background scheduler** polls Gmail every 60s for new emails and label changes
- **Incremental sync** via Gmail History API — only fetches what changed
- **Live unread badge** in the sidebar updates automatically

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, TypeScript |
| UI | IBM Carbon Design System |
| Charts | @carbon/charts-react, D3.js |
| State | Zustand |
| Backend | Express.js, TypeScript |
| Database | PostgreSQL 16 (Docker) |
| ORM | Prisma |
| Auth | Google OAuth 2.0 |
| APIs | Gmail API, Google Calendar API |
| Real-time | WebSocket (ws) |
| Scheduling | node-cron |
| Validation | Zod |

## Getting Started

### Prerequisites

- **Node.js** 18+
- **Docker** and Docker Compose (for PostgreSQL)
- **Google Cloud Console** project with OAuth 2.0 credentials

### 1. Clone and Install

```bash
git clone https://github.com/wlargou/mailviz.git
cd mailviz
npm install
```

### 2. Set Up the Database

```bash
docker compose up -d
```

This starts PostgreSQL 16 on port `5433`.

### 3. Configure Environment

Copy the example env and fill in your credentials:

```bash
cp .env.example .env
```

```env
DATABASE_URL="postgresql://mailviz:mailviz_dev@localhost:5433/mailviz_db?schema=public"
PORT=3002
CLIENT_URL=http://localhost:5173
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3002/api/v1/auth/google/callback
```

### 4. Set Up Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Enable **Gmail API** and **Google Calendar API**
4. Go to **Credentials** → Create **OAuth 2.0 Client ID**
5. Set authorized redirect URI to `http://localhost:3002/api/v1/auth/google/callback`
6. Copy Client ID and Client Secret to your `.env`

### 5. Run Migrations

```bash
cd server
npx prisma migrate deploy
npx prisma generate
cd ..
```

### 6. Start the App

```bash
npm run dev
```

This starts both servers concurrently:
- **Frontend** → http://localhost:5173
- **Backend** → http://localhost:3002

### 7. Connect Google Account

1. Open the app and go to **Settings**
2. Click **Connect Google Account**
3. Authorize Calendar and Gmail access
4. Emails and calendar events will begin syncing automatically

## Project Structure

```
mailviz/
├── client/                     # React frontend
│   └── src/
│       ├── api/                # Axios API clients
│       ├── components/
│       │   ├── calendar/       # Calendar views and event modals
│       │   ├── contacts/       # Contact directory
│       │   ├── customers/      # Customer profiles
│       │   ├── dashboard/      # Dashboard widgets and charts
│       │   ├── layout/         # Shell, sidebar, header
│       │   ├── mail/           # Email thread list and detail
│       │   ├── settings/       # Google account settings
│       │   ├── shared/         # Reusable components
│       │   └── tasks/          # Kanban board and task modals
│       ├── hooks/              # Custom hooks (WebSocket, etc.)
│       ├── store/              # Zustand state stores
│       ├── styles/             # Global SCSS
│       ├── types/              # TypeScript interfaces
│       └── utils/              # Helper functions
│
├── server/                     # Express backend
│   └── src/
│       ├── config/             # Environment config
│       ├── controllers/        # HTTP request handlers
│       ├── jobs/               # Background sync scheduler
│       ├── middleware/         # Error handling
│       ├── prisma/             # Schema and migrations
│       ├── routes/             # API route definitions
│       ├── services/           # Business logic
│       ├── utils/              # Pagination, domain resolver
│       ├── validators/         # Zod request validation
│       ├── websocket.ts        # WebSocket server
│       └── index.ts            # Entry point
│
├── docker-compose.yml          # PostgreSQL container
└── package.json                # Monorepo root
```

## API Overview

All endpoints are prefixed with `/api/v1`.

| Resource | Endpoints |
|----------|-----------|
| Auth | `GET /auth/google/url`, `GET /auth/google/callback`, `GET /auth/google/status`, `DELETE /auth/google` |
| Dashboard | `GET /dashboard/stats` |
| Emails | `GET /emails/threads`, `GET /emails/threads/:threadId`, `GET /emails/:id`, `PATCH /emails/:id/read`, `PATCH /emails/:id/unread`, `PATCH /emails/:id/star`, `PATCH /emails/:id/archive`, `PATCH /emails/:id/trash`, `POST /emails/:id/convert-task`, `POST /emails/sync` |
| Tasks | `GET /tasks`, `POST /tasks`, `GET /tasks/:id`, `PUT /tasks/:id`, `DELETE /tasks/:id`, `PATCH /tasks/:id/position` |
| Customers | `GET /customers`, `POST /customers`, `GET /customers/:id`, `PUT /customers/:id`, `DELETE /customers/:id` |
| Contacts | `GET /contacts`, `POST /contacts`, `GET /contacts/:id`, `PUT /contacts/:id`, `DELETE /contacts/:id` |
| Calendar | `GET /calendar/events`, `POST /calendar/events`, `GET /calendar/events/:id`, `PUT /calendar/events/:id`, `DELETE /calendar/events/:id`, `POST /calendar/sync` |
| Labels | `GET /labels`, `POST /labels`, `PUT /labels/:id`, `DELETE /labels/:id` |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | — |
| `PORT` | Backend server port | `3002` |
| `CLIENT_URL` | Frontend URL (for CORS) | `http://localhost:5173` |
| `GOOGLE_CLIENT_ID` | OAuth 2.0 client ID | — |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 client secret | — |
| `GOOGLE_REDIRECT_URI` | OAuth callback URL | — |
| `SYNC_INTERVAL_SECONDS` | Email sync polling interval | `60` |
| `EMAIL_SYNC_ENABLED` | Enable/disable background sync | `true` |

## License

MIT
