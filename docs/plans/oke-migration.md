# MailViz → Olympusx Productivity Hub on Oracle OKE

**Assessment and plan. Nothing has been changed.** No deploy, no cluster write, no DNS change, no
Google Cloud Console change, no push, no PR. This file lives on the local branch
`plan/oke-migration`, uncommitted.

- Date: 2026-10-17. Production then: MailViz **1.29.0.0** on Railway, merge `4f47cff`.
- Evidence was gathered read-only from:
  - this repository (`main` at `4f47cff`);
  - `~/olympusx-hosting` (`7d9e6ea`) and `~/support-hub`, with Support Hub's OKE kit read at
    `origin/main:deploy/oke/` through its worktree `.claude/worktrees/oke-olympusxai`;
  - the Railway CLI (names and lengths only, never a secret value);
  - public DNS;
  - Google, CloudNativePG, Envoy Gateway and Oracle documentation;
  - the live OKE cluster `olympusx` through `scripts/oke`, between 12:40 and 13:10 UTC. The Bastion
    session was deleted afterwards.
- Paths without a prefix are in this repo. `hosting/` means `~/olympusx-hosting/`. `sh-kit/` means
  Support Hub's `origin/main:deploy/oke/`.
- **Owner** in the step tables is either **Claude** (writes code and manifests, opens nothing
  without your go) or **You** (IAM, OCI credentials, DNS, Google Cloud Console, Admin console,
  merges, applies to the shared Gateway).

---

## 0. Summary

The move itself is small:
- one Node process;
- a 1.15 GB PostgreSQL 18.6 database (a 202 MB compressed dump that takes 25 s);
- 42 MB of uploaded documents;
- two users, both on `@powerm.ma`.

np-core can absorb it with **no new node**, at about **$7–8 a month** in added storage.

The risk is not size. Five things decide whether the move is safe:

1. **Google OAuth.** Keep the **same OAuth client** and carry `TOKEN_ENCRYPTION_KEY` over byte for
   byte, and the move costs zero re-consent.
   - Register `work.olympusx.ai` days ahead, next to the old redirect URI.
   - Nobody has recorded the client's user type, publishing status or verification state. That
     inventory (step 4.0) is the first thing to do, because it decides whether renaming the consent
     screen triggers brand re-verification:
     - **Internal:** never.
     - **External and verified:** minutes, or 2–3 business days if reviewed manually.
     - **External and Testing:** grants expire every 7 days and sync stops without a log.
   - `gmail.modify` is a restricted scope. Never put this app on the External + CASA path unless it
     has to serve people outside `@powerm.ma`.
2. **Duplicate side effects.** Five `node-cron` jobs run inside the web process.
   - The scheduled-send job **sends every due email twice** if two processes ever run: two replicas,
     a rolling update, Railway and OKE both alive, or even a restart in the middle of a send.
   - The fix is code, and it ships **before** the move: an atomic claim, a graceful shutdown that
     waits for jobs, and a `RUN_SCHEDULERS` switch.
   - The operating rule: run 1 replica with `strategy: Recreate`, and stop Railway before the final
     dump.
3. **The database restores like-for-like.** Use Support Hub's mirrored image
   `support-hub/cnpg-postgresql:18@sha256:2cd40a74…`. It is checked: PostgreSQL **18.6**,
   `en_US.utf8`, barman-cloud, `pg_trgm`, `unaccent`.
   - Initialise the cluster with locale **`en_US.utf8`**. CNPG's default `C` changes sort order, and
     silently changes the generated mail-search columns.
   - The operator, 1.25.4, is past end of life and does not officially support PostgreSQL 18 or
     Kubernetes 1.36. Support Hub already runs that combination; decide it explicitly (D9).
4. **Backups do not exist on the cluster yet.** No CNPG cluster has one, Support Hub's included.
   MailViz would be the first, so your Customer Secret Key and one verified backup are cutover gates.
5. **CI.** `wlargou/mailviz` is **public**. The runner plan forbids self-hosted runners for public
   repositories (`hosting/docs/ci-runners-plan.md:319-323`). Moving CI to `oke-ci` therefore starts
   with making the repository private (D4). Production does not depend on CI moving.

**Recommended shape:**
- Namespace `productivity-hub`.
- One app Deployment (1 replica, Recreate, init-container migrations).
- CNPG `productivity-hub-db` with 2 instances (PG 18.6, `en_US.utf8`, backups to
  `olympusx-cnpg-backups/productivity-hub`).
- A 50 Gi PVC for documents.
- One listener `productivity-hub` on the shared Gateway, added **inside**
  `hosting/k8s/olympusxai/10-gateway.yaml` before Support Hub's block.

The host change is decoupled from the data change:
- `work.olympusx.ai` is new, so its DNS, certificate and Google redirect URI are created and tested
  **days before** cutover.
- Cutover day is a ~30-minute freeze of the data only: dump, copy, restore, verify, start.
- `mailviz.rkube.io` then becomes a Cloudflare 301 to the new host.
- Rollback is switching the 301 off and starting Railway again.

---

## 1. Current state inventory (evidence)

### 1.1 Railway

| Item | Value | Evidence |
|---|---|---|
| Project / workspace | `mailviz` / "Largou Walid's Projects", one environment `production`, **no preview environments** | `railway status --json` |
| App service | `invigorating-recreation`, from GitHub `wlargou/mailviz`, branch `main`, builder **Nixpacks** (`/nixpacks.toml`), config `/railway.json`, plan **pro**, runtime V2 | `railway status --json`; `railway.json:1-13`; `nixpacks.toml:1-26` |
| Start command | `cd server && npx prisma migrate deploy && node dist/index.js`, so migrations run on every boot | `railway.json:7` |
| Healthcheck | `GET /api/health`, timeout 30 s; restart `ON_FAILURE`, 5 retries | `railway.json:8-9`; status JSON |
| Replicas / region | 1 replica, region **asia-southeast1** (Singapore) for both services | status JSON (`multiRegionConfig`) |
| Volume (app) | `invigorating-recreation-volume` at `/data`, 50 GB provisioned, ~0.84 GB used; documents in `/data/rfp` (42 MB) | status JSON; `railway ssh du -sh /data/rfp` |
| Postgres | image `ghcr.io/railwayapp-templates/postgres-ssl:18`, **PostgreSQL 18.6** (Debian, glibc), volume 10 GB with 2.5 GB used, database **1147 MB**, UTF8, collate/ctype **en_US.utf8**, extensions `pg_trgm 1.6` and `unaccent 1.1`, schema `public`, the app connects as superuser `postgres`, 64 Prisma migrations (last `20261017100000_client_references`) | read-only SQL in the container |
| Data | `emails` 1006 MB (~140k rows), `email_attachments` 104 MB, `calendar_events`, `contacts`, …; 2 users, both `@powerm.ma`; 2 `google_auth` rows; 0 pending scheduled emails at the time of the check | read-only SQL |
| Dump | `pg_dump -Fc` = **202 MB in 25 s**, inside Railway's Postgres container (pg_dump 18.6) | measured 2026-10-17 |
| Custom domain | `mailviz.rkube.io` → port 3002 on Railway, behind a **Cloudflare-proxied** record (104.21.6.56 / 172.67.154.246, TTL 300); `rkube.io` NS is Cloudflare; no CAA on rkube.io or olympusx.ai | status JSON; `dig` |
| Public DB proxy | `<name>.proxy.rlwy.net:<port>` **now resolves and accepts TCP from this Mac**. An earlier memory note saying it did not is stale. | `dig`, `nc` on 2026-10-17 |
| App container | ~373 MB memory in use, 587 MB peak; ~1% of a core; PID 1 is `node` | `railway ssh` (`/sys/fs/cgroup`, `ps`) |
| Crons | none at Railway level; all timers are in-process (1.2) | status JSON |
| Backups, logs | **Not visible through the CLI.** Whether Railway backs up the Postgres volume, and the log retention, are UNVERIFIED (Railway dashboard). | — |
| Bill | not recorded anywhere; probably the $20/month Pro minimum (UNVERIFIED) | Railway pricing pages |

Railway sets **names only**. Variables on the app service:
`ALLOWED_EMAILS` (one entry, `@powerm.ma`), `CLIENT_URL` (`https://mailviz.rkube.io`), `DATABASE_URL`*,
`EMAIL_SYNC_ENABLED`, `GOOGLE_CLIENT_ID`*, `GOOGLE_CLIENT_SECRET`*, `GOOGLE_REDIRECT_URI`
(`https://mailviz.rkube.io/api/v1/auth/google/callback`), `JWT_REFRESH_SECRET`*, `JWT_SECRET`*,
`NIXPACKS_NODE_VERSION`, `NODE_ENV` (`production`), `PORT` (`3002`), `RFP_STORAGE_DIR` (`/data/rfp`),
`SYNC_INTERVAL_SECONDS` (`60`), `TOKEN_ENCRYPTION_KEY`* (set, **64 characters**), plus Railway's own
`RAILWAY_*`. Starred values are secret; only their presence and length were read. `DATABASE_URL`
points at `*.railway.internal` and must not be copied. The Google client id's prefix gives GCP
project number **83768907344**.

### 1.2 Processes and timers (all in one Node process)

