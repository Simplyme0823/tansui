import { buildWebhookUrl, createWebhookBot, setWebhook } from '../telegram-webhook.js';

try {
  const bot = createWebhookBot();
  await setWebhook(bot);
  console.log(`Webhook set to ${buildWebhookUrl()}`);
} catch (error) {
  console.error('Failed to set webhook', error);
  process.exitCode = 1;
}
