import { randomBytes } from 'node:crypto';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { EventBus } from '../../core/eventBus';
import { Metrics } from '../../core/metrics';
import { KVStore } from '../../core/store';
import { TS3Client } from '../../ts3/TS3Client';
import { sanitizeChannelName } from '../../utils/text';
import { BlacklistService } from '../moderation/blacklist';

const TMP_SET = 'tmp:channels';
const normalizeId = (value: unknown): string => String(value ?? '').trim();
const tempOwnerKey = (ownerId: string): string => `temp:${ownerId}`;
const makePassword = (): string => randomBytes(6).toString('base64url');
const roomName = (nickname?: string): string => sanitizeChannelName(`${nickname?.trim() || 'User'}'s room`, 40);

export interface TempChannelRecord {
  channelId: string;
  ownerKey: string;
  createdAt: number;
  lastEmptyAt: number;
  kind: 'temp' | 'ticket';
  password?: string;
}

export class TempChannelService {
  constructor(
    private readonly store: KVStore,
    private readonly ts3: TS3Client,
    private readonly blacklist: BlacklistService,
    private readonly metrics: Metrics,
    private readonly bus?: EventBus
  ) {}

  private ownerKey(ownerKey: string) { return `tmp:owner:${ownerKey}`; }
  private channelKey(channelId: string) { return `tmp:channel:${channelId}`; }

  init(isLeader: () => boolean): void {
    this.bus?.on('clientmoved', async (event) => this.handleClientMoved(event, isLeader, 'event'));
  }

  async processWaitingLobbyClients(isLeader: () => boolean): Promise<void> {
    if (!isLeader()) return;
    for (const tempLobbyChannelId of env.TEMP_LOBBY_CHANNEL_IDS) {
      const clients = await this.ts3.listClientsInChannel(tempLobbyChannelId);
      logger.debug({ tempLobbyChannelId, clientCount: clients.length }, 'TempChannelService scanned temp lobby for waiting clients');
      for (const client of clients) {
        await this.handleClientMoved({ clientId: client.clientId, clientDbId: client.clientDbId, targetChannelId: client.channelId, nickname: client.nickname }, isLeader, 'lobby-scan');
      }
    }
  }

  private async handleClientMoved(event: { clientId: string; clientDbId: string; targetChannelId: string; nickname?: string }, isLeader: () => boolean, source: 'event' | 'lobby-scan'): Promise<void> {
    const targetChannelId = normalizeId(event.targetChannelId);
    const clientId = normalizeId(event.clientId);
    const clientDbId = normalizeId(event.clientDbId || event.clientId);
    const ownerKey = tempOwnerKey(clientDbId || clientId);
    const leader = isLeader();
    logger.debug({ event, source, targetChannelId, tempLobbyChannelIds: env.TEMP_LOBBY_CHANNEL_IDS, isLeader: leader }, 'TempChannelService received movement event');
    if (!leader) { logger.debug({ event, source }, 'TempChannelService ignored event because this node is not leader'); return; }
    if (!env.TEMP_LOBBY_CHANNEL_ID_SET.has(targetChannelId)) { logger.debug({ event, source, targetChannelId }, 'TempChannelService ignored event because channel is not a temp lobby'); return; }
    if (!clientId) { logger.warn({ event, source }, 'TempChannelService cannot create/reuse temp channel because clientId is missing'); return; }

    try {
      const existing = await this.getActiveRecordForOwner(ownerKey);
      if (existing && env.MAX_ACTIVE_CHANNELS_PER_OWNER <= 1) {
        await this.ts3.moveClient(clientId, existing.channelId);
        await this.sendTempPassword(clientId, existing.channelId, existing.password);
        logger.info({ event, source, clientId, channelId: existing.channelId, ownerKey }, 'Temp channel reused and client moved');
        return;
      }
      const password = makePassword();
      const channelName = roomName(event.nickname);
      const rec = await this.create(ownerKey, channelName, password);
      await this.ts3.moveClient(clientId, rec.channelId);
      await this.sendTempPassword(clientId, rec.channelId, password, channelName);
      logger.info({ event, source, clientId, channelId: rec.channelId, channelName, ownerKey }, 'Temp channel created and client moved');
    } catch (error) {
      logger.error({ err: error, error, event, source, clientId, ownerKey, targetChannelId }, 'Failed temp channel flow with TeamSpeak error');
    }
  }

  private async sendTempPassword(clientId: string, channelId: string, password?: string, channelName?: string): Promise<void> {
    if (!password) return;
    await this.ts3.sendClientMessage(clientId, `Your temporary channel was created.\nChannel: ${channelName ?? channelId}\nPassword: ${password}`);
  }

