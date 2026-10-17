import { app } from './app.js';
import { env, assertProductionSecrets } from './config/env.js';
import { startSchedulers, stopSchedulers } from './jobs/schedulers.js';
import { initWebSocket, shutdownWebSocket } from './websocket.js';
import { prisma } from './lib/prisma.js';
import { closeHttpServer, configureHttpServer, createShutdown } from './lib/lifecycle.js';

// Before the port opens, not after: a server that is already accepting requests
// while signing tokens with a repository-derived secret has already failed.
assertProductionSecrets();

const server = app.listen(env.PORT, () => {
  console.log(`Server running on http://localhost:${env.PORT}`);
  initWebSocket(server);
  startSchedulers();
});
configureHttpServer(server);

// Drain, then close: running jobs and requests finish inside one deadline
// before the process exits. See lib/lifecycle.ts.
const shutdown = createShutdown({
  stopSchedulers,
  closeHttp: (deadlineMs) => closeHttpServer(server, deadlineMs),
  closeWebSocket: shutdownWebSocket,
  disconnect: () => prisma.$disconnect(),
  exit: (code) => process.exit(code),
});

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

export { server };
