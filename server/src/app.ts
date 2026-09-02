import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from './config/env.js';
import { APP_VERSION, RELEASED_AT } from './config/version.js';
import { TRUSTED_PROXIES } from './config/trustedProxies.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requireAuth } from './middleware/auth.js';
import { taskRoutes } from './routes/tasks.js';
import { labelRoutes } from './routes/labels.js';
import { customerRoutes } from './routes/customers.js';
import { contactRoutes } from './routes/contacts.js';
import { authRoutes } from './routes/auth.js';
import { calendarRoutes } from './routes/calendar.js';
import { emailRoutes } from './routes/emails.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { searchRoutes } from './routes/search.js';
import { taskStatusRoutes } from './routes/taskStatuses.js';
import { companyCategoryRoutes } from './routes/companyCategories.js';
import { dealPartnerRoutes } from './routes/dealPartners.js';
import { dealRoutes } from './routes/deals.js';
import auditRoutes from './routes/audit.js';
import { notificationRoutes } from './routes/notifications.js';
import { snoozeRoutes } from './routes/snooze.js';
import { templateRoutes } from './routes/templates.js';
import { onboardingRoutes } from './routes/onboarding.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

/**
 * Believe the infrastructure about who the client is, and nobody else.
 *
 * Until this, `req.ip` was Railway's internal proxy — one address shared by
 * every request — so the login limiter's bucket was global. See
 * `config/trustedProxies.ts` for why this is an allow-list of hops rather than
 * `true`, and why it has to cover both the Cloudflare-fronted domain and the
 * directly reachable Railway one.
 */
app.set('trust proxy', TRUSTED_PROXIES);

/**
 * Helmet, with one deliberate relaxation to `img-src`.
 *
 * Helmet's default CSP is `img-src 'self' data:`, and in production this server
 * also serves the SPA — so that policy governs the mail viewer, which renders
 * message bodies inline (`dangerouslySetInnerHTML`, sanitised by DOMPurify).
 * The result was that every remote image in every email was blocked: logos in
 * signatures, newsletter artwork, anything not inlined as a data: URI. Only in
 * production, because CSP is off in development — so the mail looked fine on
 * the machine where it was being worked on and broken on the deployed app.
 *
 * `https:` and not `*`: an http image on an https page is mixed content and
 * would be blocked anyway. Scripts, frames and objects keep the default policy,
 * which is what actually contains a hostile message — an image cannot execute.
 *
 * The cost is real and worth naming: permitting remote images permits tracking
 * pixels, which is why Gmail and Outlook proxy images through their own servers
 * rather than fetching them from the sender. Doing that here is a feature, not
 * a header change; until then, opening a message tells its sender you opened it.
 */
export function cspOptions(nodeEnv: string) {
  if (nodeEnv !== 'production') return false as const;
  return {
    useDefaults: true,
    directives: { 'img-src': ["'self'", 'data:', 'https:'] },
  };
}

app.use(helmet({ contentSecurityPolicy: cspOptions(env.NODE_ENV) }));
app.use(cors({
  origin: env.CLIENT_URL,
  credentials: true,
}));
// Larger body limit for email send routes (attachments up to 25MB, base64 ~33% overhead)
app.use('/api/v1/emails/send', express.json({ limit: '35mb' }));
app.use('/api/v1/emails/:id/reply', express.json({ limit: '35mb' }));
app.use('/api/v1/emails/:id/forward', express.json({ limit: '35mb' }));
app.use('/api/v1/emails/schedule', express.json({ limit: '35mb' }));
// Drafts carry the same attachments a send does, and re-upload them on every save.
app.use('/api/v1/emails/drafts', express.json({ limit: '35mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

/**
 * Rate limiting on the routes that actually authenticate.
 *
 * The mount points are the point. `/api/v1/auth/login` covers exactly one
 * route by prefix — `GET /auth/login/google/url` — which builds a redirect URL
 * and touches nothing: no credential, no database write, no outbound call. It
 * was the only thing limited.
 *
 * `GET /auth/google/callback` is the route that matters and it had no limit at
 * all. It exchanges an OAuth code with Google (an outbound request per call),
 * looks the account up, creates or updates the user, and mints the session
 * cookies. It is also where the ALLOWED_EMAILS check runs, so an unlimited
 * callback is an unlimited oracle for which addresses are on the whitelist.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many login attempts' } },
});

// Health check (public)
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

/**
 * What is deployed here (public).
 *
 * Public and unauthenticated on purpose: the question "which version is in
 * production" is usually asked while something is wrong, and needing a session
 * to answer it makes it useless at exactly that moment.
 *
 * Two fields, and no more. This is served to the internet, so the response
 * shape IS the security boundary — the environment name and the process start
 * time were dropped because neither is anyone's business from outside and
 * neither is what a reader wants to know.
 */
app.get('/api/version', (_req, res) => {
  res.json({ data: { version: APP_VERSION, releasedAt: RELEASED_AT } });
});

// Auth routes (has its own public/protected split internally)
app.use('/api/v1/auth/login', authLimiter);
app.use('/api/v1/auth/google/callback', authLimiter);
app.use('/api/v1/auth', authRoutes);

// Protected routes — require authentication
app.use('/api/v1/tasks', requireAuth, taskRoutes);
app.use('/api/v1/labels', requireAuth, labelRoutes);
app.use('/api/v1/customers', requireAuth, customerRoutes);
app.use('/api/v1/contacts', requireAuth, contactRoutes);
app.use('/api/v1/calendar', requireAuth, calendarRoutes);
app.use('/api/v1/emails', requireAuth, emailRoutes);
app.use('/api/v1/dashboard', requireAuth, dashboardRoutes);
app.use('/api/v1/search', requireAuth, searchRoutes);
app.use('/api/v1/task-statuses', requireAuth, taskStatusRoutes);
app.use('/api/v1/company-categories', requireAuth, companyCategoryRoutes);
app.use('/api/v1/deal-partners', requireAuth, dealPartnerRoutes);
app.use('/api/v1/deals', requireAuth, dealRoutes);
app.use('/api/v1/audit-logs', requireAuth, auditRoutes);
app.use('/api/v1/notifications', requireAuth, notificationRoutes);
app.use('/api/v1/snooze', requireAuth, snoozeRoutes);
app.use('/api/v1/templates', requireAuth, templateRoutes);
app.use('/api/v1/onboarding', requireAuth, onboardingRoutes);

// Serve client static files in production
if (env.NODE_ENV === 'production') {
  const clientDist = path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDist));

  // SPA fallback — serve index.html for any non-API route
  app.get('{*path}', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Error handler
app.use(errorHandler);

export { app };
