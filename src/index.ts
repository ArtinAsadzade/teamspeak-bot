import { buildApiServer } from './api/server';
import { env } from './config/env';
import { logger } from './config/logger';
import { EventBus } from './core/eventBus';
import { LeaderElection } from './core/leaderElection';
import { Metrics } from './core/metrics';
import { createStore } from './core/store';
import { BlacklistService } from './features/moderation/blacklist';
import { ModerationService } from './features/moderation/service';
import { TempChannelService } from './features/tempChannels/service';
import { TicketService } from './features/tickets/service';
import { Scheduler } from './jobs/scheduler';
import { TS3Client } from './ts3/TS3Client';

async function bootstrap(): Promise<void> {
  logger.info(
    {
      supportLobbyChannelIds: env.SUPPORT_LOBBY_CHANNEL_IDS,
      tempLobbyChannelIds: env.TEMP_LOBBY_CHANNEL_IDS,
      supportParentChannelId: String(env.SUPPORT_PARENT_CHANNEL_ID),
      ts3ParentChannelId: String(env.TS3_PARENT_CHANNEL_ID),
      staffNotifyTargetMode: env.STAFF_NOTIFY_TARGET_MODE,
      maxActiveChannelsPerOwner: env.MAX_ACTIVE_CHANNELS_PER_OWNER,
      emptyDeleteDelaySec: env.EMPTY_DELETE_DELAY_SEC
    },
    'Startup TeamSpeak channel configuration'
  );
  const store = await createStore();
  const eventBus = new EventBus();
  const metrics = new Metrics();
  const leader = new LeaderElection(store);
  const blacklist = new BlacklistService();
  const ts3 = new TS3Client(eventBus, metrics);
  await ts3.connect();

  const tempChannels = new TempChannelService(store, ts3, blacklist, metrics, eventBus);
  const moderation = new ModerationService(eventBus, store);
  moderation.init();

  const tickets = new TicketService(eventBus, tempChannels, ts3, store);
  tickets.init(() => leader.isLeader());
  tempChannels.init(() => leader.isLeader());

  const scheduler = new Scheduler();
  scheduler.everyTick('leader-election', async () => {
    await leader.tick();
  });
  scheduler.everyTick('support-lobby-ticket-scan', async () => {
    if (!leader.isLeader()) return;
    await tickets.processWaitingLobbyClients(() => leader.isLeader());
    await tempChannels.processWaitingLobbyClients(() => leader.isLeader());
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
    health: () => ({ ok: true }),
    readiness: async () => {
      let redis = false;
      try {
        redis = (await store.ping()) === 'PONG';
      } catch {
        redis = false;
      }
      const ts3Connected = ts3.isReady() || ts3.hadSuccessfulConnect();
      const leaderKnown = leader.status().isLeader;
      return {
        ready: redis && ts3Connected,
        redis,
        ts3: ts3Connected,
        leader: leaderKnown
      };
    }
  });

  await app.listen({ host: '0.0.0.0', port: env.PORT });
  logger.info({ port: env.PORT }, 'API server started');

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
