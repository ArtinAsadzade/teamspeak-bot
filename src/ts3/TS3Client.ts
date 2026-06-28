import { TeamSpeak, TeamSpeakChannel, TeamSpeakClient as TeamSpeakQueryClient, TextMessageTargetMode } from 'ts3-nodejs-library';
import type { ChannelInfo } from 'ts3-nodejs-library/lib/types/ResponseTypes';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { EventBus } from '../core/eventBus';
import { Metrics } from '../core/metrics';
import { normalizeClientMovedEvent, normalizeStringId } from './events';

const firstString = normalizeStringId;

const getTeamSpeakErrorId = (error: unknown): string => {
  const err = error as { id?: unknown; error?: { id?: unknown }; response?: { id?: unknown }; data?: { id?: unknown }; message?: string };
  return firstString(err?.id, err?.error?.id, err?.response?.id, err?.data?.id, err?.message?.match?.(/(?:^|\D)(\d{3,5})(?:\D|$)/)?.[1]);
};

const isInvalidChannelIdError = (error: unknown): boolean => getTeamSpeakErrorId(error) === '768';

export interface TS3ChannelClient {
  clientId: string;
  clientDbId: string;
  nickname: string;
  channelId: string;
}

export class TS3Client {
  private ts3?: TeamSpeak;
  private reconnectTimer?: NodeJS.Timeout;
  private subscribed = false;
  private connecting = false;
  private connected = false;
  private hasConnectedOnce = false;

  constructor(private readonly bus: EventBus, private readonly metrics: Metrics) {}

  async connect(): Promise<void> {
    if (this.connecting) return;
    this.connecting = true;
    try {
      this.ts3 = await TeamSpeak.connect({
        host: env.TS3_HOST,
        queryport: env.TS3_QUERY_PORT,
        serverport: env.TS3_SERVER_PORT,
        username: env.TS3_USERNAME,
        password: env.TS3_PASSWORD,
        nickname: env.TS3_NICKNAME
      });
      this.connected = true;
      logger.info({ host: env.TS3_HOST, queryPort: env.TS3_QUERY_PORT, serverPort: env.TS3_SERVER_PORT, nickname: env.TS3_NICKNAME }, 'TS3 connect/login/select server succeeded');
      this.hasConnectedOnce = true;
      this.subscribed = false;
      await this.ensureSubscriptions();
      this.attachConnectionHandlers();
      logger.info('Connected to TeamSpeak ServerQuery');
    } catch (error) {
      this.connected = false;
      this.scheduleReconnect(error);
    } finally {
      this.connecting = false;
    }
  }

  private attachConnectionHandlers(): void {
    if (!this.ts3) return;
    this.ts3.removeAllListeners('close');
    this.ts3.removeAllListeners('flooding');
    this.ts3.on('close', () => {
      this.connected = false;
      this.scheduleReconnect(new Error('ts3 connection closed'));
    });
    this.ts3.on('flooding', () => logger.warn('TS3 flooding warning'));
  }

  private scheduleReconnect(error: unknown): void {
    logger.error({ err: error }, 'TS3 connection lost, scheduling reconnect');
    this.metrics.reconnects += 1;
    if (this.reconnectTimer) return;
    let delay = 1000;
    this.reconnectTimer = setInterval(async () => {
      try {
        await this.connect();
        if (this.ts3 && this.connected) {
          clearInterval(this.reconnectTimer);
          this.reconnectTimer = undefined;
        }
      } catch {
        delay = Math.min(delay * 2, 30000);
      }
    }, delay);
  }

