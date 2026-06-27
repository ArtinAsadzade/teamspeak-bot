import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const parseIdList = (multi?: string, single?: string): string[] => {
  const source = multi?.trim() ? multi : single;
  return (source ?? '')
    .split(',')
    .map((value) => String(value).trim())
    .filter(Boolean);
};

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3030),
  TS3_HOST: z.string().min(1),
  TS3_QUERY_PORT: z.coerce.number().int().min(1).max(65535).default(10011),
  TS3_SERVER_PORT: z.coerce.number().int().min(1).max(65535).default(9987),
  TS3_USERNAME: z.string().min(1),
  TS3_PASSWORD: z.string().min(1),
  TS3_NICKNAME: z.string().default('ts3-admin-bot'),
  TS3_PARENT_CHANNEL_ID: z.string().min(1),
  TEMP_LOBBY_CHANNEL_ID: z.string().optional(),
  TEMP_LOBBY_CHANNEL_IDS: z.string().optional(),
  SUPPORT_LOBBY_CHANNEL_ID: z.string().optional(),
  SUPPORT_LOBBY_CHANNEL_IDS: z.string().optional(),
  SUPPORT_PARENT_CHANNEL_ID: z.string().min(1),
  STAFF_NOTIFY_TARGET_MODE: z.enum(['server', 'channel', 'client']).default('server'),
  STAFF_NOTIFY_TARGET: z.string().min(1).default('1'),
  API_SECRET: z.string().min(16),
  REDIS_URL: z.string().url().default('redis://redis:6379'),
  REDIS_FALLBACK_INMEMORY: z.enum(['true', 'false']).default('false'),
  RATE_LIMIT_WINDOW_SEC: z.coerce.number().int().min(1).default(60),
  MAX_ACTIVE_CHANNELS_PER_OWNER: z.coerce.number().int().min(1).default(1),
  EMPTY_DELETE_DELAY_SEC: z.coerce.number().int().min(1).default(120),
  SCHEDULER_TICK_SEC: z.coerce.number().int().min(5).default(10),
  LEADER_LOCK_TTL_SEC: z.coerce.number().int().min(5).default(15),
  SPAM_WINDOW_SEC: z.coerce.number().int().min(1).default(10),
  SPAM_SWITCH_THRESHOLD: z.coerce.number().int().min(2).default(4)
}).transform((data) => {
  const supportLobbyChannelIds = parseIdList(data.SUPPORT_LOBBY_CHANNEL_IDS, data.SUPPORT_LOBBY_CHANNEL_ID);
  const tempLobbyChannelIds = parseIdList(data.TEMP_LOBBY_CHANNEL_IDS, data.TEMP_LOBBY_CHANNEL_ID);
  return {
    ...data,
    SUPPORT_LOBBY_CHANNEL_ID: supportLobbyChannelIds[0] ?? '',
    SUPPORT_LOBBY_CHANNEL_IDS: supportLobbyChannelIds,
    SUPPORT_LOBBY_CHANNEL_ID_SET: new Set<string>(supportLobbyChannelIds),
    TEMP_LOBBY_CHANNEL_ID: tempLobbyChannelIds[0] ?? '',
    TEMP_LOBBY_CHANNEL_IDS: tempLobbyChannelIds,
    TEMP_LOBBY_CHANNEL_ID_SET: new Set<string>(tempLobbyChannelIds)
  };
}).superRefine((data, ctx) => {
  if (data.SUPPORT_LOBBY_CHANNEL_IDS.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['SUPPORT_LOBBY_CHANNEL_IDS'], message: 'At least one support lobby channel ID is required' });
  }
  if (data.TEMP_LOBBY_CHANNEL_IDS.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['TEMP_LOBBY_CHANNEL_IDS'], message: 'At least one temp lobby channel ID is required' });
  }
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

if (parsed.data.NODE_ENV === 'production' && parsed.data.REDIS_FALLBACK_INMEMORY === 'true') {
  console.error('REDIS_FALLBACK_INMEMORY=true is not allowed in production');
  process.exit(1);
}

export const env = parsed.data;
