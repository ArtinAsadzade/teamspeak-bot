import Fastify, { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env';
import { featureFlags } from '../config/featureFlags';
import { logger } from '../config/logger';
import { LeaderElection } from '../core/leaderElection';
import { Metrics } from '../core/metrics';
import { BlacklistService } from '../features/moderation/blacklist';
import { ModerationService } from '../features/moderation/service';
import { TempChannelService } from '../features/tempChannels/service';

export interface ApiDeps {
  tempChannels: TempChannelService;
  moderation: ModerationService;
  blacklist: BlacklistService;
  metrics: Metrics;
  leader: LeaderElection;
  health: () => { ok: boolean };
  readiness: () => Promise<{ ready: boolean; redis: boolean; ts3: boolean; leader: boolean }>;
}

const createSchema = z.object({
  ownerKey: z.string().min(3).max(120),
  name: z.string().min(1).max(200),
  password: z.string().min(1).max(100).optional()
});

function unauthorized(reply: FastifyReply): FastifyReply {
  return reply.status(401).send({ error: 'unauthorized' });
}

function checkSecret(request: FastifyRequest): boolean {
  const secret = request.headers['x-api-secret'];
  return typeof secret === 'string' && secret === env.API_SECRET;
}

export async function buildApiServer(deps: ApiDeps) {
  const app = Fastify({ logger });

  app.addHook('preHandler', async (req, reply) => {
    const publicPath = req.url.startsWith('/healthz') || req.url.startsWith('/readyz');
    if (publicPath) return;

    const protectedPath = req.url.startsWith('/v1/') || req.url.startsWith('/metrics');
    if (!protectedPath) return;

    if (!checkSecret(req)) return unauthorized(reply);
  });

  app.get('/healthz', async () => ({ status: 'ok', ...deps.health() }));
  app.get('/readyz', async (_, reply) => {
    const state = await deps.readiness();
    if (!state.ready) return reply.status(503).send({ status: 'not-ready', ...state });
    return { status: 'ready', ...state };
  });
  app.get('/metrics', async (_, reply) => reply.type('text/plain').send(deps.metrics.renderPrometheus()));

  if (featureFlags.tempChannelLifecycle) {
  app.post('/v1/temp-channels', async (req, reply) => {
    if (!deps.leader.isLeader()) return reply.status(409).send({ error: 'standby node' });
    const body = createSchema.parse(req.body);
    const result = await deps.tempChannels.create(body.ownerKey, body.name, body.password);
    return reply.status(201).send(result);
  });

  app.get('/v1/temp-channels', async () => deps.tempChannels.listActive());

  app.post('/v1/temp-channels/cleanup', async () => {
    if (!deps.leader.isLeader()) return { cleaned: 0, leader: false };
    const cleaned = await deps.tempChannels.cleanupEmptyChannels();
    return { cleaned };
  });
  }

  if (featureFlags.antiSpamSecurity) {
  app.get('/v1/events/recent', async (req) => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    return deps.moderation.recent(q.limit);
  });
  }

  if (featureFlags.supportTickets) {
  app.post('/v1/tickets/:channelId/close', async (req) => {
    if (!deps.leader.isLeader()) return { closed: false, leader: false };
    const params = z.object({ channelId: z.string() }).parse(req.params);
    await deps.tempChannels.close(params.channelId);
    return { closed: true };
  });
  }

  if (featureFlags.adminApi || featureFlags.antiSpamSecurity) {
  app.post('/v1/admin/reload-blacklist', async (req) => {
    const body = z.object({ words: z.array(z.string()).optional() }).parse(req.body ?? {});
    deps.blacklist.reload(body.words);
    return { ok: true, size: deps.blacklist.list().length };
  });
  }

  if (featureFlags.adminApi || featureFlags.automationRecovery) {
  app.post('/v1/admin/cleanup-orphans', async () => {
    if (!deps.leader.isLeader()) return { cleaned: 0, leader: false };
    return { cleaned: await deps.tempChannels.cleanupOrphans() };
  });
  }

  return app;
}
