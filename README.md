# TS3 Admin Bot

بات مدیریتی همیشه‌روشن برای TeamSpeak 3 بر پایه Node.js + TypeScript + Fastify + Redis.

## قابلیت‌ها
- اتصال پایدار ServerQuery با reconnect/backoff
- ساخت Temp Channel با sanitize، blacklist، rate limit، و mapping مالک
- حذف خودکار کانال‌های خالی با scheduler مبتنی بر Redis (resilient به restart)
- Ticket flow برای Support Lobby + auto move + staff notification
- Leader election با Redis lock برای HA (active/standby)
- API امن با `x-api-secret`
- JSON logging با pino
- endpointهای `/healthz` و `/metrics`
- Dockerized (multi-stage + non-root + healthcheck)

## نصب و اجرا
1. فایل `.env.example` را به `.env` کپی و مقادیر را تنظیم کنید.
2. اجرا:

```bash
docker compose up -d --build
```

3. سلامت سرویس:

```bash
curl http://localhost:3000/healthz
```

## امنیت API
تمام endpointهای نسخه‌بندی‌شده نیازمند header زیر هستند:

- `x-api-secret: <API_SECRET>`

## مثال curl (ساخت کانال موقت)

```bash
curl -X POST http://localhost:3000/v1/temp-channels \
  -H 'content-type: application/json' \
  -H 'x-api-secret: REPLACE_ME' \
  -d '{"ownerKey":"user-123","name":"Gaming Room","password":"optional"}'
```

## Endpointها
- `GET /healthz`
- `GET /metrics`
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
