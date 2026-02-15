import { EventEmitter } from 'node:events';

export type BotEvents = {
  clientmoved: { clientId: string; clientDbId: string; targetChannelId: string; invokerName?: string; nickname?: string };
  clientconnect: { clientDbId: string; nickname?: string };
  clientdisconnect: { clientDbId: string; nickname?: string };
};

export class EventBus {
  private readonly emitter = new EventEmitter();

  on<K extends keyof BotEvents>(event: K, handler: (payload: BotEvents[K]) => void): void {
    this.emitter.on(event, handler);
  }

  emit<K extends keyof BotEvents>(event: K, payload: BotEvents[K]): void {
    this.emitter.emit(event, payload);
  }
}
