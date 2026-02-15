import { buildApiServer } from './api/server';
import { env } from './config/env';
import { logger } from './config/logger';
import { EventBus } from './core/eventBus';
import { LeaderElection } from './core/leaderElection';
import { Metrics } from './core/metrics';
import { createStore } from './core/store';
import { ModerationService } from './features/moderation/service';
import { BlacklistService } from './features/moderation/blacklist';
import { TempChannelService } from './features/tempChannels/service';
import { TicketService } from './features/tickets/service';
import { Scheduler } from './jobs/scheduler';
import { TS3Client } from './ts3/TS3Client';

async function bootstrap(): Promise<void> {
  const store = await createStore();
  const eventBus = new EventBus();
  const metrics = new Metrics();
  const leader = new LeaderElection(store);
  const blacklist = new BlacklistService();
  const ts3 = new TS3Client(eventBus, metrics);
  await ts3.connect();

  const tempChannels = new TempChannelService(store, ts3, blacklist, metrics);
  const moderation = new ModerationService(eventBus, store);
  moderation.init();

  const tickets = new TicketService(eventBus, tempChannels, ts3);
  tickets.init(() => leader.isLeader());

  const scheduler = new Scheduler();
  scheduler.everyTick('leader-election', async () => {
    await leader.tick();
  });
  scheduler.everyTick('cleanup-empty-channels', async () => {
    if (!leader.isLeader()) return;
    await tempChannels.cleanupEmptyChannels();
  });

  const app = await buildApiServer({
    tempChannels,
    moderation,
    blacklist,
    metrics,
    leader,
    health: () => ({ ready: ts3.isReady(), leader: leader.isLeader() })
  });

  await app.listen({ host: '0.0.0.0', port: env.API_PORT });
  logger.info({ port: env.API_PORT }, 'API server started');

  process.on('SIGTERM', async () => {
    scheduler.stop();
    await app.close();
    process.exit(0);
  });
}

bootstrap().catch((error) => {
  logger.error({ err: error }, 'Fatal bootstrap error');
  process.exit(1);
});
