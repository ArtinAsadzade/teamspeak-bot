import { randomUUID } from 'node:crypto';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { EventBus } from '../../core/eventBus';
import { TempChannelService } from '../tempChannels/service';
import { TS3Client } from '../../ts3/TS3Client';

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
      const targetChannelId = String(event.targetChannelId);
      const supportLobbyChannelId = String(env.SUPPORT_LOBBY_CHANNEL_ID);
      const leader = isLeader();
      logger.info(
        { event, targetChannelId, supportLobbyChannelId, isLeader: leader },
        'TicketService received clientmoved event'
      );
      if (!leader) {
        logger.info(
          { event, targetChannelId, supportLobbyChannelId, isLeader: leader },
          'TicketService ignored clientmoved event because this node is not leader'
        );
        return;
      }
      if (targetChannelId !== supportLobbyChannelId) {
        logger.info(
          { event, targetChannelId, supportLobbyChannelId, isLeader: leader },
          'TicketService ignored clientmoved event because target channel is not the support lobby'
        );
        return;
      }
      const shortId = randomUUID().split('-')[0];
      const name = `ticket-${safe(event.nickname)}-${shortId}`;
      try {
        const channelId = await this.ts3.createChannel({
          name,
          parentId: String(env.SUPPORT_PARENT_CHANNEL_ID),
          topic: '[TICKET_CH]',
          description: '[TICKET_CH] managed-by-bot'
        });
        await this.tempChannels.attachTicketChannel(`ticket:${String(event.clientDbId)}`, channelId);
        await this.ts3.moveClient(String(event.clientId), channelId);
        await this.ts3.sendStaffNotification(`New support ticket created: ${name}`);
        logger.info(
          { event, channelId, channelName: name, supportParentChannelId: String(env.SUPPORT_PARENT_CHANNEL_ID) },
          'Ticket channel created and client moved successfully'
        );
      } catch (error) {
        logger.error({ err: error, error, event, targetChannelId, supportLobbyChannelId }, 'Failed ticket flow');
      }
    });
  }
}
