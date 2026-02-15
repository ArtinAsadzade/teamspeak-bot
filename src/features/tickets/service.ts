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
      if (!isLeader()) return;
      if (event.targetChannelId !== env.SUPPORT_LOBBY_CHANNEL_ID) return;
      const shortId = randomUUID().split('-')[0];
      const name = `ticket-${safe(event.nickname)}-${shortId}`;
      try {
        const channelId = await this.ts3.createChannel({
          name,
          parentId: env.SUPPORT_PARENT_CHANNEL_ID,
          topic: '[TICKET_CH]',
          description: '[TICKET_CH] managed-by-bot'
        });
        await this.tempChannels.attachTicketChannel(`ticket:${event.clientDbId}`, channelId);
        await this.ts3.moveClient(event.clientId, channelId);
        await this.ts3.sendStaffNotification(`New support ticket created: ${name}`);
      } catch (error) {
        logger.error({ err: error, event }, 'Failed ticket flow');
      }
    });
  }
}
