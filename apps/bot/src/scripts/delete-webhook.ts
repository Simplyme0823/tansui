import { createWebhookBot, deleteWebhook } from '../telegram-webhook.js';

try {
  const bot = createWebhookBot();
  await deleteWebhook(bot);
  console.log('Webhook deleted');
} catch (error) {
  console.error('Failed to delete webhook', error);
  process.exitCode = 1;
}
