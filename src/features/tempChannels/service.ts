import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { Metrics } from '../../core/metrics';
import { KVStore } from '../../core/store';
import { TS3Client } from '../../ts3/TS3Client';
import { sanitizeChannelName } from '../../utils/text';
import { BlacklistService } from '../moderation/blacklist';

const TMP_SET = 'tmp:channels';

export interface TempChannelRecord {
  channelId: string;
  ownerKey: string;
  createdAt: number;
  lastEmptyAt: number;
  kind: 'tmp' | 'ticket';
}

export class TempChannelService {
  constructor(
    private readonly store: KVStore,
    private readonly ts3: TS3Client,
    private readonly blacklist: BlacklistService,
    private readonly metrics: Metrics
  ) {}

  private ownerKey(ownerKey: string) { return `tmp:owner:${ownerKey}`; }
  private channelKey(channelId: string) { return `tmp:channel:${channelId}`; }

  async create(ownerKey: string, rawName: string, password?: string): Promise<TempChannelRecord> {
    const name = sanitizeChannelName(rawName, 40);
    if (this.blacklist.hasBlacklistedTerm(name)) throw new Error('Channel name contains blacklisted term');

    const rateKey = `tmp:rate:${ownerKey}`;
    const current = await this.store.incr(rateKey);
    if (current === 1) await this.store.expire(rateKey, env.RATE_LIMIT_WINDOW_SEC);
    if (current > 1) throw new Error('Rate limit exceeded');

    const activeChannel = await this.store.get(this.ownerKey(ownerKey));
    if (activeChannel && env.MAX_ACTIVE_CHANNELS_PER_OWNER <= 1) throw new Error('Owner already has active channel');

    const channelId = await this.ts3.createChannel({
      name,
      parentId: env.TS3_PARENT_CHANNEL_ID,
      password,
      topic: '[TMP_CH]',
      description: '[TMP_CH] managed-by-bot'
    });

    const rec: TempChannelRecord = { channelId, ownerKey, createdAt: Date.now(), lastEmptyAt: 0, kind: 'tmp' };
    await this.store.set(this.ownerKey(ownerKey), channelId);
    await this.store.hset(this.channelKey(channelId), {
      ownerKey,
      createdAt: String(rec.createdAt),
      lastEmptyAt: '0',
      kind: rec.kind
    });
    await this.store.sadd(TMP_SET, channelId);
    this.metrics.createdChannels += 1;
    return rec;
  }

  async listActive(): Promise<TempChannelRecord[]> {
    const ids = await this.store.smembers(TMP_SET);
    const rows = await Promise.all(ids.map((id) => this.store.hgetall(this.channelKey(id))));
    return rows
      .map((row, i) => ({
        channelId: ids[i],
        ownerKey: row.ownerKey,
        createdAt: Number(row.createdAt),
        lastEmptyAt: Number(row.lastEmptyAt ?? 0),
        kind: (row.kind as 'tmp' | 'ticket') ?? 'tmp'
      }))
      .filter((r) => r.ownerKey);
  }

  async close(channelId: string): Promise<void> {
    const row = await this.store.hgetall(this.channelKey(channelId));
    await this.ts3.deleteChannel(channelId);
    await this.store.srem(TMP_SET, channelId);
    await this.store.del(this.channelKey(channelId));
    if (row.ownerKey) await this.store.del(this.ownerKey(row.ownerKey));
    this.metrics.deletedChannels += 1;
  }

  async markEmpty(channelId: string): Promise<void> {
    await this.store.hset(this.channelKey(channelId), { lastEmptyAt: String(Date.now()) });
  }

  async markOccupied(channelId: string): Promise<void> {
    await this.store.hset(this.channelKey(channelId), { lastEmptyAt: '0' });
  }

  async cleanupEmptyChannels(): Promise<number> {
    const active = await this.listActive();
    let deleted = 0;
    for (const rec of active) {
      try {
        const count = await this.ts3.getChannelClientCount(rec.channelId);
        if (count === 0) {
          const lastEmptyAt = rec.lastEmptyAt || Date.now();
          if (!rec.lastEmptyAt) await this.markEmpty(rec.channelId);
          if (Date.now() - lastEmptyAt >= env.EMPTY_DELETE_DELAY_SEC * 1000) {
            await this.close(rec.channelId);
            deleted += 1;
          }
        } else if (rec.lastEmptyAt > 0) {
          await this.markOccupied(rec.channelId);
        }
      } catch (error) {
        logger.warn({ err: error, channelId: rec.channelId }, 'Failed cleanup for channel');
      }
    }
    return deleted;
  }

  async cleanupOrphans(): Promise<number> {
    const active = await this.listActive();
    let removed = 0;
    for (const rec of active) {
      const ownerMapping = await this.store.get(this.ownerKey(rec.ownerKey));
      if (ownerMapping !== rec.channelId) {
        await this.close(rec.channelId);
        removed += 1;
      }
    }
    return removed;
  }

  async attachTicketChannel(ownerKey: string, channelId: string): Promise<void> {
    const rec: TempChannelRecord = { channelId, ownerKey, createdAt: Date.now(), lastEmptyAt: 0, kind: 'ticket' };
    await this.store.set(this.ownerKey(ownerKey), channelId);
    await this.store.hset(this.channelKey(channelId), {
      ownerKey,
      createdAt: String(rec.createdAt),
      lastEmptyAt: '0',
      kind: 'ticket'
    });
    await this.store.sadd(TMP_SET, channelId);
    this.metrics.activeTickets += 1;
    this.metrics.createdChannels += 1;
  }
}
