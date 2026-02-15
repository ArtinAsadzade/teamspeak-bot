import pino from 'pino';
import { env } from './env';

export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport:
    env.NODE_ENV === 'production'
      ? undefined
      : {
          target: 'pino-pretty',
          options: { colorize: true }
        },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.x-api-secret',
      'req.body.password',
      'req.body.apiSecret',
      '*.password',
      '*.apiSecret',
      'API_SECRET',
      'TS3_PASSWORD',
      'password'
    ],
    censor: '[REDACTED]'
  }
});
