import TelegramBot from 'node-telegram-bot-api';

import { getConfig } from './config.js';

export type BotIdentity = {
  id: number;
  username?: string;
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (timeoutMs <= 0) {
    return promise;
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export function createTelegramBot(): TelegramBot {
  const config = getConfig();
  console.log(config.telegramBotToken)
  return new TelegramBot(config.telegramBotToken, { polling: false, webHook: false });
}

export async function getBotIdentity(bot: TelegramBot, timeoutMs = 15000): Promise<BotIdentity> {
  const me = await withTimeout(bot.getMe(), timeoutMs, 'bot.getMe');
  return {
    id: me.id,
    username: me.username ?? undefined
  };
}
