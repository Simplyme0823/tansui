import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type TelegramBot from 'node-telegram-bot-api';

import { createTelegramBot, getBotIdentity } from './bot.js';
import { getConfig } from './config.js';
import { handleTelegramUpdate } from './handlers/message.js';
import { messageQueue } from './queue/queue.js';

const config = getConfig();

const app = new Hono();
const bot = createTelegramBot();
let botIdentity: Awaited<ReturnType<typeof getBotIdentity>> | null = null;

function isTelegramUpdate(value: unknown): value is TelegramBot.Update {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const updateId = (value as { update_id?: unknown }).update_id;
  return typeof updateId === 'number';
}

app.get('/healthz', (c) => c.text('ok'));

app.post(`/telegram/webhook/${config.webhookSecret}`, async (c) => {
  const token = c.req.header('x-telegram-bot-api-secret-token');
  if (!token || token !== config.telegramWebhookSecretToken) {
    return c.text('unauthorized', 401);
  }

  let update: unknown;
  try {
    update = await c.req.json();
  } catch (error) {
    console.error('Invalid webhook payload', error);
    return c.text('bad request', 400);
  }

  if (!isTelegramUpdate(update)) {
    return c.text('bad request', 400);
  }

  if (!botIdentity) {
    return c.text('bot not ready', 503);
  }

  await handleTelegramUpdate(update, botIdentity, messageQueue);

  return c.text('ok');
});

serve({
  fetch: app.fetch,
  port: config.port
});

console.log(`Bot server listening on port ${config.port}`);

const initializeBot = async () => {
  try {
    console.log('Initializing bot identity...');
    botIdentity = await getBotIdentity(bot);
    console.log(`Bot identity loaded: ${botIdentity.username ?? botIdentity.id}`);
  } catch (error) {
    console.error('Failed to initialize bot identity', error);
    process.exit(1);
  }
};

void initializeBot();
