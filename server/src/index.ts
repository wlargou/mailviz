import { app } from './app.js';
import { env } from './config/env.js';
import { startEmailSyncScheduler } from './jobs/emailSyncScheduler.js';
import { initWebSocket } from './websocket.js';

const server = app.listen(env.PORT, () => {
  console.log(`Server running on http://localhost:${env.PORT}`);
  initWebSocket(server);
  startEmailSyncScheduler();
});

export { server };
