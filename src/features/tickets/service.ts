import { randomUUID } from 'node:crypto';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { EventBus } from '../../core/eventBus';
import { TempChannelService } from '../tempChannels/service';
import { TS3Client } from '../../ts3/TS3Client';

const normalizeId = (value: unknown): string => String(value ?? '').trim();

const safe = (s?: string): string =>
  (s ?? 'user')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 16) || 'user';

export class TicketService {
  constructor(private readonly bus: EventBus, private readonly tempChannels: TempChannelService, private readonly ts3: TS3Client) {}

  init(isLeader: () => boolean): void {
    this.bus.on('clientmoved', async (event) => {
      await this.handleClientMoved(event, isLeader, 'event');
    });
  }

  async processWaitingLobbyClients(isLeader: () => boolean): Promise<void> {
    if (!isLeader()) return;

    for (const supportLobbyChannelId of env.SUPPORT_LOBBY_CHANNEL_IDS) {
      const clients = await this.ts3.listClientsInChannel(supportLobbyChannelId);
      logger.debug({ supportLobbyChannelId, clientCount: clients.length }, 'TicketService scanned support lobby for waiting clients');
      for (const client of clients) {
        await this.handleClientMoved(
          {
            clientId: client.clientId,
            clientDbId: client.clientDbId,
            targetChannelId: client.channelId,
            nickname: client.nickname
          },
          isLeader,
          'lobby-scan'
        );
      }
    }
  }

  private async handleClientMoved(
    event: { clientId: string; clientDbId: string; targetChannelId: string; invokerName?: string; nickname?: string },
    isLeader: () => boolean,
    source: 'event' | 'lobby-scan'
  ): Promise<void> {
    const targetChannelId = normalizeId(event.targetChannelId);
    const supportLobbyChannelIds = env.SUPPORT_LOBBY_CHANNEL_IDS;
    const supportParentChannelId = normalizeId(env.SUPPORT_PARENT_CHANNEL_ID);
    const clientId = normalizeId(event.clientId);
    const clientDbId = normalizeId(event.clientDbId || event.clientId);
    const ownerKey = `ticket:${clientDbId || clientId}`;
    const leader = isLeader();

    logger.debug(
      { event, source, targetChannelId, supportLobbyChannelIds, isLeader: leader },
      'TicketService received clientmoved event'
    );

    if (!leader) {
      logger.debug(
        { event, source, targetChannelId, supportLobbyChannelIds, isLeader: leader },
        'TicketService ignored clientmoved event because this node is not leader'
      );
      return;
    }

    if (!env.SUPPORT_LOBBY_CHANNEL_ID_SET.has(targetChannelId)) {
      logger.debug(
        { event, source, targetChannelId, supportLobbyChannelIds, isLeader: leader },
        'TicketService ignored clientmoved event because target channel is not the support lobby'
      );
      return;
    }

    if (!clientId) {
      logger.warn({ event, source }, 'TicketService cannot create ticket because clientId is missing');
      return;
    }

    try {
      const activeChannelId = await this.tempChannels.getActiveChannelForOwner(ownerKey);
      if (activeChannelId && env.MAX_ACTIVE_CHANNELS_PER_OWNER <= 1) {
        await this.ts3.moveClient(clientId, activeChannelId);
        logger.info({ event, source, clientId, channelId: activeChannelId, ownerKey }, 'Ticket channel reused and client moved');
        return;
      }

      const shortId = randomUUID().split('-')[0];
      const name = `ticket-${safe(event.nickname)}-${shortId}`;
      const channelId = await this.ts3.createChannel({
        name,
        parentId: supportParentChannelId,
        topic: '[TICKET_CH]',
        description: '[TICKET_CH] managed-by-bot'
      });
      await this.tempChannels.attachTicketChannel(ownerKey, channelId);
      await this.ts3.moveClient(clientId, channelId);
      await this.ts3.sendStaffNotification(`New support ticket created: ${name}`);
      logger.info(
        { event, source, channelId, clientId, channelName: name, supportParentChannelId, ownerKey },
        'Ticket channel created and client moved successfully'
      );
    } catch (error) {
      logger.error(
        { err: error, error, event, source, clientId, ownerKey, targetChannelId, supportLobbyChannelIds, supportParentChannelId },
        'Failed ticket flow with TeamSpeak error'
      );
    }
  }
}
