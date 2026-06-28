import { KVStore } from '../store';

export type ManagedChannelType = 'temp' | 'ticket';

export interface ManagedChannelRecord {
  type: ManagedChannelType;
  ownerKey: string;
  channelId: string;
  channelName: string;
  password?: string;
  createdAt: number;
  lastSeenAt: number;
  emptySince?: number;
  marker: string;
  version: string;
}

const ALL = 'managed:channels';
const ownerKey = (type: ManagedChannelType, owner: string) => `managed:owner:${type}:${owner}`;
const channelKey = (channelId: string) => `managed:channel:${channelId}`;

const toHash = (record: ManagedChannelRecord): Record<string, string> => ({
  type: record.type,
  ownerKey: record.ownerKey,
  channelId: record.channelId,
  channelName: record.channelName,
  password: record.password ?? '',
  createdAt: String(record.createdAt),
  lastSeenAt: String(record.lastSeenAt),
  emptySince: record.emptySince ? String(record.emptySince) : '',
  marker: record.marker,
  version: record.version
});

const fromHash = (row: Record<string, string>): ManagedChannelRecord | null => {
  if (!row.channelId || !row.ownerKey || (row.type !== 'temp' && row.type !== 'ticket')) return null;
  return {
    type: row.type,
    ownerKey: row.ownerKey,
    channelId: row.channelId,
    channelName: row.channelName || row.channelId,
    password: row.password || undefined,
    createdAt: Number(row.createdAt || Date.now()),
    lastSeenAt: Number(row.lastSeenAt || row.createdAt || Date.now()),
    emptySince: row.emptySince ? Number(row.emptySince) : undefined,
    marker: row.marker || '',
    version: row.version || '1'
  };
};

export class ManagedChannelRepository {
  constructor(private readonly store: KVStore) {}

  async getByOwner(type: ManagedChannelType, owner: string): Promise<ManagedChannelRecord | null> {
    const channelId = await this.store.get(ownerKey(type, owner));
    return channelId ? this.findByChannelId(channelId) : null;
  }

  async setManagedChannel(record: ManagedChannelRecord): Promise<void> {
    await this.store.set(ownerKey(record.type, record.ownerKey), record.channelId);
    await this.store.hset(channelKey(record.channelId), toHash(record));
    await this.store.sadd(ALL, record.channelId);
  }

  async deleteByOwner(type: ManagedChannelType, owner: string): Promise<void> {
    const existing = await this.getByOwner(type, owner);
    if (!existing) return;
    await this.deleteRecord(existing);
  }

  async deleteRecord(record: ManagedChannelRecord): Promise<void> {
    await this.store.srem(ALL, record.channelId);
    await this.store.del(channelKey(record.channelId), ownerKey(record.type, record.ownerKey));
  }

  async listManagedChannels(): Promise<ManagedChannelRecord[]> {
    const ids = await this.store.smembers(ALL);
    const rows = await Promise.all(ids.map((id) => this.store.hgetall(channelKey(id))));
    return rows.map(fromHash).filter((row): row is ManagedChannelRecord => Boolean(row));
  }

  async markEmpty(channelId: string): Promise<void> { await this.store.hset(channelKey(channelId), { emptySince: String(Date.now()) }); }
  async clearEmpty(channelId: string): Promise<void> { await this.store.hset(channelKey(channelId), { emptySince: '', lastSeenAt: String(Date.now()) }); }
  async findByChannelId(channelId: string): Promise<ManagedChannelRecord | null> { return fromHash(await this.store.hgetall(channelKey(channelId))); }
}
