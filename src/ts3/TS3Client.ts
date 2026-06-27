import { TeamSpeak, TextMessageTargetMode } from 'ts3-nodejs-library';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { EventBus } from '../core/eventBus';
import { Metrics } from '../core/metrics';

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
    await this.ts3.registerEvent('server');
    this.ts3.removeAllListeners('clientmoved');
    this.ts3.removeAllListeners('clientconnect');
    this.ts3.removeAllListeners('clientdisconnect');

    this.ts3.on('clientmoved', (event: any) => {
      this.bus.emit('clientmoved', {
        clientId: String(event.clid),
        clientDbId: String(event.client_database_id ?? event.cldbid ?? ''),
        targetChannelId: String(event.ctid),
        invokerName: event.invokername,
        nickname: event.client_nickname
      });
    });
    this.ts3.on('clientconnect', (event: any) => {
      this.bus.emit('clientconnect', {
        clientDbId: String(event.client_database_id ?? event.cldbid ?? ''),
        nickname: event.client_nickname
      });
    });
    this.ts3.on('clientdisconnect', (event: any) => {
      this.bus.emit('clientdisconnect', {
        clientDbId: String(event.client_database_id ?? event.cldbid ?? ''),
        nickname: event.client_nickname
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
    if (!this.ts3) throw new Error('TS3 client not connected');
    const created = await this.ts3.channelCreate(input.name, {
      cpid: input.parentId,
      channelTopic: input.topic,
      channelDescription: input.description,
      channelFlagPermanent: false,
      channelFlagSemiPermanent: true,
      channelPassword: input.password
    });
    return String(created.cid);
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

  async moveClient(clientId: string, channelId: string): Promise<void> {
    if (!this.ts3) throw new Error('TS3 client not connected');
    await this.ts3.clientMove(clientId, channelId);
  }

  async sendStaffNotification(message: string): Promise<void> {
    if (!this.ts3) return;
    const mode = env.STAFF_NOTIFY_TARGET_MODE === 'channel' ? TextMessageTargetMode.CHANNEL : TextMessageTargetMode.SERVER;
    const target = mode === TextMessageTargetMode.SERVER ? '0' : env.STAFF_NOTIFY_TARGET;
    await this.ts3.sendTextMessage(target, mode, message);
  }
}