| What | Schedule | Flag to turn it off | Twice = ? | Evidence |
|---|---|---|---|---|
| HTTP API and SPA (static `client/dist` when `NODE_ENV=production`) | — | — | fine | `server/src/app.ts:166-175` |
| WebSocket `/ws` (`ws` 8.21, attached to the HTTP server, auth **after** the 101, **no ping**, **no Origin check**) | — | — | events reach only the emitting pod's sockets | `server/src/websocket.ts:13-35,56-92,107-133` |
| Email sync (Gmail `history.list`, drafts) | `SYNC_INTERVAL_SECONDS` = 60 → cron `*/1 * * * *`, first run at +5 s | `EMAIL_SYNC_ENABLED` | history-cursor race; per-account guard is per process | `server/src/jobs/emailSyncScheduler.ts:84-92`; `server/src/jobs/perUserRunner.ts:51-66` |
| Calendar sync (+ pending pushes first) | 120 s → `*/2`, first run at +10 s | `CALENDAR_SYNC_ENABLED` | concurrent full syncs delete each other's rows; a pending row with no Google id is pushed as a **create**, so events are duplicated | `server/src/jobs/calendarSyncScheduler.ts:25-31,72-80,106-126`; `server/src/jobs/calendarPendingPush.ts:52-70` |
| **Scheduled send** | `*/30 * * * * *`, wall-clock aligned | **none** | **every due email sent twice**: `findMany` pending → Gmail send → mark `sent`, no claim | `server/src/jobs/scheduledSendScheduler.ts:5-24`; `server/src/services/emailService.ts:1909-1961` |
| Snooze / follow-up | `*/30 * * * * *`, first run at +15 s | none | duplicate Gmail label restore (idempotent) | `server/src/jobs/snoozeScheduler.ts:45-52`; `server/src/services/snoozeService.ts:414-487` |
| Notifications (overdue, due soon, events, deals) | `*/5 * * * *`, first run at +10 s | none | duplicate notifications (no unique constraint) | `server/src/jobs/notificationScheduler.ts:193-200`; `server/src/services/notificationService.ts:60-85` |
| Login-triggered sync, `POST /emails/sync`, `POST /calendar/sync` (synchronous, inside the request) | on demand | — | overlaps a scheduled tick on another process | `server/src/controllers/authController.ts:185-191`; `server/src/controllers/emailController.ts:76-90` |

All five schedulers start unconditionally in `app.listen`'s callback (`server/src/index.ts:15-23`).
SIGTERM handling stops the crons, then calls `process.exit(0)` straight after `prisma.$disconnect()`.
It **waits for neither in-flight requests nor a running tick** (`server/src/index.ts:28-62`). A send
that Gmail has accepted but not yet marked `sent` therefore goes out again after the restart. That
can already happen on Railway at each deploy.

### 1.3 Build and runtime

- **Build:** Nixpacks installs nodejs 22, npm 10 and openssl, runs `npm ci --include=dev`, builds
  the client with Vite, then runs `prisma generate` and esbuild (`bundle:false`, ESM, node22). One
  origin serves the API, the SPA and `/ws` (`nixpacks.toml:1-26`; `server/esbuild.config.js:5-44`;
  `server/src/app.ts:166-175`).
- **Images:** there is **no Dockerfile** and no `.dockerignore`. `.nvmrc` = `22.19.0`, which is
  Railway's Node (`.nvmrc:1`; `package.json:18-21`).
- **Migrations at start** need:
  - the `prisma` CLI, a devDependency (lockfile `devOptional`);
  - `server/prisma.config.ts`, which calls `env('DATABASE_URL')` and **throws when the variable is
    unset**, even for `prisma generate`;
  - the schema and 64 migrations;
  - a schema-engine binary for the build platform.

  Migrations take Postgres advisory lock 72707369 (`server/prisma.config.ts:1-26`;
  `server/package.json:56`).
- **Dependency trap:** the server imports `cookie-parser`, `express-rate-limit` and `jsonwebtoken`,
  but they are declared only in the **root** `package.json` (`package.json:32-36`;
  `server/src/app.ts:5-6`; `server/src/utils/jwt.ts:1`).
- **`NODE_ENV=production` carries a lot.** It gates SPA serving, `Secure` cookies, the CSP, and the
  boot check that refuses missing secrets (`server/src/app.ts:166-173`;
  `server/src/utils/cookies.ts:5`; `server/src/config/env.ts:79-98`). Nixpacks sets it implicitly;
  an image must set it explicitly.
- **`CLIENT_URL` and `GOOGLE_REDIRECT_URI` fall back to localhost** when unset. Nothing asserts
  them (`server/src/config/env.ts:14,18,84-97`).
- **`/api/health`** returns a static 200 and never touches the database (`server/src/app.ts:116-119`).
- **Trusted proxies:** `TRUSTED_PROXIES` = loopback, linklocal, **uniquelocal** (all of 10/8),
  Railway's 100.64/10 and Cloudflare's ranges (`server/src/config/trustedProxies.ts:42-63`).

### 1.4 Environment variables (names only)

- **Secret:** `DATABASE_URL`, `GOOGLE_CLIENT_SECRET`, `JWT_SECRET`, `JWT_REFRESH_SECRET`,
  `TOKEN_ENCRYPTION_KEY`, and optionally `LOGO_DEV_TOKEN` (a publishable default is committed).
- **Config:** `NODE_ENV`, `PORT`, `CLIENT_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_REDIRECT_URI`,
  `ALLOWED_EMAILS` (security-critical: empty means anyone with a Google account), `RFP_STORAGE_DIR`,
  `EMAIL_SYNC_ENABLED`, `CALENDAR_SYNC_ENABLED`, `SYNC_INTERVAL_SECONDS`,
  `CALENDAR_SYNC_INTERVAL_SECONDS`, `EMAIL_SYNC_MONTHS`, `SYNC_MAX_CONCURRENT_ACCOUNTS`,
  `SYNC_CATCHUP_DAYS`, `CALENDAR_SYNC_PAST_MONTHS`, `CALENDAR_SYNC_FUTURE_MONTHS`, and
  `GMAIL_MAX_CONCURRENT`, `GMAIL_MIN_TIME_MS`, `GMAIL_MAX_RETRIES`, `GMAIL_RETRY_BASE_MS`,
  `GMAIL_RETRY_MAX_MS` (`server/src/config/env.ts:11-59`).
- **Add on OKE:** `CHECKPOINT_DISABLE=1` (Prisma telemetry), `IBM_TELEMETRY_DISABLED=true` (Carbon's
  postinstall, at build), `TZ=UTC`.

### 1.5 Google integration

- **Scopes**, requested together for both login and connect: `gmail.modify` (**restricted**),
  `calendar` (**sensitive**), `userinfo.email`, `userinfo.profile`
  (`server/src/services/googleAuthService.ts:12-17,81-86`).
- **One server-side web client** built from `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and
  `GOOGLE_REDIRECT_URI`. No browser SDK and no JavaScript origin is used
  (`server/src/services/googleAuthService.ts:19-25`; `client/src/api/auth.ts:39,49`).
- **Prompts:** `access_type=offline`. Login uses `prompt=select_account`; connect or a missing row
  uses `prompt=consent` (`server/src/services/googleAuthService.ts:69-86`). With the same client,
  users see no consent and get no new refresh token: the stored one is reused.
- **Tokens:** stored AES-256-GCM, `iv:tag:ciphertext`, keyed by `TOKEN_ENCRYPTION_KEY` (hex,
  32 bytes) (`server/src/utils/encryption.ts:4-55`).
  - A **different key** makes every decrypt throw. It is logged every 60/120 s.
  - Signing in again does **not** repair it, because `select_account` returns no refresh token.
  - Recovery without data loss: a signed-in user follows `GET /api/v1/auth/google/url` (forced
    consent). The UI hides that button unless `needsReauth` is true
    (`server/src/routes/auth.ts:20`; `client/src/components/settings/SettingsPage.tsx:703-711`).
- **A dead grant (`invalid_grant`, HTTP 400) is skipped silently** by both schedulers, and Settings
  still says "Connected" (`server/src/jobs/emailSyncScheduler.ts:44-46`;
  `server/src/jobs/calendarSyncScheduler.ts:46-47`;
  `server/src/services/googleAuthService.ts:147,221-223`).
- **Polling only.** No Gmail `users.watch`, no Pub/Sub, no Calendar `events.watch` or channels, so
  there is nothing to re-register (`server/src/services/emailService.ts:171,428`;
  `server/src/services/calendarService.ts:434,494`; `BACKLOG.md:59-63`).
- **Login state** is the constant `login`: no nonce, no PKCE (`server/src/services/googleAuthService.ts:76-79`).
- **Unknown, and needs the Console** (no file, commit or memory records them): which organisation
  owns project 83768907344, the **user type** (Internal or External), the **publishing status**
  (Testing or In production), the **verification status**, the branding, authorized domains, and the
  exact redirect URIs. `powerm.ma` is Google Workspace (MX `aspmx.l.google.com`). `olympusx.ai` is
  **not** Workspace (Cloudflare Email Routing) and already carries one `google-site-verification`
  TXT record, owner unknown.

### 1.6 CI today

`.github/workflows/ci.yml` runs on `ubuntu-latest`:
- `version-bump`: PR-only, about 6 s.
- `verify`: a `postgres:16-alpine` service, npm ci, generate, migrate, typecheck, test, build, and a
  non-blocking `npm audit`.

Green runs take 11–16 min, with one green outlier at 41 min (run 35711013336). There are no
timeouts, no concurrency group and no `permissions` block, and actions are pinned by tag. CI tests
PG **16 on Alpine (musl, no libc locales)** while production is PG **18 on glibc `en_US.utf8`**. The
repository is **public** (GitHub API, 2026-10-17).

---

## 2. Target platform, as measured on 2026-10-17

| Item | Live / recorded value |
|---|---|
| Cluster | OKE `olympusx`, Kubernetes v1.36.4, private API, `scripts/oke` Bastion tunnel (3 h sessions) |
| np-core | 3 × `VM.Standard.E6.Flex` 2 OCPU / 24 GB, amd64, one per AD; allocatable **3815m CPU, 19.98 GiB**, ~29 own-IP pods each |
| np-lab | **up today**: 10.20.1.114, 4 OCPU / 32 GB, tainted `olympusx.ai/lab` (olympus-lab, ollama-lab). It is not for production. |
| Requests on np-core (live) | 1925m / 1970m / 2150m CPU (50–56%), 8.6 / 8.9 / 9.1 GiB (42–45%) per node; owner caps are 70% CPU, 65% memory and 27 own-IP pods per node (`sh-kit` DEPLOY_OKE.md:126-129) |
| Actual use (live `top`) | 52–180m CPU (1–4%), 8.3–9.0 GiB (40–44%) per node |
| Gateway | ONE Gateway `olympus/olympus` (class `olympus`, Envoy Gateway **v1.9.2**, Envoy 1.39.1), 13 HTTPS listeners. Support Hub's 3 listeners use a namespace `Selector`. NLB 141.147.1.80, `is-preserve-source: "false"`. |
| Certificates | ClusterIssuer `letsencrypt` (HTTP-01 through the `http` listener only). App Certificates live in namespace `olympus`, named exactly like their Secret. |
| CNPG | operator **1.25.4**. Clusters: `olympus-db` (PG 16.6, 3 instances), langfuse DBs, `support-hub-db` (**PG 18.6** mirrored image, 2 instances, 50 Gi `oci-bv`, locale **C**). **No cluster has a backup**, and there is no ScheduledBackup. |
| Storage | `oci-bv` (default, Balanced, `WaitForFirstConsumer`, expandable, **50 GB minimum**, pinned to an AD) |
| Envoy policies | none exist; `BackendTrafficPolicy.spec.timeout.http` has `streamIdleTimeout`, `requestTimeout`, `maxStreamDuration` and `connectionIdleTimeout` in v1.9.2 (`kubectl explain`) |
| Admission | Only OKE's own VAPs plus the Gateway API `safe-upgrades`. **No policy on production enforces secrets-as-volumes**; the stated rule is a convention, not enforced. Pod Security `restricted` is set through namespace labels. |
| Network | Calico 3.32 policy-only. Support Hub: default-deny **ingress**, ingress only from `envoy-gateway-system`, egress open except instance metadata (`deny-instance-metadata`). Below Calico, the VCN NSG lets pods reach the internet on **443 only** (plus Oracle Services, and 80 to the ingress IP) (`hosting/infra/olympusxai/nsg.tf:191-200`). |
| Registry | OCIR `fra.ocir.io/axfyua9kygyj/<app>/<repo>`; repositories must exist in Terraform `var.ocir_repositories` first (`hosting/infra/olympusxai/registry.tf:1-15`). Nodes pull with their instance principal; no pull secrets. |
| Release | `hosting/scripts/release.sh`: builds linux/amd64 on the Mac, tags `YYYY.MM.DD-<sha7>`, pushes, reads the digest back, rewrites the single `image: …@sha256:` line plus its `# tag` comment. Then commit and `scripts/oke kubectl apply`. GitHub never holds a registry token. |
| Backups bucket | `olympusx-cnpg-backups` (private, versioned, `prevent_destroy`); S3-compatible endpoint `https://axfyua9kygyj.compat.objectstorage.eu-frankfurt-1.oci.customer-oci.com`; the home region is eu-marseille-1, so `s3Credentials.region` must say eu-frankfurt-1 (`hosting/infra/olympusxai/storage.tf:6-26`) |
| Mail out | OCI Email Delivery exists, but **MailViz does not need it**: it sends through the Gmail API (`server/src/utils/mimeBuilder.ts:1-3`, no SMTP transport) |

