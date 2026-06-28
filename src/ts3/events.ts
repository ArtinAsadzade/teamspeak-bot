import { logger } from '../config/logger';

const firstString = (...values: unknown[]): string => {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      const normalized = String(value).trim();
      if (normalized) return normalized;
    }
  }
  return '';
};

export interface NormalizedClientMoveEvent {
  clientId: string;
  clientDbId: string;
  targetChannelId: string;
  invokerName?: string;
  nickname?: string;
}

export function normalizeClientMovedEvent(raw: unknown): NormalizedClientMoveEvent | null {
  const event = raw as Record<string, unknown> & { client?: Record<string, unknown>; channel?: Record<string, unknown> };
  const client = event?.client ?? {};
  const channel = event?.channel ?? {};
  const normalized: NormalizedClientMoveEvent = {
    clientId: firstString(client.clid, event.clid, event.clientId),
    clientDbId: firstString(
      client.clientDatabaseId,
      client.client_database_id,
      client.cldbid,
      event.clientDatabaseId,
      event.client_database_id,
      event.cldbid
    ),
    targetChannelId: firstString(channel.cid, client.cid, event.ctid, event.cid),
    invokerName: firstString(event.invokername, event.invokerName) || undefined,
    nickname: firstString(client.clientNickname, client.client_nickname, client.nickname, event.client_nickname, event.nickname) || undefined
  };

  if (!normalized.clientId || !normalized.targetChannelId) {
    logger.warn({ rawEvent: raw, normalized }, 'Malformed TS3 movement event ignored');
    return null;
  }
  return normalized;
}

export const normalizeStringId = firstString;
