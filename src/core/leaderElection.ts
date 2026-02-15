import { randomUUID } from 'node:crypto';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { KVStore } from './store';

const LOCK_KEY = 'leader:lock';

export class LeaderElection {
  private readonly id = randomUUID();
  private isLeaderNow = false;

  constructor(private readonly store: KVStore) {}

  async tick(): Promise<boolean> {
    const existing = await this.store.get(LOCK_KEY);
    if (!existing || existing === this.id) {
      await this.store.set(LOCK_KEY, this.id, env.LEADER_LOCK_TTL_SEC);
      if (!this.isLeaderNow) logger.info('Node became leader');
      this.isLeaderNow = true;
      return true;
    }
    if (this.isLeaderNow) logger.warn('Node lost leadership');
    this.isLeaderNow = false;
    return false;
  }

  isLeader(): boolean {
    return this.isLeaderNow;
  }

  status(): { isLeader: boolean; nodeId: string } {
    return { isLeader: this.isLeaderNow, nodeId: this.id };
  }
}
