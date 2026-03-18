import { app } from './app.js';
import { env } from './config/env.js';
import { startEmailSyncScheduler } from './jobs/emailSyncScheduler.js';
import { startCalendarSyncScheduler } from './jobs/calendarSyncScheduler.js';
import { initWebSocket } from './websocket.js';

const server = app.listen(env.PORT, () => {
  console.log(`Server running on http://localhost:${env.PORT}`);
  initWebSocket(server);
  startEmailSyncScheduler();
  startCalendarSyncScheduler();
});

export { server };
