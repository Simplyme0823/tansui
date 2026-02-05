import type { Queue } from 'bullmq';
import type TelegramBot from 'node-telegram-bot-api';

import type { BotIdentity } from '../bot.js';
import { JOB_NAME, type MessageJob } from '../queue/types.js';

const GROUP_TYPES = new Set(['group', 'supergroup']);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isBotMentioned(
  text: string,
  entities: TelegramBot.MessageEntity[] | undefined,
  botUsername: string | undefined
): boolean {
  if (!botUsername) {
    return false;
  }
  const mention = `@${botUsername}`.toLowerCase();
  if (entities) {
    for (const entity of entities) {
      if (entity.type !== 'mention') {
        continue;
      }
      const part = text.slice(entity.offset, entity.offset + entity.length).toLowerCase();
      if (part === mention) {
        return true;
      }
    }
  }
  return text.toLowerCase().includes(mention);
}

function stripBotMention(text: string, botUsername: string | undefined): string {
  if (!botUsername) {
    return text.trim();
  }
  const mention = `@${botUsername}`;
  const regex = new RegExp(`\\s*${escapeRegExp(mention)}\\s*`, 'gi');
  return text.replace(regex, ' ').replace(/\s+/g, ' ').trim();
}

function isReplyToBot(message: TelegramBot.Message, botId: number): boolean {
  const replyFrom = message.reply_to_message?.from;
  return Boolean(replyFrom && replyFrom.id === botId);
}

function buildJobId(update: TelegramBot.Update, message: TelegramBot.Message): string {
  return typeof update.update_id === 'number'
    ? `update-${update.update_id}`
    : `${message.chat.id}-${message.message_id}`;
}

export async function handleTelegramUpdate(
  update: TelegramBot.Update,
  identity: BotIdentity,
  queue: Queue<MessageJob>
): Promise<void> {
  const message = update.message;
  if (!message || !message.text || !message.from) {
    return;
  }

  console.log(
    'Incoming message',
    JSON.stringify({
      updateId: update.update_id,
      chatId: message.chat.id,
      chatType: message.chat.type,
      messageId: message.message_id,
      fromId: message.from.id,
      fromUsername: message.from.username,
      text: message.text
    })
  );

  const chatType = message.chat.type;
  if (chatType === 'channel') {
    return;
  }

  const isPrivate = chatType === 'private';
  const isGroup = GROUP_TYPES.has(chatType);

  if (isGroup) {
    const mentioned = isBotMentioned(message.text, message.entities, identity.username);
    const replied = isReplyToBot(message, identity.id);
    if (!mentioned && !replied) {
      return;
    }
  }

  const normalizedText = isPrivate
    ? message.text.trim()
    : stripBotMention(message.text, identity.username);

  if (!normalizedText) {
    return;
  }

  const payload: MessageJob = {
    updateId: update.update_id,
    chatId: message.chat.id,
    chatType,
    messageId: message.message_id,
    text: normalizedText,
    fromId: message.from.id,
    fromUsername: message.from.username,
    fromFirstName: message.from.first_name,
    fromLastName: message.from.last_name,
    botUsername: identity.username
  };

  const jobId = buildJobId(update, message);

  try {
    await queue.add(JOB_NAME, payload, { jobId });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Job already exists')) {
      return;
    }
    console.error('Failed to enqueue message job', error);
  }
}