**Precedent.** Support Hub's move on 2026-10-14 was a **fresh install with no data**: its practice
database was dropped on purpose (`sh-kit` DEPLOY_OKE.md:1364-1477). MailViz is the first live-data
migration onto this cluster.

---

## 3. Gaps against the platform conventions

| Convention | MailViz today | Gap | Fix (phase) |
|---|---|---|---|
| linux/amd64 multi-stage image, non-root, digest-pinned | Nixpacks on Railway, no Dockerfile | no image | Dockerfile + `.dockerignore`, UID 10001 (0) |
| No dev dependencies at runtime | `npm ci --include=dev`; prisma CLI is a devDependency | runtime carries everything | runtime stage with prod deps only; prisma CLI in the migrator only (0) |
| Migrations as a Job or init container | `migrate deploy` in the start command | — | init container from the same image, `node …/prisma/build/index.js migrate deploy` (1) |
| Things that must not run twice | 5 crons in the web process, no claim, no flag | double sends | atomic claim, `RUN_SCHEDULERS`, graceful drain; 1 replica, Recreate (0, 1) |
| Secrets mounted as volumes | read from `process.env` | convention not met (also not enforced on production) | `*_FILE` loader in `env.ts`, Secret mounted at `/var/run/secrets/productivity-hub` (0, 1) — D16 |
| `runAsUser`, restricted PSS, requests on everything, PDB where it matters | n/a | — | manifests (1) |
| Ingress only from Envoy, egress explicit | n/a | Calico cannot match `*.googleapis.com` | default-deny both ways; DNS, CNPG 5432, and 443 to `0.0.0.0/0` except 10/8 and 169.254/16 (1) |
| One listener per app inside the shared Gateway file | n/a | must be merged, never applied alone | listener + Certificate PR to hosting, applied by you (1) |
| CNPG with backups | Railway Postgres; backups UNVERIFIED | no backups anywhere on OKE | Customer Secret Key, `barmanObjectStore`, ScheduledBackup, a restore test (1) |
| Locale | `en_US.utf8` | CNPG default `C` | `initdb.localeCollate/localeCType: en_US.utf8` (1) |
| Long requests and WebSockets through Envoy | Cloudflare proxy today | Envoy's 15 s route default; 5 min stream idle | HTTPRoute `timeouts.request: 3600s`, `/ws` rule `0s` + BackendTrafficPolicy `streamIdleTimeout: 3600s`; WS ping every 25 s (0, 1) |
| Client IP behind the NLB | trusts all of 10/8 | the login limiter becomes forgeable or a single global bucket | `TRUSTED_PROXIES` from env = Envoy only; accept a global bucket and raise the limit (0) — D14 |
| CI on oke-ci | hosted; repo public | forbidden for public repos | D4 (2) |
| Releases local to OCIR | Railway builds on push | new manual step | `release.sh` target (1) |
| Monitoring | Railway dashboard | no metrics or alerting on the cluster | data-based checks; sync-failure visibility in code (0); alerting later |

---