  private async ensureSubscriptions(): Promise<void> {
    if (!this.ts3 || this.subscribed) return;
    logger.debug('Registering TS3 server event subscription');
    await this.ts3.registerEvent('server');
    logger.info('Registered TS3 server events');
    this.ts3.removeAllListeners('clientmoved');
    this.ts3.removeAllListeners('clientconnect');
    this.ts3.removeAllListeners('clientdisconnect');

    this.ts3.on('clientmoved', (event: any) => {
      logger.debug({ event }, 'Raw TS3 clientmoved event');
      const normalized = normalizeClientMovedEvent(event);
      if (!normalized) return;
      logger.debug(normalized, 'Normalized TS3 clientmoved event');
      this.bus.emit('clientmoved', normalized);
    });
    this.ts3.on('clientconnect', async (event: any) => {
      logger.debug({ event }, 'Raw TS3 clientconnect event');
      const clientId = firstString(event?.client?.clid, event.clid, event.clientId);
      let clientInfo: any;
      if (clientId) {
        try {
          const client = await this.ts3?.getClientById(clientId);
          clientInfo = await client?.getInfo();
        } catch (error) {
          logger.error({ err: error, event, clientId }, 'Failed to fetch TS3 client info after clientconnect');
        }
      }
      const normalized = {
        clientId,
        clientDbId: firstString(
          event?.client?.clientDatabaseId,
          event?.client?.client_database_id,
          event?.client?.cldbid,
          event.cldbid,
          event.client_database_id,
          event.clientDatabaseId,
          clientInfo?.clientDatabaseId,
          clientInfo?.client_database_id
        ),
        targetChannelId: firstString(
          event?.channel?.cid,
          event?.client?.cid,
          event.ctid,
          event.cid,
          event.channelId,
          event.clientTargetChannelId,
          event.client_channel_id,
          clientInfo?.cid,
          clientInfo?.channelId,
          clientInfo?.client_channel_id
        ),
        nickname: firstString(event?.client?.clientNickname, event?.client?.client_nickname, event?.client?.nickname, event.client_nickname, event.nickname, clientInfo?.clientNickname, clientInfo?.client_nickname)
      };
      logger.debug({ ...normalized, clientInfo }, 'Normalized TS3 clientconnect event');
      this.bus.emit('clientconnect', {
        clientDbId: normalized.clientDbId,
        nickname: normalized.nickname
      });
      if (normalized.clientId && normalized.targetChannelId) {
        this.bus.emit('clientmoved', normalized);
      } else {
        logger.warn({ event, normalized }, 'Not emitting synthetic clientmoved from clientconnect because clientId or targetChannelId is missing');
      }
    });
    this.ts3.on('clientdisconnect', (event: any) => {
      this.bus.emit('clientdisconnect', {
        clientDbId: firstString(event.cldbid, event.client_database_id, event.clientDatabaseId),
        nickname: firstString(event.client_nickname, event.nickname)
      });
    });
    this.subscribed = true;
  }

  isReady(): boolean {
    return this.connected;
  }

  hadSuccessfulConnect(): boolean {
    return this.hasConnectedOnce;
  }

  async createChannel(input: { name: string; parentId: string; password?: string; topic?: string; description?: string }): Promise<string> {
    return this.createTempChannel(input);
  }

  async createTempChannel(input: { name: string; parentId: string; password?: string; topic?: string; description?: string }): Promise<string> {
    if (!this.ts3) throw new Error('TS3 client not connected');
    const created = await this.ts3.channelCreate(input.name, {
      cpid: input.parentId,
      channelTopic: input.topic,
      channelDescription: input.description,
      channelFlagPermanent: false,
      channelFlagSemiPermanent: true
    });
    const channelId = String(created.cid);
    logger.info({ channelId, channelName: input.name }, 'Temp channel created');
    const info = await this.getChannelInfo(channelId);
    logger.info({ channelId, channelName: info?.channelName ?? input.name, channelFlagPassword: Boolean(info?.channelFlagPassword) }, 'Temp channel created and password status verified');
    return channelId;
  }

  async createTicketChannel(input: { name: string; parentId: string; topic?: string; description?: string }): Promise<string> {
    if (!this.ts3) throw new Error('TS3 client not connected');
    const created = await this.ts3.channelCreate(input.name, {
      cpid: input.parentId,
      channelTopic: input.topic,
      channelDescription: input.description,
      channelFlagPermanent: false,
      channelFlagSemiPermanent: true
    });
    const channelId = String(created.cid);
    const info = await this.getChannelInfo(channelId);
    logger.info({ channelId, channelName: info?.channelName ?? input.name, channelFlagPassword: Boolean(info?.channelFlagPassword) }, 'Ticket channel created and verified');
    return channelId;
  }

  async setChannelPassword(channelId: string, password: string): Promise<void> {
    if (!this.ts3) throw new Error('TS3 client not connected');
    await this.ts3.channelEdit(channelId, { channelPassword: password });
    await this.verifyChannelPasswordFlag(channelId);
  }

