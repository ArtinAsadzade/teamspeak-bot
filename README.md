# TS3 Admin Bot

بات مدیریتی همیشه‌روشن برای TeamSpeak 3 بر پایه Node.js + TypeScript + Fastify + Redis.

## قابلیت‌ها
- اتصال پایدار ServerQuery با reconnect/backoff
- ساخت Temp Channel با sanitize، blacklist، rate limit، و mapping مالک
- حذف خودکار کانال‌های خالی با scheduler مبتنی بر Redis (resilient به restart)
- Ticket flow برای Support Lobby + auto move + staff notification
- Leader election با Redis lock برای HA (active/standby)
- API امن با `x-api-secret`
- JSON logging با redaction برای secrets
- endpointهای `/healthz` و `/readyz`
- Dockerized (multi-stage + non-root + healthcheck)

## نصب و اجرا (Production)
1. فایل `.env.example` را به `.env` کپی و مقادیر را تنظیم کنید.
2. اجرا:

```bash
docker compose up -d --build
```

3. سلامت سرویس:

```bash
curl http://localhost:3030/healthz
curl http://localhost:3030/readyz
```

## امنیت API
تمام endpointهای `/v1/*` و `/metrics` نیازمند header زیر هستند:

- `x-api-secret: <API_SECRET>`

فقط endpointهای `GET /healthz` و `GET /readyz` بدون secret در دسترس هستند.

## مثال curl

```bash
curl -X POST http://localhost:3030/v1/temp-channels \
  -H 'content-type: application/json' \
  -H 'x-api-secret: REPLACE_ME' \
  -d '{"ownerKey":"user-123","name":"Gaming Room","password":"optional"}'

curl -H 'x-api-secret: REPLACE_ME' http://localhost:3030/metrics
```

## Endpointها
- `GET /healthz`
- `GET /readyz`
- `GET /metrics` (requires `x-api-secret`)
- `POST /v1/temp-channels`
- `GET /v1/temp-channels`
- `POST /v1/temp-channels/cleanup`
- `GET /v1/events/recent?limit=50`
- `POST /v1/tickets/:channelId/close`
- `POST /v1/admin/reload-blacklist`
- `POST /v1/admin/cleanup-orphans`

## توسعه محلی
```bash
npm install
npm run dev
```

## Smoke check
```bash
npm run smoke
```

## Production Checklist
- ✅ `PORT=3030` تنظیم شده و docker mapping برابر `3030:3030` است.
- ✅ Redis داخل `docker-compose.yml` بالا می‌آید و `REDIS_URL=redis://redis:6379` ست شده است.
- ✅ `GET /healthz` همیشه 200 می‌دهد؛ `GET /readyz` فقط با readiness واقعی (Redis + TS3 status) 200 می‌دهد.
- ✅ Leader election observable است (وضعیت leader در `readyz` گزارش می‌شود).
- ✅ Auto-cleanup بعد از restart با state مبتنی بر Redis برقرار است.
- ✅ Rate limit و max active channel فعال هستند.
- ✅ Blacklist normalize robust فعال است.
- ✅ Docker non-root + restart policy `unless-stopped` اعمال شده است.
- ✅ Secrets redaction در logs برای `x-api-secret`، پسوردها و body حساس فعال است.
- ✅ مثال‌های curl برای endpointها روی `localhost:3030` به‌روز شده‌اند.


## Operations

### Environment variables

Required TeamSpeak settings: `TS3_HOST`, `TS3_QUERY_PORT`, `TS3_SERVER_PORT`, `TS3_USERNAME`, `TS3_PASSWORD`, `TS3_NICKNAME`, `TS3_PARENT_CHANNEL_ID`, and `SUPPORT_PARENT_CHANNEL_ID`. Required application settings include `API_SECRET` and `REDIS_URL`. Secrets are redacted from logs.

Lobby IDs support backward-compatible single and multi-value variables. Use `SUPPORT_LOBBY_CHANNEL_IDS=38,40,42` for support ticket lobbies or `SUPPORT_LOBBY_CHANNEL_ID=38` for the legacy single lobby. Use `TEMP_LOBBY_CHANNEL_IDS=136` or `TEMP_LOBBY_CHANNEL_ID=136` for temporary private channel lobbies. IDs are parsed as trimmed strings and logged only as sanitized channel IDs.

Example `.env`:

```env
NODE_ENV=production
PORT=3030
TS3_HOST=teamspeak.example.com
TS3_QUERY_PORT=10011
TS3_SERVER_PORT=9987
TS3_USERNAME=serveradmin
TS3_PASSWORD=change_me
TS3_NICKNAME=ts3-admin-bot
TS3_PARENT_CHANNEL_ID=138
TEMP_LOBBY_CHANNEL_IDS=136
SUPPORT_PARENT_CHANNEL_ID=35
SUPPORT_LOBBY_CHANNEL_IDS=38,40,42
STAFF_NOTIFY_TARGET_MODE=server
STAFF_NOTIFY_TARGET=1
API_SECRET=replace_with_long_random_secret
REDIS_URL=redis://redis:6379
EMPTY_DELETE_DELAY_SEC=120
SCHEDULER_TICK_SEC=10
MAX_ACTIVE_CHANNELS_PER_OWNER=1
```

### Channel behavior

Support lobbies create or reuse one managed `[TICKET_CH] managed-by-bot` semi-permanent channel under `SUPPORT_PARENT_CHANNEL_ID`. Temporary lobbies create or reuse one managed `[TEMP_CH] managed-by-bot` semi-permanent channel under `TS3_PARENT_CHANNEL_ID`; the bot moves the owner first, sets an exactly 4-digit numeric password, verifies the TeamSpeak password flag, stores metadata in Redis, then sends the password privately in Persian.

### Cleanup

The cleanup scheduler scans only Redis-managed channels. Empty channels are marked with `emptySince`, deleted only after `EMPTY_DELETE_DELAY_SEC`, and preserved if a user rejoins before the delay. Missing TeamSpeak channels are treated as stale metadata and removed from Redis. Unmanaged channels are never deleted.

### Deploy commands

```bash
npm install
npm run build
docker-compose build --no-cache
docker-compose up -d
docker-compose logs -f bot
```

### Debug commands

```bash
docker-compose logs -f bot
docker exec -it teamspeak-bot-redis redis-cli KEYS 'managed:*'
docker exec -it teamspeak-bot-redis redis-cli FLUSHALL
docker-compose restart bot
```

### Test checklist

- `npm run build` succeeds with no TypeScript errors.
- `docker-compose build --no-cache` succeeds.
- Redis and TeamSpeak connections are ready.
- Startup logs show support lobby IDs, temp lobby IDs, parent IDs, cleanup delay, and max active channels without secrets.
- Joining support lobbies creates/reuses Persian ticket flow.
- Joining temp lobbies creates/reuses Persian temp-channel flow with a verified four-digit password.
- Empty managed channels are deleted after the configured delay, and rejoining cancels deletion.
- Stale Redis metadata is cleaned and does not block recreation.
