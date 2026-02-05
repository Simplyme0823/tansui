import type { RedisOptions } from 'ioredis';

import { getConfig } from '../config.js';

function parseRedisDb(pathname: string): number | undefined {
  if (!pathname || pathname === '/') {
    return undefined;
  }
  const raw = pathname.startsWith('/') ? pathname.slice(1) : pathname;
  const db = Number(raw);
  if (Number.isNaN(db)) {
    throw new Error(`Invalid Redis database in REDIS_URL: ${pathname}`);
  }
  return db;
}

export function createRedisOptions(): RedisOptions {
  const config = getConfig();
  const url = new URL(config.redisUrl);
  const options: RedisOptions = {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    maxRetriesPerRequest: null
  };

  if (url.username) {
    options.username = decodeURIComponent(url.username);
  }
  if (url.password) {
    options.password = decodeURIComponent(url.password);
  }

  const db = parseRedisDb(url.pathname);
  if (typeof db === 'number') {
    options.db = db;
  }

  if (url.protocol === 'rediss:') {
    options.tls = {
      servername: url.hostname
    };
  }

  return options;
}
