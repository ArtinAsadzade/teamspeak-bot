import { randomInt } from 'node:crypto';
import { env } from '../../config/env';
import { featureFlags } from '../../config/featureFlags';
import { logger } from '../../config/logger';
import { EventBus } from '../../core/eventBus';
import { Metrics } from '../../core/metrics';
import { ManagedChannelRecord, ManagedChannelRepository } from '../../core/redis/managedChannelRepository';
import { KVStore } from '../../core/store';
import { TS3Client } from '../../ts3/TS3Client';
import { sanitizeChannelName } from '../../utils/text';
import { persianMessages } from '../messages/fa';
import { BlacklistService } from '../moderation/blacklist';

const normalizeId = (value: unknown): string => String(value ?? '').trim();
const TEMP_MARKER = '[TEMP_CH] managed-by-bot';
export const selectOwnerKey = (clientDbId?: string, clientId?: string): string => normalizeId(clientDbId) || normalizeId(clientId);
export const makeTempPassword = (): string => String(randomInt(1000, 10000));
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
  private readonly repository: ManagedChannelRepository;

  constructor(
    private readonly store: KVStore,
    private readonly ts3: TS3Client,
    private readonly blacklist: BlacklistService,
    private readonly metrics: Metrics,
    private readonly bus?: EventBus
  ) {
    this.repository = new ManagedChannelRepository(store);
  }

  private rateKey(ownerKey: string) { return `managed:rate:temp:${ownerKey}`; }
  private lockKey(ownerKey: string) { return `managed:lock:temp:${ownerKey}`; }

  init(isLeader: () => boolean): void {
    if (!featureFlags.tempChannelLifecycle) {
      logger.info('Temp channel lifecycle feature is disabled; handlers were not registered');
      return;
    }
    this.bus?.on('clientmoved', async (event) => this.handleClientMoved(event, isLeader, 'event'));
  }

  async processWaitingLobbyClients(isLeader: () => boolean): Promise<void> {
    if (!featureFlags.tempChannelLifecycle || !isLeader()) return;
    for (const tempLobbyChannelId of env.TEMP_LOBBY_CHANNEL_IDS) {
      const clients = await this.ts3.listClientsInChannel(tempLobbyChannelId);
      logger.debug({ tempLobbyChannelId, clientCount: clients.length }, 'Scanned temp lobby for waiting clients');
      for (const client of clients) await this.handleClientMoved({ clientId: client.clientId, clientDbId: client.clientDbId, targetChannelId: client.channelId, nickname: client.nickname }, isLeader, 'lobby-scan');
    }
  }

  private async handleClientMoved(event: { clientId: string; clientDbId: string; targetChannelId: string; nickname?: string }, isLeader: () => boolean, source: 'event' | 'lobby-scan'): Promise<void> {
    const targetChannelId = normalizeId(event.targetChannelId);
    const clientId = normalizeId(event.clientId);
    const ownerKey = selectOwnerKey(event.clientDbId, clientId);
    if (!isLeader() || !env.TEMP_LOBBY_CHANNEL_ID_SET.has(targetChannelId)) return;
    if (!clientId || !ownerKey) { logger.warn({ event, source }, 'Temp flow ignored because client or owner id is missing'); return; }

    const locked = await this.store.setIfNotExists(this.lockKey(ownerKey), source, 5);
    if (!locked) { logger.debug({ source, clientId, ownerKey }, 'Temp flow skipped because owner lock is held'); return; }

    try {
      const recovered = await this.removeStaleMetadata(ownerKey);
      const existing = await this.repository.getByOwner('temp', ownerKey);
      if (existing && env.MAX_ACTIVE_CHANNELS_PER_OWNER <= 1) {
        await this.ts3.moveClient(clientId, existing.channelId);
        await this.ts3.sendPrivateMessage(clientId, persianMessages.tempReused({ channelName: existing.channelName, password: existing.password ?? '' }));
        logger.info({ source, clientId, channelId: existing.channelId, ownerKey }, 'Temp channel reused and user moved');
        return;
      }

      const password = makeTempPassword();
      const channelName = roomName(event.nickname);
      const record = await this.createManagedTempChannel(ownerKey, channelName, password, recovered);
      await this.ts3.verifyChannelPasswordFlag(record.channelId);
      await this.repository.setManagedChannel({ ...record, password, lastSeenAt: Date.now() });
      await this.ts3.moveClient(clientId, record.channelId);
      logger.info({ source, clientId, channelId: record.channelId, ownerKey }, 'User moved to temp channel');
      await this.ts3.sendPrivateMessage(clientId, persianMessages.tempCreated({ channelName, password }));
      logger.info({ source, clientId, channelId: record.channelId, channelName, ownerKey }, 'Temp channel created');
    } catch (error) {
      logger.error({ err: error, event, source, clientId, ownerKey, targetChannelId }, 'Failed temp channel flow');
      if (clientId) await this.ts3.sendPrivateMessage(clientId, persianMessages.tempError()).catch(() => undefined);
    }
  }

  private async removeStaleMetadata(ownerKey: string): Promise<boolean> {
    const existing = await this.repository.getByOwner('temp', ownerKey);
    if (!existing) return false;
    if (await this.ts3.channelExists(existing.channelId)) return false;
    logger.warn({ channelId: existing.channelId, ownerKey }, 'Removing stale temp channel metadata');
    await this.repository.deleteRecord(existing);
    await this.store.del(this.rateKey(ownerKey), this.lockKey(ownerKey));
    return true;
  }

  private async createManagedTempChannel(ownerKey: string, rawName: string, password: string, skipRateLimit: boolean): Promise<ManagedChannelRecord> {
    const channelName = sanitizeChannelName(rawName, 40);
    if (this.blacklist.hasBlacklistedTerm(channelName)) throw new Error('Channel name contains blacklisted term');
    if (!/^\d{4}$/.test(password)) throw new Error('Temporary channel password must be exactly 4 digits');
    if (!skipRateLimit) {
      const current = await this.store.incr(this.rateKey(ownerKey));
      if (current === 1) await this.store.expire(this.rateKey(ownerKey), env.RATE_LIMIT_WINDOW_SEC);
      if (current > 1) { logger.warn({ ownerKey }, 'Temp channel creation rate limited'); throw new Error('Rate limit exceeded'); }
    }
    const channelId = await this.ts3.createTempChannel({ name: channelName, parentId: env.TS3_PARENT_CHANNEL_ID, password, topic: TEMP_MARKER, description: TEMP_MARKER });
    const now = Date.now();
    const record: ManagedChannelRecord = { type: 'temp', ownerKey, channelId, channelName, password, createdAt: now, lastSeenAt: now, marker: TEMP_MARKER, version: '1' };
    await this.repository.setManagedChannel(record);
    this.metrics.createdChannels += 1;
    return record;
  }

  async create(ownerKey: string, rawName: string, password = makeTempPassword()): Promise<TempChannelRecord> {
    if (!featureFlags.tempChannelLifecycle) throw new Error('Temp channel lifecycle feature is disabled');
    const record = await this.createManagedTempChannel(ownerKey, rawName, password, false);
    return this.toLegacy(record);
  }

  async listActive(): Promise<TempChannelRecord[]> { return (await this.repository.listManagedChannels()).map((record) => this.toLegacy(record)); }

  async close(channelId: string): Promise<void> {
    const record = await this.repository.findByChannelId(channelId);
    if (!record) throw new Error('Refusing to delete unmanaged channel');
    if (await this.ts3.channelExists(channelId)) await this.ts3.deleteChannel(channelId);
    await this.repository.deleteRecord(record);
    this.metrics.deletedChannels += 1;
  }

  async cleanupEmptyChannels(): Promise<number> {
    if (!featureFlags.automationRecovery && !featureFlags.tempChannelLifecycle) return 0;
    const active = await this.repository.listManagedChannels();
    let deleted = 0;
    logger.debug({ count: active.length }, 'Scanning managed channels for empty cleanup');
    for (const record of active) {
      try {
        if (!(await this.ts3.channelExists(record.channelId))) { await this.repository.deleteRecord(record); logger.warn({ channelId: record.channelId }, 'Removed metadata for missing managed channel'); continue; }
        const count = await this.ts3.getChannelClientCount(record.channelId);
        if (count === 0) {
          const emptySince = record.emptySince ?? Date.now();
          if (!record.emptySince) await this.repository.markEmpty(record.channelId);
          if (Date.now() - emptySince >= env.EMPTY_DELETE_DELAY_SEC * 1000) { await this.close(record.channelId); deleted += 1; logger.info({ channelId: record.channelId, type: record.type }, 'Deleted empty managed channel'); }
        } else if (record.emptySince) { await this.repository.clearEmpty(record.channelId); logger.info({ channelId: record.channelId, type: record.type }, 'Cancelled managed channel deletion because channel is occupied'); }
      } catch (error) { logger.warn({ err: error, channelId: record.channelId, type: record.type }, 'Managed channel cleanup failed'); }
    }
    return deleted;
  }

  async cleanupOrphans(): Promise<number> { return 0; }

  async getActiveChannelForOwner(ownerKey: string): Promise<string | null> { return (await this.repository.getByOwner('ticket', ownerKey))?.channelId ?? (await this.repository.getByOwner('temp', ownerKey))?.channelId ?? null; }
  async getActiveRecordForOwner(ownerKey: string): Promise<TempChannelRecord | null> { const record = await this.repository.getByOwner('temp', ownerKey); return record ? this.toLegacy(record) : null; }
  async attachTicketChannel(ownerKey: string, channelId: string, channelName = channelId): Promise<void> { const now = Date.now(); await this.repository.setManagedChannel({ type: 'ticket', ownerKey, channelId, channelName, createdAt: now, lastSeenAt: now, marker: '[TICKET_CH] managed-by-bot', version: '1' }); this.metrics.activeTickets += 1; this.metrics.createdChannels += 1; }
  private toLegacy(record: ManagedChannelRecord): TempChannelRecord { return { channelId: record.channelId, ownerKey: record.ownerKey, createdAt: record.createdAt, lastEmptyAt: record.emptySince ?? 0, kind: record.type, password: record.password }; }
}