## 4. Risks, ranked, Google first

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| **G1** | **Losing Google access at cutover**: a different `TOKEN_ENCRYPTION_KEY`, a new OAuth client, the new redirect URI not registered, or `CLIENT_URL`/`GOOGLE_REDIRECT_URI` on localhost defaults | medium / **high** (both users' sync stops; re-login does not fix a wrong key) | Same client id and secret. Key copied byte for byte and escrowed. Redirect URI added ≥ 24 h ahead and tested at Google's authorize step. Boot asserts `CLIENT_URL` and `GOOGLE_REDIRECT_URI` (code). A pre-flight `decrypt` of each `google_auth` row before users sign in (runbook T0+20). |
| **G2** | **Unknown Console state.** If **External + Testing**, grants expire every 7 days and sync dies without a log. If **External + verified**, renaming triggers brand re-verification (minutes, or 2–3 business days manual); the live screen keeps working, but the new name and logo stay hidden until approved. | unknown / high | Step 4.0 inventory first (read-only). Publish if Testing (≥ 1 week before cutover). Do branding and redirect changes together ≥ 10 days before cutover. |
| **G3** | **Restricted scope and audience.** An External app In production that reads Gmail on a server needs restricted-scope verification **and** a yearly CASA assessment (weeks; third-party cost ≈ $540–6,000 a year) **if** it ever serves people outside its own organisation | low today / high | D2: keep it Internal to the `powerm.ma` organisation (no verification at all), or External + unverified under the personal-use exemption and Workspace-admin **Trusted**. Never in Testing. CASA only if the product must serve other organisations. |
| G4 | **Moving to Internal** is one-way if the project must be moved into the `powerm.ma` organisation (`projectIamAdmin` + `projectCreator`; reversal needs Google support). Whether grants survive an External → Internal switch is undocumented. | low / medium | Separate later window, never on cutover day. Plan one forced-consent sign-in per user. Ask both users whether any non-`powerm.ma` Google account is linked (it would stop working). |
| G5 | **Silent sync failure** (`invalid_grant` swallowed; Settings shows Connected) | medium / medium | Code: record auth errors, show Reconnect, log once per change. Verify cutover by `google_auth.last_mail_sync_at` / `last_sync_at`, not by logs. |
| R1 | **Duplicate sends and side effects**: two processes on the same data (Railway + OKE, rollout overlap, eviction, a restart mid-send, staging on a real copy) | **high** / high (emails sent twice to customers) | Code before the move: atomic `pending → sending` claim plus a stuck-row sweep; drain jobs on SIGTERM; `RUN_SCHEDULERS`. Ops: Railway app **stopped** before the final dump; 1 replica, Recreate; staging on a **scrubbed** copy with schedulers off. |
| R2 | **Restore mismatch**: locale `C`; objects owned by `postgres`, so later migrations fail; `COMMENT ON EXTENSION` errors; generated columns recomputed | medium / medium | `initdb` en_US.utf8 + owner `productivity_hub`; extensions in `postInitApplicationSQL`; `pg_restore --no-owner --role=productivity_hub -j 2`; expect and filter the 2 comment errors; validation queries (§6.4); rehearsal. The search functions behind the generated columns name `public.unaccent` and its dictionary explicitly (`migrations/20261015100000_mail_search_text/migration.sql`), so pg_restore's empty `search_path` does not break them. |
| R3 | **No backups on OKE** (first barman setup on this cluster, untested against OCI S3 and its region rule) | high if skipped / high | Gate: Customer Secret Key, a first base backup, WAL archiving, **and a restore test** before cutover. Railway stays as the last copy for 7 days (your answer). RFP PVC: block volume backup policy, or a copy to Object Storage. |
| R4 | CNPG 1.25.4 is EOL; PG 18 and Kubernetes 1.36 are outside its support matrix | medium / medium (platform-wide) | Same combination as Support Hub, tested in staging including a switchover. Operator upgrade to 1.30.x as a separate platform task (D9). |
| P1 | Envoy timeouts: 15 s route default cuts sync, 25 MB uploads, 35 MB sends, downloads; WebSocket idle | high if forgotten / medium | Route timeouts + BackendTrafficPolicy + WS ping; staging checks (> 15 s request, 6 min idle socket). |
| P2 | Client IP: NLB source NAT + `uniquelocal` trust, so the login limiter is forgeable or one global bucket (20 per 15 min, an internet-wide lockout of both users) | high / medium | `TRUSTED_PROXIES` from env (Envoy pod CIDR only); limiter raised for the shared bucket; PROXY protocol is a platform-wide follow-up (D14). |
| P3 | Same-site with `studio`, `api`, `support` and `www` under `olympusx.ai`: SameSite=Lax no longer separates them, and `/ws` has no Origin check | medium / medium | WS auth and Origin check in a `noServer` upgrade handler; reject state-changing `/api` requests whose Origin ≠ `CLIENT_URL`. |
| P4 | RWO document PVC pins the app to one AD; a drain of that node stops the app until it returns | certain on drains / low | Accepted (2 users). Later: documents to Object Storage (D12). |
| P5 | HTTP-01 failure on the new host (a failed order backs off 1 h) | low / medium | DNS, listener and certificate created days ahead, not at cutover. No CAA on olympusx.ai. |
| P6 | Shared Gateway file: appending after Support Hub's block breaks its kit's idempotency check; `cutover/10-gateway.yaml` still says "copy over" | medium / medium | Insert before Support Hub's block. Ask whether the redundant `cutover/` copy can be deleted, or add the listener to both. |
| C1 | Capacity: a node loss puts survivors at ~79% CPU requested (above the 70% cap) and uses the slack kept for tenant vector DBs | low / medium | Accept, or the rightsizing plan's D2 (core nodes to 3 OCPU, +$65.70/month). Re-measure the day before install. |
| C2 | CI: public repo; OKE slots already oversubscribed (12 standard slots promised 6 + 6, plus large pods) | — | D4/D5: private first, re-split `maxRunners`, smoke-test `services:` on DinD. |
| O1 | Tunnel and home link (3 h Bastion TTL; IPv4 drops under load) | medium / low | Only 202 MB crosses the tunnel; restore runs inside the pod; refresh the session before T0. |
| O2 | Secrets not KMS-encrypted in etcd; a namespace delete loses the key | low / high | Escrow `TOKEN_ENCRYPTION_KEY` and the JWT secrets in your password manager before Phase 3. |
| O3 | Tenancy still trial? ("trial tenancies … stop after 30 days", `hosting/docs/olympusxai-tenancy-plan.md:76-78`) | unknown / high | Confirm Pay As You Go before moving production (you). |

---

## 5. Phases

Every step lists its **owner**, an exact **verification** and a **rollback**. Nothing in Phases 0–4
touches Railway production behaviour, except the Phase 0 code, which ships to Railway first through
the normal PR flow, so it is proven in production before the move.

### Phase 0: preparation and rebrand (this repository)

| Step | Owner | What | Verify | Rollback |
|---|---|---|---|---|
| 0.1 | You | Decide D1–D20 (§7) | answers recorded in this file | — |
| 0.2 | You | Escrow `TOKEN_ENCRYPTION_KEY`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `GOOGLE_CLIENT_SECRET` from Railway into your password manager | the four entries exist; lengths 64 / 64 / 64 / 35 match `railway variables` (lengths only) | — |
| 0.3 | You | Railway dashboard: backups on or off, log retention, the actual monthly bill (you declined the Chrome read, so this is yours) | recorded here | — |
| 0.4 | Claude | **PR "safe to run twice"** (each item tested and mutation-checked): (a) atomic claim `updateMany({status:'pending'} → 'sending')`, then the send, then `sent`; a sweep that moves rows stuck in `sending` > 10 min to `failed` (never resent); (b) graceful shutdown: draining flag → stop crons → await in-flight job promises (deadline 30 s) → `server.close` → close WS → disconnect; (c) `RUN_SCHEDULERS` env (default true) gating all five jobs **and** the login-triggered sync; (d) `CLIENT_URL` and `GOOGLE_REDIRECT_URI` asserted in production; (e) `TRUSTED_PROXIES` from env; (f) `server.keepAliveTimeout = 65 s`, `headersTimeout = 66 s` | new tests go red with the fix removed; deploy to Railway; scheduled-send smoke test | revert the PR (no schema change; `sending` fits the existing `VARCHAR(20)`) |
| 0.5 | Claude | **PR "behind a proxy"**: WebSocket `noServer` upgrade with cookie auth and an **Origin check** before the 101; ping every 25 s; the client stops reconnecting on 4001 or 401; Origin check on state-changing `/api` requests; `GET /api/ready` (fails only while draining, so a DB blip does not 503 the SPA); morgan skips probes | tests; on Railway, an idle tab stays connected > 6 min | revert |
| 0.6 | Claude | **PR "visible auth failures"** (recommended before cutover): treat `invalid_grant` / `unauthorized_client` as `authError` on `google_auth` (a migration), `needsReauth = true`, a WS event, log once per change; Settings always offers **Reconnect** (forced consent, keeps the data); store the **granted** scopes from `tokens.scope` | tests; revoke in a test account, then Settings shows Reconnect | revert; the migration is additive |
| 0.7 | Claude | **PR "image"**: multi-stage linux/amd64 `Dockerfile` (`node:22.19.0-bookworm-slim` pinned by digest; dummy `DATABASE_URL` in the build stage only; `IBM_TELEMETRY_DISABLED`, `CHECKPOINT_DISABLE`), runtime as UID 10001 with tini, layout `/app/{VERSION,server/dist,server/generated,client/dist}`; a separate `migrator` target with the prisma CLI, schema, migrations and `prisma.config.ts`; `.dockerignore` (`.env`, `node_modules`, `server/uploads`, `dist`, `.git`, `.claude`, `docs`); `prisma.config.ts` reads `DATABASE_URL_FILE` when `DATABASE_URL` is unset; move `cookie-parser`, `express-rate-limit` and `jsonwebtoken` into `server/package.json`; `*_FILE` loader in `env.ts` if D16 = volume; a CI job builds the image on PRs (no push) | `docker buildx build --platform linux/amd64` passes; `docker run … migrate status` against a scratch PG 18; `/api/health` and `/api/version` answer; image size recorded (~600 MB expected) | revert; Railway keeps building with Nixpacks |
| 0.8 | Claude | **PR "rebrand"** (one PR, client and docs only; VERSION minor bump), checklist in Appendix C: single `PRODUCT_NAME` constant; title, favicon set (from the design system's Logos), theme-color; header lockup (glyph + name); About; login without the canvas, orbit logo and purple, motion only under `prefers-reduced-motion: no-preference`; onboarding copy and gradient; descriptor **"Your workday in one place"** replacing "Personal CRM & email manager"; wordmark weight **400**; "only here" / "Linked company"; placeholders **left as they are** (D18) except the References helper text naming a company with a country in it, which becomes generic; `_brand.scss` built from `@carbon/colors`, no hex | tests updated, a name test mutation-checked; Chrome walk-through in both themes at full scale | revert |
| 0.9 | You | Merge 0.4–0.8; Railway deploys each | `/api/version` shows each bump; a scheduled send is delivered once | Railway redeploys the previous commit |

The rebrand can ship on Railway (old host) **before** the move. Users then see the new name under the
old address. The localStorage key renames (`mailviz-theme` and the like) wait for the host move,
where the origin changes anyway, so they cost nothing extra there.

### Phase 1: image and manifests (in `olympusx-hosting`, Support Hub's conventions)

| Step | Owner | What | Verify | Rollback |
|---|---|---|---|---|
| 1.1 | Claude → You | Terraform PR: add `productivity-hub/app` and `productivity-hub/migrator` to `var.ocir_repositories` (the DB image reuses `support-hub/cnpg-postgresql:18@sha256:2cd40a74…`, or is mirrored as `productivity-hub/cnpg-postgresql` with the same digest, D9); you run plan/apply | `oci artifacts container repository list` shows them in compartment `olympusx` | `terraform apply` of the revert (empty repositories) |
| 1.2 | Claude → You | **Images (D6 = hosted GHCR + mirror, Support Hub's pattern):** a `build.yml` workflow in mailviz on a GitHub-hosted runner (never on `oke-ci`) builds both targets for linux/amd64 and pushes `ghcr.io/wlargou/mailviz/{app,migrator}` on `main` and on tags only (any other ref is a dry run that builds and pushes nothing), with `packages: write` on that job alone; then a mirror script in olympusx-hosting, run from the Mac, pulls the amd64 digest, pushes it to `fra.ocir.io/axfyua9kygyj/productivity-hub/{app,migrator}`, reads the digest back and pins both `@sha256:` lines plus tag comments in `k8s/olympusxai/50-productivity-hub.yaml` (modelled on Support Hub's `deploy/oke/mirror-to-ocir.sh`). GHCR packages stay private once the repo is private (D4); the mirror authenticates with your `gh` token, read-only. | a branch run of `build.yml` builds and pushes nothing; on `main` both images appear in GHCR; the mirror's `--check` is read-only; the manifest gets two `@sha256:` lines whose digests equal OCIR's | revert the workflow and script; delete the GHCR packages |
| 1.3 | Claude | `k8s/olympusxai/50-productivity-hub.yaml` (sketch in Appendix A): Namespace (restricted PSS, part-of) · ResourceQuota (1200m / 6Gi requests, 8Gi limits, 4 PVCs, 200Gi, LB 0, NodePort 0) · LimitRange · ServiceAccount (no token automount) · CNPG Cluster `productivity-hub-db` · PVC `productivity-hub-documents` 50Gi `oci-bv` · Deployment (1 replica, **Recreate**, init `migrate`, probes, `runAsUser` 10001, read-only root, `/tmp` emptyDir, secrets as files) · Service · HTTPRoute (`/ws` timeout 0s; `/` 3600s) · BackendTrafficPolicy (`streamIdleTimeout 3600s` on the route) · NetworkPolicies (default-deny ingress **and** egress; ingress from `envoy-gateway-system` on 3002; egress DNS, CNPG 5432, 443 to the internet minus 10/8 and 169.254/16; the CNPG `allow-to-postgres` pattern; CNPG egress to the API at 10.20.0.0/28:6443 and Oracle Services 443 for barman) | `kubectl apply --dry-run=server` (you, through the tunnel); a render review | delete the file; nothing applied yet |
| 1.4 | Claude → You | **Gateway**: one listener `productivity-hub` (host = the staging name, D19, later `work.olympusx.ai`) inserted **before** Support Hub's block in `10-gateway.yaml`, `allowedRoutes` Selector `kubernetes.io/metadata.name: productivity-hub`; a Certificate `productivity-hub-tls` in namespace `olympus` named like its Secret. You apply the Certificate only after DNS resolves to 141.147.1.80, then the Gateway file. | Certificate Ready; Gateway generation +1 with all 14 listeners Programmed; Support Hub's kit `edit-gateway-file.sh FILE` still reports SAME | your re-apply of the previous `10-gateway.yaml`; delete the Certificate |
| 1.5 | You | Secrets, from hidden prompts (never on a command line): `productivity-hub-env` (Google client id and secret, JWT pair, **`TOKEN_ENCRYPTION_KEY` identical to Railway**, `ALLOWED_EMAILS=@powerm.ma`); `productivity-hub-backup-s3` (`ACCESS_KEY_ID`, `ACCESS_SECRET_KEY`, `REGION=eu-frankfurt-1`) from a **Customer Secret Key** you create for a human IAM user with write on `olympusx-cnpg-backups`. `DATABASE_URL` is never pasted: it comes from CNPG's `productivity-hub-db-app` Secret. | `kubectl get secret … -o json \| jq '.data \| map_values(length)'`, lengths only | delete the Secrets; revoke the Customer Secret Key |
| 1.6 | Claude | Backups in the Cluster spec: `barmanObjectStore` to `s3://olympusx-cnpg-backups/productivity-hub`, gzip, `retentionPolicy 30d`, ScheduledBackup `0 30 2 * * *` (`immediate: true`); a runbook entry in `hosting/k8s/olympusxai/README.md` | Phase 3: a base backup and WAL files appear in the bucket; a recovery into a scratch Cluster succeeds | remove the `backup` stanza |

### Phase 2: CI on OKE

The decision comes first (D4). As long as `wlargou/mailviz` is public, the platform rule keeps CI on
GitHub-hosted runners. That costs nothing ($0, 4 vCPU / 16 GB runners) and nothing in production
depends on it.

| Step | Owner | What | Verify | Rollback |
|---|---|---|---|---|
| 2.1 | Claude | Hosted-runner hardening PR (applies whatever D4 decides): `permissions: contents: read`, a concurrency group, `timeout-minutes` (5 and 60), actions pinned by SHA plus `dependabot.yml` for actions, Postgres service **`postgres:18`** (Debian, matching production's major version and glibc locales) with `pg_isready -h 127.0.0.1`, `IBM_TELEMETRY_DISABLED=true`, a **migrations-as-owner** job (non-superuser owner, as CNPG will have), the Docker build job from 0.7 | green run; the owner job fails if a migration needs superuser (mutation: an `ALTER SYSTEM` in a test migration goes red) | revert |
| 2.2 | You | **If D4 = private**: make the repo private; add `wlargou/mailviz` to the `wlargou-oke-ci` App installation (D5; the App gets Administration read/write on it, like support-hub) | `gh api repos/wlargou/mailviz --jq .visibility` = private; the installation lists 3 repos | remove from the installation; make public again only after removal (`ci-runners-plan.md:323`) |
| 2.3 | Claude → You | `hosting/k8s-ci/arc/values-mailviz.yaml` (`runnerScaleSetName: oke-ci-mailviz`, `scaleSetLabels: [oke-ci]`, `maxRunners: 2`), re-split `maxRunners` (for example olympus 5, support-hub 5, mailviz 2) to stay within `--max-nodes-total=4`; you run the helm install through `scripts/oke-ci` | the scale set lists in ARC; a smoke workflow with `services: postgres` comes up on DinD and answers on `localhost:5432` (never tested on this cluster) | `helm uninstall oke-ci-mailviz`; restore the old `maxRunners` |
| 2.4 | Claude | `verify` uses `runs-on: ${{ fromJSON(vars.CI_RUNS_ON \|\| '["oke-ci"]') }}`; `version-bump` stays on `ubuntu-latest` (6 s against a 3–11 min cold start); fall back to support-hub's `docker run -p 0:5432` if `services:` fails | 5 consecutive green runs on oke-ci; median time recorded against hosted | `gh variable set CI_RUNS_ON --body '["ubuntu-latest"]'` (no commit) |

Image publishing never runs on `oke-ci`: D6 chose a GitHub-hosted job pushing to GHCR, then a mirror to
OCIR from the Mac (Support Hub's pattern, step 1.2). Since the repo goes private (D4), those hosted
minutes count against your plan; the job runs on `main` and tags only.

### Phase 3: staging on OKE under a temporary name

The staging name is D19. It is recommended to use **`work.olympusx.ai` itself before launch**: it has
no users yet, its DNS, certificate and Google redirect URI are needed anyway, and cutover day then
changes no DNS for it. The alternatives are a separate `work-staging.olympusx.ai`, or
`work.141-147-1-80.sslip.io` with no Google sign-in.

| Step | Owner | What | Verify | Rollback |
|---|---|---|---|---|
| 3.1 | You | DNS: `work.olympusx.ai A 141.147.1.80`, **DNS only (grey)**, TTL **300** | `dig +short work.olympusx.ai @1.1.1.1` and `@8.8.8.8` both return 141.147.1.80 | delete the record |
| 3.2 | You | Phase 4 steps 4.1–4.3 (authorized domain + redirect URI), so staging sign-in works | Google's authorize URL with the new `redirect_uri` shows the account chooser, not `redirect_uri_mismatch` | remove the URI |
| 3.3 | You | Apply: namespace file, Secrets, then the Certificate; once Ready, the Gateway file; then the app manifest with `RUN_SCHEDULERS=false` | CNPG `2/2 Ready`; Certificate Ready; listener Programmed; `https://work.olympusx.ai/api/version` = the release | `kubectl delete -f 50-productivity-hub.yaml` (PVCs `Delete` reclaim; nothing of value yet); remove the listener; re-apply the Gateway |
| 3.4 | Claude | **Rehearsal with a scrubbed copy**: the full data path of §6.3 with timings; then scrub **in staging only**: `DELETE FROM google_auth`; `UPDATE scheduled_emails SET status='cancelled' WHERE status='pending'`; disarm snoozes; clear calendar pending-push markers | the timings table filled in; §6.4 queries match Railway; then 0 rows in `google_auth` | drop and re-create the database (CNPG) |
| 3.5 | You + Claude | With the scrubbed copy and `RUN_SCHEDULERS=true`: you sign in (a new consent creates a staging-only grant; the same client allows 100 tokens per account), then check mail sync, search ("sauvegarde", an accented word), a > 15 s manual sync, a 20 MB upload, a document preview and download, the References editor, a WebSocket idle > 6 min, a scheduled send **to yourself**, two quick ⌘S | each item checked; Envoy access log shows the X-Forwarded-For chain; one scheduled email arrives **once**. Staging talks to your real Gmail: anything you click (archive, send) really happens. | — |
| 3.6 | Claude | Backup drill: wait for the ScheduledBackup; recover into a throwaway Cluster `productivity-hub-db-restoretest`; compare row counts; delete it | barman lists the base backup and WAL; the recovered counts equal staging's | delete the test Cluster |
| 3.7 | Claude | Failure drills: `kubectl rollout restart` (Recreate, no overlap); delete the app pod during a scheduled send (claim holds, no duplicate); CNPG switchover (`kubectl cnpg promote` / primary drain) | the app reconnects; no duplicate send; recovery time measured | — |
| 3.8 | You | After the drills, revoke the staging grant (myaccount.google.com → connections → only if it shows a separate entry; the same client usually shows one entry, in which case skip) and decide go/no-go for Phase 5 | — | — |

### Phase 4: Google Cloud changes (all yours; Claude prepares the exact values)

| Step | When | What | Verify | Rollback |
|---|---|---|---|---|
| 4.0 | now | **Read-only inventory**: owning organisation (IAM & Admin → Settings); Audience (user type, publishing status, test users); Branding (name, logo, home, privacy, terms, authorized domains, verified or published?); Data access (declared scopes); Verification Center; Clients (exact redirect URIs and origins; is the same client used for localhost dev?); powerm.ma Admin console → API controls (is the client Trusted / Limited / unconfigured?) | answers pasted into §1.5 | — |
| 4.1 | ≥ T-10 d | If **Testing**: publish (In production). Each user then does one forced-consent connect (Settings → Reconnect after 0.6, or `GET /api/v1/auth/google/url`). | `google_auth.last_mail_sync_at` keeps advancing beyond 7 days | unpublish (not advised) |
| 4.2 | ≥ T-10 d | Authorized domains: **add `olympusx.ai`, keep `rkube.io`**. If External + verified: verify `olympusx.ai` in Search Console (Domain property, DNS TXT in Cloudflare, record kept permanently) with an account that is Owner or Editor on the project, then Verify branding / Publish branding within 7 days. | Branding shows `olympusx.ai` verified; no pending review | remove the domain |
| 4.3 | ≥ T-7 d | Client → Authorized redirect URIs: **add** `https://work.olympusx.ai/api/v1/auth/google/callback` (exact, no trailing slash), **keep** `https://mailviz.rkube.io/api/v1/auth/google/callback`. No JavaScript origin needed. | the authorize URL with the new `redirect_uri` reaches the account chooser (propagation takes 5 min to a few hours) | remove the URI |
| 4.4 | ≥ T-10 d, or after cutover (D3) | Branding: app name **Olympusx Productivity Hub**, logo from the design system's Logos, home page and privacy policy on `olympusx.ai` (both pages to be written: the site has none today). External + verified means brand review (minutes, or 2–3 business days). Internal means no review. | the consent screen shows the new name (or Draft pending) | restore the previous name and logo |
| 4.5 | optional, any time | powerm.ma Admin console (Service Settings admin): API controls → configure the OAuth client id → **Trusted** | Admin console lists it as Trusted | set it back |
| 4.6 | separate window after cutover (D2) | Internal: if the project is already in the powerm.ma organisation, switch Audience to Internal. Otherwise move the project (one-way) or create a new Internal project (**new client = one consent per user**). | both users sync; Audience = Internal | per-case; see G4 |
| 4.7 | T+7 d | Remove the `mailviz.rkube.io` redirect URI; keep or remove `rkube.io` from authorized domains (removing it is a branding edit, so a review if External + verified) | the old URI is gone | add it back |

The client secret: **reuse the existing one** (escrowed in 0.2). Google now shows secrets only once,
and a client can hold two at a time if a second is ever needed.

### Phase 5: data cutover

This phase is the runbook in §6. Its owners are You (Railway, DNS, Cloudflare) and Claude (dump,
restore, validation, smoke).

### Phase 6: decommissioning Railway

| Step | Owner | When | What | Verify | Rollback |
|---|---|---|---|---|---|
| 6.1 | You | T0 | Railway **app** stopped (remove the active deployment or scale to 0) and its GitHub auto-deploy disconnected, so a merge cannot start it | `curl https://invigorating-recreation-production-df3d.up.railway.app/api/health` fails | redeploy |
| 6.2 | Claude | T0 | Railway **Postgres** kept running, set read-only: `ALTER DATABASE <db> SET default_transaction_read_only = on` (reversible) | a write attempt fails with `cannot execute … in a read-only transaction` | `… = off` |
| 6.3 | You | T+7 d | Final archive: one last `pg_dump -Fc` of Railway (read-only) to Object Storage (private bucket, retention 90 d), with the Railway `/data/rfp` tarball | object listed with its size and sha256 | — |
| 6.4 | You | T+7 d | Delete the Railway project (app service, Postgres, both volumes); cancel Pro if nothing else uses it | Railway dashboard empty; the next invoice is $0 | none: irreversible, hence the archive in 6.3 |
| 6.5 | You | T+30 d | Remove the Cloudflare 301 for `mailviz.rkube.io` and its DNS record | `dig mailviz.rkube.io` returns nothing | re-create |
| 6.6 | Claude | T+7 d | Docs: CLAUDE.md (deploy, running scripts with `kubectl exec` instead of `railway ssh`, host), README, memory notes; `.nvmrc` and `engines.node` re-pinned to the image's Node | PR merged | — |

---

## 6. Cutover runbook (timed)

### 6.1 Before the day

| When | Who | Step | Gate |
|---|---|---|---|
| T-10 d | You | Phase 4 steps 4.0–4.2 (and 4.4 if branding is renamed before cutover) | Console state known; nothing pending review |
| T-7 d | You | 4.3 redirect URI; 3.1 DNS for `work.olympusx.ai` (TTL 300) | the authorize URL accepts the new URI; DNS resolves at 1.1.1.1 and 8.8.8.8 |
| T-7 d … T-2 d | You + Claude | Phase 3 complete: staging green, rehearsal timed, backup drill done, failure drills done | **Go/no-go 1**: every Phase 3 verification ticked; rehearsal freeze ≤ 45 min |
| T-1 d | Claude | Re-measure np-core requests through the tunnel; confirm the release digest; prepare the env file for the dump client (`chmod 600`, never printed); refresh the Bastion session (`OKE_MIN_SESSION_LEFT=7200 scripts/oke up`) | headroom still within the caps |
| T-1 d | You | Tell both users: a 30-minute freeze at T0; afterwards sign in once at `https://work.olympusx.ai` (cookies are per host); the three local UI preferences reset | — |
| T-1 d | Claude | In staging: scale the app to 0, then `DROP` / re-create the database, so the scrubbed copy cannot be mistaken for the real one | the database is empty |

### 6.2 Go/no-go 2 (T-30 min), every item must be yes

- No pending scheduled email due in the next hour on Railway (`SELECT count(*) FROM scheduled_emails
  WHERE status='pending' AND send_at < now() + interval '1 hour'`). If there are any, move the freeze.
- Both `google_auth.last_mail_sync_at` values on Railway are less than 5 min old: sync is healthy
  before the move.
- The Railway dump client works (`pg_dump --version` = 18.6 through the pinned image).
- The OKE app Deployment is at `replicas: 0`, the CNPG cluster is healthy and empty, the PVC is
  bound, and the certificate is valid for more than 30 days.
- Your Cloudflare redirect rule for `mailviz.rkube.io → https://work.olympusx.ai/$1` (301) is
  prepared but **disabled**.

### 6.3 T0: the freeze (target ≤ 30 min, measured in rehearsal)

| Clock | Who | Step | Check |
|---|---|---|---|
| T0+0 | You | Railway: stop the **app** service (6.1). From here nothing writes. | `…up.railway.app/api/health` fails |
| T0+1 | Claude | Railway Postgres read-only (6.2) | a write is refused |
| T0+2 | Claude | Dump on the Mac through the public proxy with the pinned PG 18.6 image: `docker run --rm --env-file <600 file> <image@digest> pg_dump -Fc --no-owner --no-acl -h <proxy> -p <port> -U postgres -d <db> > final.fc` | exit 0; size about 200 MB; `pg_restore -l final.fc \| wc -l` recorded |
| T0+5 | Claude | Documents: `railway ssh` tar of `/data/rfp` streamed in base64 chunks (the method proven on 2026-10-17), with a sha256 manifest of every file | file count and checksums match the Railway listing |
| T0+8 | Claude | `kubectl cp final.fc productivity-hub/productivity-hub-db-1:/var/lib/postgresql/data/restore.fc` (only 202 MB crosses the tunnel) | size equal |
| T0+10 | Claude | In the primary: `pg_restore -j 2 --no-owner --role=productivity_hub -d productivity_hub /var/lib/postgresql/data/restore.fc`; expect exactly the 2 `COMMENT ON EXTENSION` ownership errors; then `rm` the dump from the volume | no other error lines |
| T0+18 | Claude | Documents into the PVC: a one-shot pod mounting `productivity-hub-documents` (the app is still at 0 replicas, so the RWO volume is free), `tar -x` into `/data/rfp`, owner 10001 | count and sha256 equal |
| T0+20 | Claude | **Validation** (§6.4) and the **decrypt pre-flight**: `kubectl run` the app image with `RUN_SCHEDULERS=false`, decrypting each `google_auth` row and printing only `OK` or `FAIL` | every check is equal; 2 × `OK` |
| T0+24 | Claude | Scale the app to 1 (init container: `migrate deploy` must say "No pending migrations") | Ready; `/api/version` = the release; logs show the schedulers started |
| T0+25 | You | Enable the Cloudflare 301 for `mailviz.rkube.io` | `curl -sI https://mailviz.rkube.io/x` returns `301` to `https://work.olympusx.ai/x` |
| T0+26 | You | Sign in at `https://work.olympusx.ai` (no consent screen expected with the same client) | the Inbox loads; the WebSocket stays connected |
| T0+28 | Claude | Within 3 min: both `google_auth.last_mail_sync_at` and `last_sync_at` advance; a new test mail appears; search finds it; open one reference PDF | **Go/no-go 3**: all yes, otherwise roll back (6.5) |

### 6.4 Validation queries (Railway read-only side against OKE)

- `SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY 1` is not exact. Use instead, for
  every table: `SELECT '<t>', count(*) FROM <t>` (a generated script), and require equality.
- `SELECT count(*), max(migration_name) FROM _prisma_migrations WHERE finished_at IS NOT NULL` = 64 /
  `20261017100000_client_references`.
- `SELECT count(*), max(received_at) FROM emails`, `… FROM calendar_events`,
  `… FROM client_references` (147).
- Content checksum: `SELECT md5(string_agg(id || coalesce(subject,'') || coalesce(snippet,''), ',' ORDER BY id)) FROM emails`
  is equal on both sides. The same for `contacts` (`id || email`) and `tasks`.
- Generated columns, recomputed on restore:
  `SELECT count(*) FROM emails WHERE search_body LIKE '% ' || mv_search_fold('sauvegarde') || '%'`
  is equal on both sides. Run it again with a word containing a non-ASCII letter.
- Collation: `SELECT datcollate, datctype FROM pg_database WHERE datname = current_database()` =
  `en_US.utf8`.
- Extensions: `pg_trgm`, `unaccent` present. Both GIN indexes are valid
  (`SELECT indexrelid::regclass, indisvalid FROM pg_index WHERE NOT indisvalid` returns 0 rows).
- Ownership: `SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tableowner <> 'productivity_hub'` = 0.
- `SELECT count(*) FROM scheduled_emails WHERE status='pending'`, and armed snoozes, are equal on
  both sides. They resume on OKE only.
- Documents: `SELECT count(*) FROM rfp_documents` + `client_references WHERE document_storage_key IS NOT NULL`
  equals the files present in the PVC (a script lists every missing key).

### 6.5 Rollback (until T+7 d)

**Instant, before any user writes on OKE (T0 … T0+30):**
1. Disable the Cloudflare 301.
2. Railway Postgres back to read-write.
3. Start the Railway app.
4. Scale OKE to 0.

Users return to `mailviz.rkube.io`; nothing is lost.

**Later (users have written on OKE):**
1. Scale OKE to 0. Do not run both sides: this is the R1 rule.
2. Take a `pg_dump -Fc` of `productivity-hub-db`.
3. Railway read-write; drop and re-create its database; restore the dump. Railway has PG 18.6, so
   the same major version.
4. Copy `/data/rfp` back the same way.
5. Start the Railway app; disable the 301.

The old redirect URI stays registered for this reason until T+7 d. Measured in rehearsal: the
reverse path takes about the same 30 minutes.

**DNS TTL:**
- `work.olympusx.ai` is created at T-7 d with TTL 300 and stays at 300 until T+7 d (then Auto). No
  DNS change for it on cutover day.
- `mailviz.rkube.io` stays a proxied record. The 301 is a Cloudflare rule, so it takes effect at the
  edge at once and its rollback is instant.

### 6.6 After

- **T+1 h:** a scheduled email sent once; CNPG WAL archiving succeeding (`kubectl cnpg status`).
- **T+24 h:** a nightly base backup in the bucket; no restarts; `google_auth` sync fresh for both
  users.
- **T+7 d:** raise the TTL; measure the backup size and cost.
- **T+7 d:** Phase 6.3–6.4 and 4.7.
- **T+30 d:** Phase 6.5 (the `mailviz.rkube.io` 301 and record go).

---

## 7. Decisions for you

| # | Decision | Options | Recommendation |
|---|---|---|---|
| **D1** | Hostname | `work.olympusx.ai` · keep `mailviz.rkube.io` · other | **`work.olympusx.ai`** with `mailviz.rkube.io` as a 301 for 30 days (your answer), and the P3 same-site fixes from 0.5 |
| **D2** | Google audience (target) | Internal in the powerm.ma organisation · External + In production, unverified (personal-use exemption, Admin **Trusted**) · External + verified + CASA | **Internal** if project 83768907344 is in, or can be moved into, the powerm.ma organisation, in a separate window after cutover. Until then External + In production + Trusted. **Never Testing.** CASA only if the product must serve other organisations. |
| **D3** | When to rename the consent screen | before cutover · after | **Before**, at T-10 d, if review is needed (External + verified); otherwise any time. Never on cutover day. |
| **D4** | Repository visibility (decides CI) | make private, CI on oke-ci · stay public, CI hosted | **Private**, then oke-ci. The repo now holds a product, its ops notes and a customer's tender vocabulary. Until then CI stays hosted. |
| **D5** | Runner registration | add mailviz to the `wlargou-oke-ci` App installation · a per-repo App · a fine-grained token | **Add to the existing installation**, as support-hub did on 2026-10-16. Record the outcome of the still-unrecorded bootstrap-credential test in `ci-runners-plan.md`. |
| **D6** | Image build | local `release.sh` to OCIR · hosted build to GHCR + mirror (Support Hub) | **Local `release.sh`** (GitHub never holds a registry token). If the emulated amd64 build on the Mac takes more than 20 min, switch to Support Hub's GHCR + mirror. |
| **D7** | Where the manifests live | `hosting/k8s/olympusxai/50-productivity-hub.yaml` · a kit in this repo (Support Hub style) | **olympusx-hosting** (private; one source of truth; the same `release.sh` pinning as site and forms) |
| **D8** | In-cluster names | `productivity-hub` · `mailviz` | **`productivity-hub`** (namespace, listener, OCIR, CNPG `productivity-hub-db`, database `productivity_hub`, bucket path), like `support-hub`. Keep `mailviz` for the repo, the npm packages, the dev database and `mv_*` SQL. |
| **D9** | PostgreSQL / operator | PG 18.6 on CNPG 1.25.4 (Support Hub's image) · upgrade CNPG to 1.30.x first · PG 17 (dump downgrade) | **PG 18.6 on 1.25.4 with Support Hub's verified image**, accepted explicitly, plus an operator upgrade to 1.30.x as a separate platform task (it touches every cluster and moves backups to the plugin). Never downgrade the dump. |
| **D10** | CNPG instances | 2 (convention, drain-friendly) · 1 (`enablePDB: false`) | **2** (+1 pod, +250m / 1.5Gi, +$2.13/month). Note that 2-instance automatic failover is listed as not verified on this platform; drill it in 3.7. |
| **D11** | Backups as a cutover gate | gate · follow-up | **Gate**: you create the Customer Secret Key (and a lifecycle rule for old versions) before Phase 3. |
| **D12** | Documents storage | 50 Gi `oci-bv` PVC · OCI Object Storage | **PVC now** (no code change); Object Storage later (removes the AD pin and $2.13/month, allows 2 replicas) |
| **D13** | Replicas | 1 + Recreate · 2 with leader election, cross-pod WS, shared limiter | **1 + Recreate** (≈ 30–60 s per deploy; the same as Railway, which does not overlap with a volume) |
| **D14** | Client IP behind the NLB | trust Envoy only + shared login bucket (raise the limit to 60 per 15 min) · PROXY protocol on the NLB (platform-wide) | **Envoy only + 60 per 15 min** now; PROXY protocol as a platform follow-up |
| **D15** | Egress | Support Hub's (open except metadata) · explicit default-deny | **Explicit**: DNS, CNPG, 443 to 0.0.0.0/0 except 10/8 and 169.254/16 (Calico cannot match Google's names) |
| **D16** | Secrets in the pod | files (`*_FILE`, your stated rule) · `envFrom` (what Support Hub does) | **Files**, mounted at `/var/run/secrets/productivity-hub` (0440, fsGroup 10001), with a small loader in `env.ts` |
| **D17** | Name and lockup | "Olympusx Productivity Hub" everywhere · product + vendor | Full name in the title, About, consent screen and login; header = glyph + "Productivity Hub". You choose the descriptor that replaces "Personal CRM & email manager", and the wordmark weight (the design system says 400; Support Hub's brand book says 600). |
| **D18** | Region-specific product rules | keep (current customer) · make per-workspace | Neutralise the placeholders now (no company or city names). Keep MAD/DH, the 20% VAT basis and the tender catalogue as data for the current customer; make them per-workspace settings when a second customer comes. |
| **D19** | Staging name | `work.olympusx.ai` before launch · `work-staging.olympusx.ai` · sslip.io (no Google sign-in) | **`work.olympusx.ai` before launch** (no extra redirect URI, the certificate is ready long before cutover) |
| **D20** | Capacity | absorb on np-core · the rightsizing plan's D2 (core nodes to 3 OCPU, +$65.70/month) · a 4th node (+$83.09/month) | **Absorb** (≈ 600m / 3.5 GiB / 3 pods; worst node ≤ 66% CPU requested). Revisit the 3-OCPU resize when tenant vector DBs arrive, since node-loss survivors reach ≈ 79% CPU requested. |

### 7.1 Your answers (2026-10-17)

**Decisions**

| # | Answer | Where it differs from the recommendation |
|---|---|---|
| D1 | `work.olympusx.ai`; `mailviz.rkube.io` redirects for **30 days** | 30 days, not 90 |
| D2 | Internal, in the powerm.ma organisation (separate window after cutover); both users are on `@powerm.ma` only | — |
| D3 | Rename the consent screen before cutover (T-10 d) | — |
| D4 | Make the repo private, then CI on OKE | — |
| D5 | Add mailviz to the existing `wlargou-oke-ci` App installation | — |
| D6 | **Hosted build to GHCR + mirror to OCIR** (step 1.2) | yes: not local `release.sh` |
| D7, D8 | olympusx-hosting; `productivity-hub` | — |
| D9 | PG 18.6 on CNPG 1.25.4, Support Hub's image | — |
| D10 | 2 instances | — |
| D11 | Backups are a cutover gate | — |
| D12 | 50 Gi volume now | — |
| D13 | 1 replica + Recreate | — |
| D14 | Trust Envoy only; login limit 60 per 15 min | — |
| D15 | Explicit default-deny egress | — |
| D16 | Secrets as files (`*_FILE`) | — |
| D17 | Header = glyph + "Productivity Hub"; full name elsewhere; descriptor **"Your workday in one place"**; wordmark **400** | descriptor is your own choice |
| D18 | **Leave the customer-specific text as is**, except the References helper text naming a company with a country in it, which becomes generic | yes: placeholders, currency and VAT stay |
| D19 | `work.olympusx.ai` pre-launch as staging; **your own account** signs in there on a scrubbed copy | — |
| D20 | Absorb on np-core; all four Phase 0 code PRs (0.4–0.7) must be in production before the move | — |
| Rebrand timing | On Railway first | — |
| Legal pages | I draft the home and privacy pages, you publish | — |
| Railway deletion | **7 days** after cutover, after the final archive | 7, not 14 |
| Cutover window | I propose slots once every gate is green; you choose | — |

**Permissions**

- **mailviz:** I push branches and open PRs; you merge, and Railway deploys.
- **olympusx-hosting:** I push branches and open PRs; you merge, and you run `terraform apply` and `helm`.
- **Cluster:** I apply only inside namespace `productivity-hub`. You apply the shared Gateway file and the Certificate in `olympus`.
- **App secrets:** copied from Railway into the cluster by a pipe, never printed, lengths checked.
- **Read-only checks:** the Google Cloud Console in your Chrome session (I change nothing) and the OCI tenancy status through the CLI. The Railway dashboard (0.3) and Cloudflare stay with you.
- **Yours, as before:** IAM, OCI credentials (the Customer Secret Key), DNS, every Google Console and Admin console change (including marking the client Trusted, 4.5), and all merges.

---

## Appendix A: manifest sketch (not applied; for review)

```yaml
# hosting/k8s/olympusxai/50-productivity-hub.yaml (sketch)
apiVersion: v1
kind: Namespace
metadata:
  name: productivity-hub
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: latest
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
    app.kubernetes.io/part-of: productivity-hub
---
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata: { name: productivity-hub-db, namespace: productivity-hub }
spec:
  instances: 2
  imageName: fra.ocir.io/axfyua9kygyj/support-hub/cnpg-postgresql:18@sha256:2cd40a7458922b0604ef6e24cad0b64c7d5f3aa148d393abfe87d9b8a38e3579  # 18.6, en_US.utf8, barman-cloud (checked 2026-10-17)
  primaryUpdateStrategy: unsupervised
  primaryUpdateMethod: switchover
  affinity: { enablePodAntiAffinity: true, podAntiAffinityType: required, topologyKey: kubernetes.io/hostname }
  bootstrap:
    initdb:
      database: productivity_hub
      owner: productivity_hub
      encoding: UTF8
      localeCollate: en_US.utf8
      localeCType: en_US.utf8
      postInitApplicationSQL:
        - CREATE EXTENSION IF NOT EXISTS pg_trgm
        - CREATE EXTENSION IF NOT EXISTS unaccent
  postgresql:
    parameters: { shared_buffers: 384MB, effective_cache_size: 1GB, work_mem: 8MB, maintenance_work_mem: 256MB, max_connections: "50" }
  resources: { requests: { cpu: 250m, memory: 1536Mi }, limits: { memory: 1536Mi } }
  storage: { size: 50Gi, storageClass: oci-bv }
  backup:
    retentionPolicy: 30d
    barmanObjectStore:
      destinationPath: s3://olympusx-cnpg-backups/productivity-hub
      endpointURL: https://axfyua9kygyj.compat.objectstorage.eu-frankfurt-1.oci.customer-oci.com
      s3Credentials:
        accessKeyId: { name: productivity-hub-backup-s3, key: ACCESS_KEY_ID }
        secretAccessKey: { name: productivity-hub-backup-s3, key: ACCESS_SECRET_KEY }
        region: { name: productivity-hub-backup-s3, key: REGION }
      wal: { compression: gzip, maxParallel: 2 }
      data: { compression: gzip }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: productivity-hub, namespace: productivity-hub }
spec:
  replicas: 1
  strategy: { type: Recreate }          # never two processes: scheduled sends, syncs, RWO volume
  template:
    spec:
      serviceAccountName: productivity-hub
      automountServiceAccountToken: false
      enableServiceLinks: false
      terminationGracePeriodSeconds: 45
      securityContext: { runAsNonRoot: true, runAsUser: 10001, runAsGroup: 10001, fsGroup: 10001, fsGroupChangePolicy: OnRootMismatch, seccompProfile: { type: RuntimeDefault } }
      initContainers:
        - name: migrate
          # 2026.MM.DD-<sha7>
          image: fra.ocir.io/axfyua9kygyj/productivity-hub/migrator@sha256:<pinned by release.sh>
          workingDir: /app/server
          command: ["node", "/app/node_modules/prisma/build/index.js", "migrate", "deploy"]
          env: [{ name: DATABASE_URL_FILE, value: /var/run/secrets/productivity-hub-db/uri }, { name: CHECKPOINT_DISABLE, value: "1" }, { name: HOME, value: /tmp }]   # prisma.config.ts learns to read *_FILE (0.7)
          resources: { requests: { cpu: 50m, memory: 256Mi }, limits: { memory: 512Mi } }
          securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: [ALL] } }
          volumeMounts: [{ name: tmp, mountPath: /tmp }, { name: db, mountPath: /var/run/secrets/productivity-hub-db, readOnly: true }]
      containers:
        - name: app
          # 2026.MM.DD-<sha7>
          image: fra.ocir.io/axfyua9kygyj/productivity-hub/app@sha256:<pinned by release.sh>
          ports: [{ containerPort: 3002, name: http }]
          env:
            - { name: NODE_ENV, value: production }
            - { name: PORT, value: "3002" }
            - { name: CLIENT_URL, value: https://work.olympusx.ai }
            - { name: GOOGLE_REDIRECT_URI, value: https://work.olympusx.ai/api/v1/auth/google/callback }
            - { name: RFP_STORAGE_DIR, value: /data/rfp }
            - { name: RUN_SCHEDULERS, value: "true" }
            - { name: TRUSTED_PROXIES, value: "<Envoy pod CIDR>" }
            - { name: SECRETS_DIR, value: /var/run/secrets/productivity-hub }   # *_FILE loader (D16)
            - { name: DATABASE_URL_FILE, value: /var/run/secrets/productivity-hub-db/uri }
            - { name: TZ, value: UTC }
          resources: { requests: { cpu: 100m, memory: 512Mi }, limits: { cpu: "1", memory: 1Gi } }
          startupProbe:   { httpGet: { path: /api/health, port: http }, periodSeconds: 5, failureThreshold: 30 }
          livenessProbe:  { httpGet: { path: /api/health, port: http }, periodSeconds: 20, timeoutSeconds: 5 }
          readinessProbe: { httpGet: { path: /api/ready,  port: http }, periodSeconds: 10, timeoutSeconds: 3 }
          lifecycle: { preStop: { sleep: { seconds: 8 } } }
          securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: [ALL] } }
          volumeMounts:
            - { name: documents, mountPath: /data }
            - { name: tmp, mountPath: /tmp }
            - { name: env, mountPath: /var/run/secrets/productivity-hub, readOnly: true }
            - { name: db, mountPath: /var/run/secrets/productivity-hub-db, readOnly: true }
      volumes:
        - { name: documents, persistentVolumeClaim: { claimName: productivity-hub-documents } }
        - { name: tmp, emptyDir: { sizeLimit: 1Gi } }      # disk, not memory: 25–35 MB uploads and sends pass through
        - { name: env, secret: { secretName: productivity-hub-env, defaultMode: 0440 } }
        - { name: db, secret: { secretName: productivity-hub-db-app, defaultMode: 0440, items: [{ key: uri, path: uri }] } }
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata: { name: productivity-hub, namespace: productivity-hub }
spec:
  parentRefs: [{ group: gateway.networking.k8s.io, kind: Gateway, namespace: olympus, name: olympus, sectionName: productivity-hub }]
  hostnames: [work.olympusx.ai]
  rules:
    - matches: [{ path: { type: PathPrefix, value: /ws } }]
      timeouts: { request: 0s }          # an upgraded socket must not hit the 15 s default
      backendRefs: [{ name: productivity-hub, port: 3002 }]
    - matches: [{ path: { type: PathPrefix, value: / } }]
      timeouts: { request: 3600s }       # synchronous syncs, 25 MB uploads, 35 MB sends, downloads
      backendRefs: [{ name: productivity-hub, port: 3002 }]
---
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: BackendTrafficPolicy
metadata: { name: productivity-hub, namespace: productivity-hub }
spec:
  targetRefs: [{ group: gateway.networking.k8s.io, kind: HTTPRoute, name: productivity-hub }]
  timeout: { http: { streamIdleTimeout: 3600s } }   # field present in v1.9.2 (kubectl explain, 2026-10-17)
```

Use CNPG's `uri` as it is. Do not append `sslmode=require`: node-pg 8.23 reads it as `verify-full`,
which fails against CNPG's self-signed CA unless that CA is mounted and passed as `sslrootcert`.

The NetworkPolicies follow §3:
- default-deny for ingress and egress;
- ingress to the app from namespace `envoy-gateway-system` on TCP 3002;
- app egress: kube-dns 53 UDP/TCP, TCP 5432 to pods `cnpg.io/cluster: productivity-hub-db`, and TCP
  443 to `0.0.0.0/0` except `10.0.0.0/8` and `169.254.0.0/16`;
- `allow-to-postgres`, copied from Support Hub;
- CNPG instances: egress to each other on 5432 and 8000, to `10.20.0.0/28:6443`, and to Oracle
  Services on 443 for barman.

The Gateway listener for `10-gateway.yaml` (inserted before Support Hub's block):

```yaml
    # Productivity Hub (mailviz repository): routes from namespace productivity-hub only; Certificate productivity-hub-tls.
    - name: productivity-hub
      port: 443
      protocol: HTTPS
      hostname: work.olympusx.ai
      tls: { mode: Terminate, certificateRefs: [{ group: "", kind: Secret, name: productivity-hub-tls }] }
      allowedRoutes:
        kinds: [{ group: gateway.networking.k8s.io, kind: HTTPRoute }]
        namespaces: { from: Selector, selector: { matchLabels: { kubernetes.io/metadata.name: productivity-hub } } }
```

## Appendix B: capacity and cost

| | CPU request | Memory request / limit | Pods | Block storage |
|---|---|---|---|---|
| App (init migrate adds nothing: init containers do not stack on app requests) | 100m | 512Mi / 1Gi | 1 | 50 GB documents PVC |
| CNPG × 2 | 2 × 250m | 2 × 1536Mi / 1536Mi | 2 | 2 × 50 GB |
| **Total** | **600m** | **3.5 GiB** | **3** | **150 GB** |

- **Fit.** Against today's live requests, the worst node goes from ~56% to at most ~66% CPU and ~55%
  memory requested, within the owner caps (70% / 65%). Placement must be steered (DBs on two ADs, the app on the
  documents PVC's AD), because the AD of a PVC is fixed at first scheduling.
- **Money, at list prices:** 3 × 50 GB Balanced at $0.0425 per GB-month = **$6.38**; backups ≈
  $0.13–0.77; OCIR ≤ $0.05; Email Delivery $0 (Gmail API); NLB $0 (shared). That is ≈ **$7–8 per
  month**, against Railway ≈ $20 (Pro minimum, UNVERIFIED).
- **If capacity is wanted:** the rightsizing plan's D2 (all 3 core nodes to 3 OCPU) is +$65.70 per month; a 4th 2/24 node
  is +$83.09 per month.

## Appendix C: rebrand checklist (from the assessment)

**User-visible, to change.** There are 14 occurrences, all client-side, plus docs:
- `client/index.html:6` title; no favicon exists, so add `client/public/{favicon.svg, favicon-32.png, apple-touch-icon.png}` and theme-color `#161616`;
- `client/src/components/layout/AppHeader.tsx:25,32-35,43`;
- `client/src/components/shared/AboutModal.tsx:58-65`;
- `client/src/components/auth/LoginPage.tsx:15-159` and `client/src/styles/_login.scss:155-216`
  (canvas, orbit logo, purple);
- `client/src/components/onboarding/WelcomeInterstitial.tsx:82,89,96,121` and `SetupWizard.tsx:91,96`;
- `client/src/styles/_onboarding.scss:264-266` (purple gradient);
- `client/src/components/settings/SettingsPage.tsx:1133`;
- `client/src/components/references/ReferenceDetailPage.tsx:447`;
- `README.md:1`, `BACKLOG.md:1`, `docs/database-schema.md:1`, and the CLAUDE.md product line.

The server sends nothing branded: no mail header, log line, User-Agent or cookie name carries the
name (`server/src/utils/mimeBuilder.ts:104-131`).

**Placeholders to neutralise.** They are not tied to a single customer's place:
- `client/src/components/references/ReferenceDetailPage.tsx:543` (a city name);
- `ReferenceDetailPage.tsx:640` (a company name in the helper text);
- `client/src/components/rfps/RfpFormFields.tsx:138` and `:243` (a buyer's portal URL and a tender
  note).

Currency (MAD/DH), the 20% VAT basis and the tender catalogue stay as customer data (D18).

**Keep internal:**
- npm package names, the repo `wlargou/mailviz`, the dev and CI database `mailviz_db` and user
  `mailviz`, `MAILVIZ_TEST_DB_NAME`, the dev JWT seeds;
- the `mv_search_fold` / `mv_search_words` SQL (behind STORED generated columns), `data-mv-quoted`;
- the cookie names `access_token` / `refresh_token`, and `/ws`.

**Rename only in the host-move release:** the localStorage keys `mailviz-theme`, `mailviz-sidenav`
and `mailviz.calendar.layers`. They are per origin, so they are lost at the move anyway.

**Design system:**
- Already aligned: Carbon g100/g10, self-hosted IBM Plex, `var(--cds-*)` only, Blue 60 as the one
  brand hue.
- To align now: the mark (use the design system's `assets/Logos` files; never redraw), sentence
  case, no gradients but the aura, motion only under `prefers-reduced-motion: no-preference`.
- Later: the card hover shadows and lift, and the radius audit.
