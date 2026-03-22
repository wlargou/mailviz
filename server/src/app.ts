import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from './config/env.js';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(helmet({
  contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
}));
app.use(cors({
  origin: env.CLIENT_URL,
  credentials: true,
}));
// Larger body limit for email send routes (attachments up to 25MB, base64 ~33% overhead)
app.use('/api/v1/emails/send', express.json({ limit: '35mb' }));
app.use('/api/v1/emails/:id/reply', express.json({ limit: '35mb' }));
app.use('/api/v1/emails/:id/forward', express.json({ limit: '35mb' }));
app.use('/api/v1/emails/schedule', express.json({ limit: '35mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Rate limiting on auth login routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many login attempts' } },
});

// Health check (public)
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Auth routes (has its own public/protected split internally)
app.use('/api/v1/auth/login', authLimiter);
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
