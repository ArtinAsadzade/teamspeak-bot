import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { EventBus } from '../../core/eventBus';
import { KVStore } from '../../core/store';

const RECENT_EVENTS = 'events:recent';

export class ModerationService {
  constructor(private readonly bus: EventBus, private readonly store: KVStore) {}

  init(): void {
    this.bus.on('clientmoved', async (event) => {
      const key = `spam:switch:${event.clientDbId}`;
      const count = await this.store.incr(key);
      if (count === 1) await this.store.expire(key, env.SPAM_WINDOW_SEC);
      if (count >= env.SPAM_SWITCH_THRESHOLD) {
        logger.warn({ event, count }, 'Potential channel switch spam detected');
      }
      await this.pushEvent('clientmoved', event);
    });
    this.bus.on('clientconnect', async (event) => this.pushEvent('clientconnect', event));
    this.bus.on('clientdisconnect', async (event) => this.pushEvent('clientdisconnect', event));
  }

  private async pushEvent(type: string, payload: Record<string, string | undefined>): Promise<void> {
    await this.store.lpush(
      RECENT_EVENTS,
      JSON.stringify({ type, payload, at: new Date().toISOString() })
    );
    await this.store.ltrim(RECENT_EVENTS, 0, 199);
  }

  async recent(limit = 50): Promise<unknown[]> {
    const rows = await this.store.lrange(RECENT_EVENTS, 0, Math.max(0, limit - 1));
    return rows.map((r) => JSON.parse(r));
  }
}
