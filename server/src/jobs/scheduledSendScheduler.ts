import * as cron from 'node-cron';
import { emailService } from '../services/emailService.js';

let scheduledTask: ReturnType<typeof cron.schedule> | null = null;
let isProcessing = false;

async function processScheduledSends() {
  if (isProcessing) return;
  isProcessing = true;
  try {
    const count = await emailService.processScheduledEmails();
    if (count > 0) console.log(`[ScheduledSend] Processed ${count} scheduled emails`);
  } catch (err: any) {
    console.error('[ScheduledSend] Error:', err.message);
  } finally {
    isProcessing = false;
  }
}

export function startScheduledSendScheduler() {
  // Check every 30 seconds
  scheduledTask = cron.schedule('*/30 * * * * *', processScheduledSends);
  console.log('[ScheduledSend] Scheduler started (every 30s)');
}

export function stopScheduledSendScheduler() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log('[ScheduledSend] Scheduler stopped');
  }
}