  async create(ownerKey: string, rawName: string, password?: string): Promise<TempChannelRecord> {
    const name = sanitizeChannelName(rawName, 40);
    if (this.blacklist.hasBlacklistedTerm(name)) throw new Error('Channel name contains blacklisted term');
    const rateKey = `tmp:rate:${ownerKey}`;
    const current = await this.store.incr(rateKey);
    if (current === 1) await this.store.expire(rateKey, env.RATE_LIMIT_WINDOW_SEC);
    if (current > 1) { logger.warn({ ownerKey, rateKey }, 'Temp channel creation rate limited / spam detected'); throw new Error('Rate limit exceeded'); }
    const activeChannel = await this.store.get(this.ownerKey(ownerKey));
    if (activeChannel && env.MAX_ACTIVE_CHANNELS_PER_OWNER <= 1) { logger.info({ ownerKey, activeChannel }, 'Temp channel creation skipped because user already has active channel'); throw new Error('Owner already has active channel'); }
    const channelId = await this.ts3.createChannel({ name, parentId: env.TS3_PARENT_CHANNEL_ID, password, topic: '[TEMP_CH]', description: '[TEMP_CH] managed-by-bot' });
    const rec: TempChannelRecord = { channelId, ownerKey, createdAt: Date.now(), lastEmptyAt: 0, kind: 'temp', password };
    await this.store.set(this.ownerKey(ownerKey), channelId);
    await this.store.hset(this.channelKey(channelId), { ownerKey, channelId, password: password ?? '', createdAt: String(rec.createdAt), lastSeenAt: String(rec.createdAt), lastEmptyAt: '0', kind: rec.kind, type: rec.kind });
    await this.store.sadd(TMP_SET, channelId);
    this.metrics.createdChannels += 1;
    return rec;
  }

  async listActive(): Promise<TempChannelRecord[]> {
    const ids = await this.store.smembers(TMP_SET);
    const rows = await Promise.all(ids.map((id) => this.store.hgetall(this.channelKey(id))));
    return rows.map((row, i) => ({ channelId: row.channelId || ids[i], ownerKey: row.ownerKey, createdAt: Number(row.createdAt), lastEmptyAt: Number(row.lastEmptyAt ?? 0), kind: ((row.kind || row.type) as 'temp' | 'ticket') ?? 'temp', password: row.password })).filter((r) => r.ownerKey);
  }

  async close(channelId: string): Promise<void> {
    const row = await this.store.hgetall(this.channelKey(channelId));
    if (!row.ownerKey || !['temp', 'ticket'].includes(row.kind || row.type)) throw new Error('Refusing to delete unmanaged channel');
    await this.ts3.deleteChannel(channelId);
    await this.store.srem(TMP_SET, channelId);
    await this.store.del(this.channelKey(channelId));
    await this.store.del(this.ownerKey(row.ownerKey));
    this.metrics.deletedChannels += 1;
  }

  async markEmpty(channelId: string): Promise<void> { await this.store.hset(this.channelKey(channelId), { lastEmptyAt: String(Date.now()) }); }
  async markOccupied(channelId: string): Promise<void> { await this.store.hset(this.channelKey(channelId), { lastEmptyAt: '0', lastSeenAt: String(Date.now()) }); }

  async cleanupEmptyChannels(): Promise<number> {
    const active = await this.listActive();
    let deleted = 0;
    logger.debug({ count: active.length }, 'Scanning managed channels for empty cleanup');
    for (const rec of active) {
      try {
        const count = await this.ts3.getChannelClientCount(rec.channelId);
        if (count === 0) {
          const lastEmptyAt = rec.lastEmptyAt || Date.now();
          if (!rec.lastEmptyAt) { await this.markEmpty(rec.channelId); logger.debug({ channelId: rec.channelId, kind: rec.kind }, 'Managed channel marked empty'); }
          if (Date.now() - lastEmptyAt >= env.EMPTY_DELETE_DELAY_SEC * 1000) { await this.close(rec.channelId); deleted += 1; logger.info({ channelId: rec.channelId, kind: rec.kind }, 'Deleted empty managed channel'); }
        } else if (rec.lastEmptyAt > 0) { await this.markOccupied(rec.channelId); logger.info({ channelId: rec.channelId, kind: rec.kind }, 'Cancelled managed channel deletion because it is occupied again'); }
      } catch (error) { logger.error({ err: error, error, channelId: rec.channelId, kind: rec.kind }, 'Failed cleanup for managed channel'); }
    }
    return deleted;
  }

  async cleanupOrphans(): Promise<number> {
    const active = await this.listActive(); let removed = 0;
    for (const rec of active) { const ownerMapping = await this.store.get(this.ownerKey(rec.ownerKey)); if (ownerMapping !== rec.channelId) { await this.close(rec.channelId); removed += 1; } }
    return removed;
  }

  async getActiveChannelForOwner(ownerKey: string): Promise<string | null> { return this.store.get(this.ownerKey(ownerKey)); }
  async getActiveRecordForOwner(ownerKey: string): Promise<TempChannelRecord | null> { const channelId = await this.getActiveChannelForOwner(ownerKey); if (!channelId) return null; const row = await this.store.hgetall(this.channelKey(channelId)); return { channelId, ownerKey, createdAt: Number(row.createdAt), lastEmptyAt: Number(row.lastEmptyAt ?? 0), kind: ((row.kind || row.type) as 'temp' | 'ticket') ?? 'temp', password: row.password }; }

  async attachTicketChannel(ownerKey: string, channelId: string): Promise<void> {
    const createdAt = Date.now();
    await this.store.set(this.ownerKey(ownerKey), channelId);
    await this.store.hset(this.channelKey(channelId), { ownerKey, channelId, createdAt: String(createdAt), lastSeenAt: String(createdAt), lastEmptyAt: '0', kind: 'ticket', type: 'ticket' });
    await this.store.sadd(TMP_SET, channelId);
    this.metrics.activeTickets += 1; this.metrics.createdChannels += 1;
  }
}
