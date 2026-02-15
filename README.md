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