  async verifyChannelPasswordFlag(channelId: string): Promise<void> {
    const info = await this.getChannelInfo(channelId);
    if (!info?.channelFlagPassword) throw new Error(`TeamSpeak did not report password flag for channel ${channelId}`);
    logger.info({ channelId, channelName: info.channelName, channelFlagPassword: true }, 'Channel password flag verified');
  }

  async getChannelInfo(channelId: string): Promise<ChannelInfo> {
    if (!this.ts3) throw new Error('TS3 client not connected');
    try {
      return await this.ts3.channelInfo(channelId);
    } catch (error) {
      if (!isInvalidChannelIdError(error)) throw error;
      logger.warn({ err: error, channelId }, 'TeamSpeak channelInfo reported invalid channelID; checking channel list fallback');
      const channels = await this.ts3.channelList();
      const found = channels.find((channel: any) => String(channel.cid) === channelId);
      if (!found) throw error;
      return this.ts3.channelInfo(channelId);
    }
  }

  async channelExists(channelId: string): Promise<boolean> {
    if (!this.ts3) throw new Error('TS3 client not connected');
    try {
      await this.getChannelInfo(channelId);
      return true;
    } catch (error) {
      if (isInvalidChannelIdError(error)) {
        logger.warn({ err: error, channelId }, 'Managed channel is missing in TeamSpeak');
        return false;
      }
      const channels = await this.ts3.channelList();
      return channels.some((channel: any) => String(channel.cid) === channelId);
    }
  }

  async deleteChannel(channelId: string): Promise<void> {
    if (!this.ts3) throw new Error('TS3 client not connected');
    await this.ts3.channelDelete(channelId, true);
  }

  async getChannelClientCount(channelId: string): Promise<number> {
    if (!this.ts3) throw new Error('TS3 client not connected');
    const channels = await this.ts3.channelList();
    const channel = channels.find((c: any) => String(c.cid) === channelId);
    return Number((channel as any)?.totalClients ?? (channel as any)?.total_clients ?? (channel as any)?.channel_total_clients ?? 0);
  }

  async listClientsInChannel(channelId: string): Promise<TS3ChannelClient[]> {
    if (!this.ts3) throw new Error('TS3 client not connected');
    const normalizedChannelId = firstString(channelId);
    const source = typeof (this.ts3 as any).channelClientList === 'function'
      ? await (this.ts3 as any).channelClientList(normalizedChannelId)
      : await this.ts3.clientList({ cid: normalizedChannelId } as any);

    return source.map((client: any) => ({
      clientId: firstString(client.clid, client.clientId),
      clientDbId: firstString(client.clientDatabaseId, client.client_database_id, client.cldbid),
      nickname: firstString(client.clientNickname, client.client_nickname, client.nickname),
      channelId: firstString(client.cid, client.channelId, client.client_channel_id, normalizedChannelId)
    }));
  }

  async moveClient(clientId: string, channelId: string): Promise<void> {
    if (!this.ts3) throw new Error('TS3 client not connected');
    await this.ts3.clientMove(clientId, channelId);
  }

  async sendPrivateMessage(clientId: string, message: string): Promise<void> {
    if (!this.ts3) throw new Error('TS3 client not connected');
    await this.ts3.sendTextMessage(clientId, TextMessageTargetMode.CLIENT, message);
  }

  async sendClientMessage(clientId: string, message: string): Promise<void> {
    await this.sendPrivateMessage(clientId, message);
  }

  async sendStaffNotification(message: string): Promise<void> {
    if (!this.ts3) return;

    switch (env.STAFF_NOTIFY_TARGET_MODE) {
      case 'server':
        await this.ts3.sendTextMessage('0', TextMessageTargetMode.SERVER, message);
        return;
      case 'channel': {
        const channel = await this.ts3.getChannelById(env.STAFF_NOTIFY_TARGET);
        if (!channel) throw new Error(`TS3 staff notification channel not found: ${env.STAFF_NOTIFY_TARGET}`);
        await this.ts3.sendTextMessage(channel as TeamSpeakChannel.ChannelType, TextMessageTargetMode.CHANNEL, message);
        return;
      }
      case 'client': {
        const client = await this.ts3.getClientById(env.STAFF_NOTIFY_TARGET);
        if (!client) throw new Error(`TS3 staff notification client not found: ${env.STAFF_NOTIFY_TARGET}`);
        await this.ts3.sendTextMessage(client as TeamSpeakQueryClient.ClientType, TextMessageTargetMode.CLIENT, message);
        return;
      }
    }
  }
}
