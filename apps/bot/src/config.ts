import 'dotenv/config';

export type Config = {
  telegramBotToken: string;
  telegramWebhookSecretToken: string;
  webhookSecret: string;
  publicUrl?: string;
  port: number;
  redisUrl: string;
  llmApiKey: string;
  llmBaseUrl: string;
  llmModel: string;
  llmTimeoutMs: number;
  workerConcurrency: number;
};

let cachedConfig: Config | undefined;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function numberEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid number for env ${name}: ${value}`);
  }
  return parsed;
}

function normalizeBaseUrl(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export function getConfig(): Config {
  if (cachedConfig) {
    return cachedConfig;
  }

  const publicUrl = normalizeBaseUrl(optionalEnv('PUBLIC_URL'));
  const llmBaseUrl = normalizeBaseUrl(optionalEnv('LLM_BASE_URL')) ?? 'https://api.openai.com/v1';

  cachedConfig = {
    telegramBotToken: requireEnv('TELEGRAM_BOT_TOKEN'),
    telegramWebhookSecretToken: requireEnv('TELEGRAM_WEBHOOK_SECRET_TOKEN'),
    webhookSecret: requireEnv('WEBHOOK_SECRET'),
    publicUrl,
    port: numberEnv('PORT', 1001),
    redisUrl: requireEnv('REDIS_URL'),
    llmApiKey: requireEnv('LLM_API_KEY'),
    llmBaseUrl,
    llmModel: requireEnv('LLM_MODEL'),
    llmTimeoutMs: numberEnv('LLM_TIMEOUT_MS', 60000),
    workerConcurrency: numberEnv('WORKER_CONCURRENCY', 2)
  };

  return cachedConfig;
}
