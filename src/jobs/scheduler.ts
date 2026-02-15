import { env } from '../config/env';
import { logger } from '../config/logger';

export class Scheduler {
  private timers: NodeJS.Timeout[] = [];

  everyTick(name: string, job: () => Promise<void>): void {
    const run = async () => {
      try {
        await job();
      } catch (error) {
        logger.error({ err: error, job: name }, 'Scheduled job failed');
      }
    };
    const timer = setInterval(run, env.SCHEDULER_TICK_SEC * 1000);
    this.timers.push(timer);
  }

  stop(): void {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }
}
