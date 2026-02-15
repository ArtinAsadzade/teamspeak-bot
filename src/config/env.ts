import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  TS3_HOST: z.string().min(1),
  TS3_QUERY_PORT: z.coerce.number().int().min(1).max(65535).default(10011),
  TS3_SERVER_PORT: z.coerce.number().int().min(1).max(65535).default(9987),
  TS3_USERNAME: z.string().min(1),
  TS3_PASSWORD: z.string().min(1),
  TS3_NICKNAME: z.string().default('ts3-admin-bot'),
  TS3_PARENT_CHANNEL_ID: z.string().min(1),
  SUPPORT_LOBBY_CHANNEL_ID: z.string().min(1),
  SUPPORT_PARENT_CHANNEL_ID: z.string().min(1),
  STAFF_NOTIFY_TARGET_MODE: z.enum(['server', 'channel']).default('server'),
  STAFF_NOTIFY_TARGET: z.string().min(1).default('1'),
  API_SECRET: z.string().min(16),
  REDIS_URL: z.string().url().default('redis://redis:6379'),
  REDIS_FALLBACK_INMEMORY: z.enum(['true', 'false']).default('false'),
  RATE_LIMIT_WINDOW_SEC: z.coerce.number().int().min(1).default(60),
  MAX_ACTIVE_CHANNELS_PER_OWNER: z.coerce.number().int().min(1).default(1),
  EMPTY_DELETE_DELAY_SEC: z.coerce.number().int().min(30).default(120),
  SCHEDULER_TICK_SEC: z.coerce.number().int().min(5).default(10),
  LEADER_LOCK_TTL_SEC: z.coerce.number().int().min(5).default(15),
  SPAM_WINDOW_SEC: z.coerce.number().int().min(1).default(10),
  SPAM_SWITCH_THRESHOLD: z.coerce.number().int().min(2).default(4)
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
