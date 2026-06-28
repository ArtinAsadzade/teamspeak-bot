import { randomUUID } from 'node:crypto';
import { env } from '../../config/env';
import { featureFlags } from '../../config/featureFlags';
import { logger } from '../../config/logger';
import { EventBus } from '../../core/eventBus';
import { KVStore } from '../../core/store';
import { persianMessages } from '../messages/fa';
import { TempChannelService, selectOwnerKey } from '../tempChannels/service';
import { TS3Client } from '../../ts3/TS3Client';

const normalizeId = (value: unknown): string => String(value ?? '').trim();
const TICKET_MARKER = '[TICKET_CH] managed-by-bot';
const safe = (s?: string): string => (s ?? 'user').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 16) || 'user';

export class TicketService {
  constructor(private readonly bus: EventBus, private readonly tempChannels: TempChannelService, private readonly ts3: TS3Client, private readonly store: KVStore) {}

  private lockKey(ownerKey: string) { return `managed:lock:ticket:${ownerKey}`; }

  init(isLeader: () => boolean): void { if (!featureFlags.supportTickets) { logger.info('Support tickets feature is disabled; handlers were not registered'); return; } this.bus.on('clientmoved', async (event) => this.handleClientMoved(event, isLeader, 'event')); }

  async processWaitingLobbyClients(isLeader: () => boolean): Promise<void> {
    if (!featureFlags.supportTickets || !isLeader()) return;
    for (const supportLobbyChannelId of env.SUPPORT_LOBBY_CHANNEL_IDS) {
      const clients = await this.ts3.listClientsInChannel(supportLobbyChannelId);
      logger.debug({ supportLobbyChannelId, clientCount: clients.length }, 'Scanned support lobby for waiting clients');
      for (const client of clients) await this.handleClientMoved({ clientId: client.clientId, clientDbId: client.clientDbId, targetChannelId: client.channelId, nickname: client.nickname }, isLeader, 'lobby-scan');
    }
  }

  private async handleClientMoved(event: { clientId: string; clientDbId: string; targetChannelId: string; invokerName?: string; nickname?: string }, isLeader: () => boolean, source: 'event' | 'lobby-scan'): Promise<void> {
    const targetChannelId = normalizeId(event.targetChannelId);
    const clientId = normalizeId(event.clientId);
    const ownerId = selectOwnerKey(event.clientDbId, clientId);
    const ownerKey = `ticket:${ownerId}`;
    if (!isLeader() || !env.SUPPORT_LOBBY_CHANNEL_ID_SET.has(targetChannelId)) return;
    if (!clientId || !ownerId) { logger.warn({ event, source }, 'Ticket flow ignored because client or owner id is missing'); return; }

    const locked = await this.store.setIfNotExists(this.lockKey(ownerKey), source, 5);
    if (!locked) { logger.debug({ source, clientId, ownerKey }, 'Ticket flow skipped because owner lock is held'); return; }

    try {
      const activeChannelId = await this.tempChannels.getActiveChannelForOwner(ownerKey);
      if (activeChannelId) {
        if (await this.ts3.channelExists(activeChannelId)) {
          await this.ts3.moveClient(clientId, activeChannelId);
          await this.ts3.sendPrivateMessage(clientId, persianMessages.ticketReused());
          logger.info({ source, clientId, channelId: activeChannelId, ownerKey }, 'Ticket channel reused and user moved');
          return;
        }
        logger.warn({ channelId: activeChannelId, ownerKey }, 'Ticket metadata is stale; recreating ticket');
        await this.tempChannels.close(activeChannelId).catch(() => undefined);
      }

      const channelName = `ticket-${safe(event.nickname)}-${randomUUID().split('-')[0]}`;
      const channelId = await this.ts3.createTicketChannel({ name: channelName, parentId: env.SUPPORT_PARENT_CHANNEL_ID, topic: TICKET_MARKER, description: TICKET_MARKER });
      await this.tempChannels.attachTicketChannel(ownerKey, channelId, channelName);
      await this.ts3.moveClient(clientId, channelId);
      await this.ts3.sendPrivateMessage(clientId, persianMessages.ticketCreated());
      await this.ts3.sendStaffNotification(persianMessages.staffTicketNotification({ nickname: event.nickname ?? clientId, channelName }));
      logger.info({ source, channelId, clientId, channelName, supportParentChannelId: env.SUPPORT_PARENT_CHANNEL_ID, ownerKey }, 'Ticket channel created and user moved');
    } catch (error) {
      logger.error({ err: error, event, source, clientId, ownerKey, targetChannelId }, 'Failed ticket flow');
      if (clientId) await this.ts3.sendPrivateMessage(clientId, persianMessages.ticketError()).catch(() => undefined);
    }
  }
}
