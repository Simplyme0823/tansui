import { createWebhookBot, getWebhookInfo } from '../telegram-webhook.js';

try {
  const bot = createWebhookBot();
  const info = await getWebhookInfo(bot);
  console.log(JSON.stringify(info, null, 2));
} catch (error) {
  console.error('Failed to get webhook info', error);
  process.exitCode = 1;
}
