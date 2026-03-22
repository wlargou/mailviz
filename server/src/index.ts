import { app } from './app.js';
import { env } from './config/env.js';
import { startEmailSyncScheduler, stopEmailSyncScheduler } from './jobs/emailSyncScheduler.js';
import { startCalendarSyncScheduler, stopCalendarSyncScheduler } from './jobs/calendarSyncScheduler.js';
import { startScheduledSendScheduler, stopScheduledSendScheduler } from './jobs/scheduledSendScheduler.js';
import { initWebSocket, shutdownWebSocket } from './websocket.js';
import { prisma } from './lib/prisma.js';

const server = app.listen(env.PORT, () => {
  console.log(`Server running on http://localhost:${env.PORT}`);
  initWebSocket(server);
  startEmailSyncScheduler();
  startCalendarSyncScheduler();
  startScheduledSendScheduler();
});

// ── Graceful shutdown (E2) ──
let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[Shutdown] Received ${signal}, shutting down gracefully...`);

  // 1. Stop accepting new connections
  server.close(() => {
    console.log('[Shutdown] HTTP server closed');
  });

  // 2. Stop background sync schedulers
  stopEmailSyncScheduler();
  stopCalendarSyncScheduler();
  stopScheduledSendScheduler();

  // 3. Close WebSocket connections
  shutdownWebSocket();

  // 4. Disconnect Prisma
  await prisma.$disconnect();
  console.log('[Shutdown] Database disconnected');

  // 5. Force exit after 10s if still hanging
  setTimeout(() => {
    console.error('[Shutdown] Forced exit after timeout');
    process.exit(1);
  }, 10_000).unref();

  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export { server };
