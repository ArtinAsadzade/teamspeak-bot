import Redis from 'ioredis';
import { env } from '../config/env';
import { logger } from '../config/logger';

type Primitive = string | null;

export interface KVStore {
  get(key: string): Promise<Primitive>;
  set(key: string, value: string, ttlSec?: number): Promise<void>;
  setIfNotExists(key: string, value: string, ttlSec: number): Promise<boolean>;
  del(...keys: string[]): Promise<number>;
  exists(key: string): Promise<boolean>;
  incr(key: string): Promise<number>;
  expire(key: string, ttlSec: number): Promise<void>;
  hset(key: string, values: Record<string, string>): Promise<void>;
  hgetall(key: string): Promise<Record<string, string>>;
  sadd(key: string, member: string): Promise<void>;
  srem(key: string, member: string): Promise<void>;
  smembers(key: string): Promise<string[]>;
  lpush(key: string, value: string): Promise<void>;
  ltrim(key: string, start: number, stop: number): Promise<void>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  ping(): Promise<string>;
}

class InMemoryStore implements KVStore {
  private data = new Map<string, string>();
  private hashes = new Map<string, Map<string, string>>();
  private sets = new Map<string, Set<string>>();
  private lists = new Map<string, string[]>();
  private expiries = new Map<string, number>();

  private cleanup(key: string): void {
    const expiry = this.expiries.get(key);
    if (expiry && Date.now() > expiry) {
      this.data.delete(key);
      this.hashes.delete(key);
      this.sets.delete(key);
      this.lists.delete(key);
      this.expiries.delete(key);
    }
  }

  async get(key: string): Promise<Primitive> {
    this.cleanup(key);
    return this.data.get(key) ?? null;
  }
  async set(key: string, value: string, ttlSec?: number): Promise<void> {
    this.data.set(key, value);
    if (ttlSec) this.expiries.set(key, Date.now() + ttlSec * 1000);
  }
  async setIfNotExists(key: string, value: string, ttlSec: number): Promise<boolean> {
    this.cleanup(key);
    if (await this.exists(key)) return false;
    await this.set(key, value, ttlSec);
    return true;
  }
  async del(...keys: string[]): Promise<number> {
    let n = 0;
    keys.forEach((k) => {
      const existed = this.data.delete(k) || this.hashes.delete(k) || this.sets.delete(k) || this.lists.delete(k);
      this.expiries.delete(k);
      if (existed) n += 1;
    });
    return n;
  }
  async exists(key: string): Promise<boolean> {
    this.cleanup(key);
    return this.data.has(key) || this.hashes.has(key) || this.sets.has(key) || this.lists.has(key);
  }
  async incr(key: string): Promise<number> {
    const current = Number((await this.get(key)) ?? 0) + 1;
    await this.set(key, String(current));
    return current;
  }
  async expire(key: string, ttlSec: number): Promise<void> {
    this.expiries.set(key, Date.now() + ttlSec * 1000);
  }
  async hset(key: string, values: Record<string, string>): Promise<void> {
    const hash = this.hashes.get(key) ?? new Map<string, string>();
    Object.entries(values).forEach(([k, v]) => hash.set(k, v));
    this.hashes.set(key, hash);
  }
  async hgetall(key: string): Promise<Record<string, string>> {
    return Object.fromEntries((this.hashes.get(key) ?? new Map()).entries());
  }
  async sadd(key: string, member: string): Promise<void> {
    const set = this.sets.get(key) ?? new Set<string>();
    set.add(member);
    this.sets.set(key, set);
  }
  async srem(key: string, member: string): Promise<void> {
    this.sets.get(key)?.delete(member);
  }
  async smembers(key: string): Promise<string[]> {
    return [...(this.sets.get(key) ?? new Set<string>())];
  }
  async lpush(key: string, value: string): Promise<void> {
    const list = this.lists.get(key) ?? [];
    list.unshift(value);
    this.lists.set(key, list);
  }
  async ltrim(key: string, start: number, stop: number): Promise<void> {
    const list = this.lists.get(key) ?? [];
    this.lists.set(key, list.slice(start, stop + 1));
  }
  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const list = this.lists.get(key) ?? [];
    return list.slice(start, stop + 1);
  }
  async ping(): Promise<string> {
    return 'PONG';
  }
}

class RedisStore implements KVStore {
  constructor(private readonly redis: Redis) {}
  async get(key: string) { return this.redis.get(key); }
  async set(key: string, value: string, ttlSec?: number) {
    if (ttlSec) await this.redis.set(key, value, 'EX', ttlSec);
    else await this.redis.set(key, value);
  }
  async setIfNotExists(key: string, value: string, ttlSec: number) {
    return (await this.redis.set(key, value, 'EX', ttlSec, 'NX')) === 'OK';
  }
  async del(...keys: string[]) { return this.redis.del(...keys); }
  async exists(key: string) { return (await this.redis.exists(key)) === 1; }
  async incr(key: string) { return this.redis.incr(key); }
  async expire(key: string, ttlSec: number) { await this.redis.expire(key, ttlSec); }
  async hset(key: string, values: Record<string, string>) { await this.redis.hset(key, values); }
  async hgetall(key: string) { return this.redis.hgetall(key); }
  async sadd(key: string, member: string) { await this.redis.sadd(key, member); }
  async srem(key: string, member: string) { await this.redis.srem(key, member); }
  async smembers(key: string) { return this.redis.smembers(key); }
  async lpush(key: string, value: string) { await this.redis.lpush(key, value); }
  async ltrim(key: string, start: number, stop: number) { await this.redis.ltrim(key, start, stop); }
  async lrange(key: string, start: number, stop: number) { return this.redis.lrange(key, start, stop); }
  async ping(): Promise<string> { return this.redis.ping(); }
}

export async function createStore(): Promise<KVStore> {
  try {
    const redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: true
    });
    await redis.connect();
    logger.info('Redis connected');
    return new RedisStore(redis);
  } catch (error) {
    if (env.REDIS_FALLBACK_INMEMORY === 'true' && env.NODE_ENV !== 'production') {
      logger.warn({ err: error }, 'Redis unavailable, fallback to in-memory store (non-production only)');
      return new InMemoryStore();
    }
    throw error;
  }
}
