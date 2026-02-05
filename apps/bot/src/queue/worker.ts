import { Worker } from 'bullmq';
import type TelegramBot from 'node-telegram-bot-api';

import { createTelegramBot } from '../bot.js';
import { getConfig } from '../config.js';
import { createLlmClient } from '../llm/client.js';
import { createRedisOptions } from './redis.js';
import { QUEUE_NAME, type MessageJob } from './types.js';

type ReplyPayload = {
  text: string;
  parseMode?: 'HTML';
};

const FALLBACK_REPLY = 'Service is busy, please try again later.';
const PLACEHOLDER_FRAMES = ['Thinking', 'Thinking.', 'Thinking..', 'Thinking...'];
const MAX_MESSAGE_LENGTH = 4096;
const EDIT_INTERVAL_MS = 800;
const EDIT_CHAR_INTERVAL = 80;
const TYPING_INTERVAL_MS = 200;

function getPlaceholderFrame(index: number): string {
  return PLACEHOLDER_FRAMES[index % PLACEHOLDER_FRAMES.length] ?? 'Typing...';
}

type ReplyContext = {
  prefix: string;
  parseMode?: 'HTML';
  escapeContent: boolean;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtmlLimited(value: string, maxLength: number): string {
  if (maxLength <= 0) {
    return '';
  }

  let result = '';
  for (const character of value) {
    let escaped = character;
    if (character === '&') {
      escaped = '&amp;';
    } else if (character === '<') {
      escaped = '&lt;';
    } else if (character === '>') {
      escaped = '&gt;';
    }

    if (result.length + escaped.length > maxLength) {
      break;
    }
    result += escaped;
  }
  return result;
}

function buildDisplayName(job: MessageJob): string {
  const parts = [job.fromFirstName, job.fromLastName].filter(Boolean);
  return parts.join(' ') || 'there';
}

function createReplyContext(job: MessageJob): ReplyContext {
  if (job.chatType === 'private') {
    return { prefix: '', escapeContent: false };
  }

  if (job.fromUsername) {
    return { prefix: `@${job.fromUsername} `, escapeContent: false };
  }

  const name = escapeHtml(buildDisplayName(job));
  const mention = `<a href="tg://user?id=${job.fromId}">${name}</a>`;
  return {
    prefix: `${mention} `,
    parseMode: 'HTML',
    escapeContent: true
  };
}

function buildReplyPayload(context: ReplyContext, content: string): ReplyPayload {
  const prefix = context.prefix.length > MAX_MESSAGE_LENGTH
    ? context.prefix.slice(0, MAX_MESSAGE_LENGTH)
    : context.prefix;
  const maxContentLength = Math.max(0, MAX_MESSAGE_LENGTH - prefix.length);

  const body = context.escapeContent
    ? escapeHtmlLimited(content, maxContentLength)
    : content.slice(0, maxContentLength);

  const text = `${prefix}${body}`;

  return context.parseMode ? { text, parseMode: context.parseMode } : { text };
}

async function sendInitialMessage(
  bot: TelegramBot,
  job: MessageJob,
  context: ReplyContext
): Promise<{ messageId: number; lastText: string }> {
  const payload = buildReplyPayload(context, getPlaceholderFrame(0));
  const options = payload.parseMode ? { parse_mode: payload.parseMode } : undefined;
  const sent = await bot.sendMessage(job.chatId, payload.text, options);
  return { messageId: sent.message_id, lastText: payload.text };
}

function startTypingAnimation(
  bot: TelegramBot,
  job: MessageJob,
  messageId: number,
  context: ReplyContext,
  getLastText: () => string,
  setLastText: (value: string) => void
): { stop: () => void } {
  let stopped = false;
  let frameIndex = 0;
  let inFlight = false;

  const tick = async () => {
    if (stopped || inFlight) {
      return;
    }
    inFlight = true;
    try {
      const content = getPlaceholderFrame(frameIndex);
      frameIndex += 1;
      const updated = await editReplyMessage(
        bot,
        job,
        messageId,
        context,
        content,
        getLastText()
      );
      setLastText(updated);
    } catch (error) {
      console.warn('Typing animation failed', error);
    } finally {
      inFlight = false;
    }
  };

  const interval = setInterval(() => {
    void tick();
  }, TYPING_INTERVAL_MS);

  void tick();

  return {
    stop: () => {
      stopped = true;
      clearInterval(interval);
    }
  };
}

async function editReplyMessage(
  bot: TelegramBot,
  job: MessageJob,
  messageId: number,
  context: ReplyContext,
  content: string,
  lastText: string
): Promise<string> {
  const payload = buildReplyPayload(context, content);
  if (payload.text === lastText) {
    return lastText;
  }
  const options: TelegramBot.EditMessageTextOptions = {
    chat_id: job.chatId,
    message_id: messageId
  };
  if (payload.parseMode) {
    options.parse_mode = payload.parseMode;
  }
  await bot.editMessageText(payload.text, options);
  return payload.text;
}

export function startWorker(): Worker<MessageJob> {
  const config = getConfig();
  const bot = createTelegramBot();
  const llm = createLlmClient();

  const worker = new Worker<MessageJob>(
    QUEUE_NAME,
    async (job) => {
      const context = createReplyContext(job.data);
      let messageId: number | null = null;
      let lastText = '';
      let fullText = '';
      let lastEditAt = Date.now();
      let lastLength = 0;
      let typing: { stop: () => void } | null = null;

      try {
        const initial = await sendInitialMessage(bot, job.data, context);
        messageId = initial.messageId;
        lastText = initial.lastText;
        typing = startTypingAnimation(
          bot,
          job.data,
          messageId,
          context,
          () => lastText,
          (value) => {
            lastText = value;
          }
        );

        const sessionId = `telegram:${job.data.chatId}`;

        for await (const chunk of llm.streamReply(job.data.text, sessionId)) {
          if (typing) {
            typing.stop();
            typing = null;
          }

          fullText += chunk;

          const now = Date.now();
          const shouldEdit =
            fullText.length - lastLength >= EDIT_CHAR_INTERVAL ||
            now - lastEditAt >= EDIT_INTERVAL_MS;

          if (!shouldEdit) {
            continue;
          }

          lastText = await editReplyMessage(
            bot,
            job.data,
            messageId,
            context,
            fullText,
            lastText
          );
          lastEditAt = now;
          lastLength = fullText.length;
        }

        const finalText = fullText.trim() ? fullText : FALLBACK_REPLY;
        if (messageId !== null) {
          await editReplyMessage(bot, job.data, messageId, context, finalText, lastText);
        }
      } catch (error) {
        console.error('Stream reply failed', error);
        if (messageId !== null) {
          try {
            await editReplyMessage(bot, job.data, messageId, context, FALLBACK_REPLY, lastText);
          } catch (sendError) {
            console.error('Failed to send fallback reply', sendError);
          }
        }
      } finally {
        if (typing) {
          typing.stop();
        }
      }
    },
    {
      connection: createRedisOptions(),
      concurrency: config.workerConcurrency
    }
  );

  worker.on('failed', async (job, error) => {
    if (!job) {
      console.error('Job failed', error);
      return;
    }

    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) {
      console.error(`Job attempt failed (${job.attemptsMade}/${maxAttempts})`, error);
      return;
    }

    console.error('Job failed permanently', error);

    try {
      const context = createReplyContext(job.data);
      const payload = buildReplyPayload(context, FALLBACK_REPLY);
      const options = payload.parseMode ? { parse_mode: payload.parseMode } : undefined;
      await bot.sendMessage(job.data.chatId, payload.text, options);
    } catch (sendError) {
      console.error('Failed to send fallback reply', sendError);
    }
  });

  worker.on('error', (error) => {
    console.error('Worker error', error);
  });

  return worker;
}
