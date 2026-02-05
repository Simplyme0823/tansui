import type TelegramBot from 'node-telegram-bot-api';

import { createTelegramBot } from './bot.js';
import { getConfig } from './config.js';

function requirePublicUrl(): string {
  const config = getConfig();
  if (!config.publicUrl) {
    throw new Error('PUBLIC_URL is required to manage the webhook');
  }
  return config.publicUrl;
}

export function buildWebhookUrl(): string {
  const config = getConfig();
  const publicUrl = requirePublicUrl();
  return `${publicUrl}/telegram/webhook/${config.webhookSecret}`;
}

export function createWebhookBot(): TelegramBot {
  return createTelegramBot();
}

export async function setWebhook(bot: TelegramBot): Promise<void> {
  const config = getConfig();
  const url = buildWebhookUrl();
  await bot.setWebHook(url, {
    secret_token: config.telegramWebhookSecretToken,
    allowed_updates: ['message']
  });
}

export async function deleteWebhook(bot: TelegramBot): Promise<void> {
  await bot.deleteWebHook();
}

export async function getWebhookInfo(bot: TelegramBot): Promise<TelegramBot.WebhookInfo> {
  return bot.getWebHookInfo();
}
