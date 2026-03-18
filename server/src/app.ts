import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from './config/env.js';
import { errorHandler } from './middleware/errorHandler.js';
import { taskRoutes } from './routes/tasks.js';
import { labelRoutes } from './routes/labels.js';
import { customerRoutes } from './routes/customers.js';
import { contactRoutes } from './routes/contacts.js';
import { authRoutes } from './routes/auth.js';
import { calendarRoutes } from './routes/calendar.js';
import { emailRoutes } from './routes/emails.js';
import { dashboardRoutes } from './routes/dashboard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(helmet({
  contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
}));
app.use(cors({ origin: env.CLIENT_URL }));
app.use(express.json());
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Routes
app.use('/api/v1/tasks', taskRoutes);
app.use('/api/v1/labels', labelRoutes);
app.use('/api/v1/customers', customerRoutes);
app.use('/api/v1/contacts', contactRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/calendar', calendarRoutes);
app.use('/api/v1/emails', emailRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Serve client static files in production
if (env.NODE_ENV === 'production') {
  const clientDist = path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDist));

  // SPA fallback — serve index.html for any non-API route
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Error handler
app.use(errorHandler);

export { app };
