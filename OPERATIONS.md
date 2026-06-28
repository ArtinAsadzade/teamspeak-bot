# TeamSpeak Bot Operations

## Environment checklist

Required secrets and connection settings:

- `TS3_HOST`, `TS3_QUERY_PORT`, `TS3_SERVER_PORT`, `TS3_USERNAME`, `TS3_PASSWORD`, `TS3_NICKNAME`
- `API_SECRET` with at least 16 characters; send it only as `x-api-secret` for protected endpoints.
- `REDIS_URL` for persistent managed-channel state and locks.
- `TS3_PARENT_CHANNEL_ID` for temporary channels.
- `TEMP_LOBBY_CHANNEL_IDS` as a comma-separated list for temporary-channel lobbies.
- `SUPPORT_PARENT_CHANNEL_ID` and `SUPPORT_LOBBY_CHANNEL_IDS` when support tickets are enabled.

Feature flags:

- `FEATURE_TEMP_CHANNEL_LIFECYCLE=true` enables Phase 1 temp-channel lifecycle.
- `FEATURE_SUPPORT_TICKETS=true` enables ticket lobby handlers.
- `FEATURE_ADMIN_API=true` enables admin/recovery endpoints.
- `FEATURE_ANTI_SPAM_SECURITY=true` enables moderation event tracking.
- `FEATURE_AUTOMATION_RECOVERY=true` enables cleanup/recovery jobs.

## Deploy commands

```bash
npm install
npm run build
docker-compose build --no-cache
docker-compose up -d
```

## Debug commands

```bash
docker-compose ps
docker-compose logs -f bot
docker-compose logs -f redis
curl -fsS http://127.0.0.1:3030/healthz
curl -fsS http://127.0.0.1:3030/readyz
curl -fsS -H "x-api-secret: $API_SECRET" http://127.0.0.1:3030/metrics
```

## Test checklist

1. Build locally with `npm run build`.
2. Build the image with `docker-compose build --no-cache`.
3. Start Redis and the bot with `docker-compose up -d`.
4. Join each ID in `TEMP_LOBBY_CHANNEL_IDS` and confirm exactly one semi-permanent channel is created under `TS3_PARENT_CHANNEL_ID`.
5. Confirm the channel name is based on the sanitized nickname.
6. Confirm the private message is Persian and contains the same 4-digit numeric password stored in Redis metadata.
7. Confirm the TeamSpeak channel has its password flag enabled before using the password.
8. Re-enter a temp lobby as the same user and confirm the existing channel is reused and the same password is resent.
9. Delete the TS3 channel manually, re-enter the lobby, and confirm stale Redis metadata is recovered and replaced.
10. Leave a managed temp channel empty and confirm it is deleted after `EMPTY_DELETE_DELAY_SEC`.
11. Leave an unmanaged channel empty and confirm it is never deleted by cleanup.
12. Trigger an event and a lobby scan at nearly the same time and confirm Redis lock prevents duplicate creation.

## Later phase TODOs

- TODO(ownerControls): implement owner kick, mute, capacity, visibility, password rotation, and internal audit module.
- TODO(tickets improvements): expand ticket routing, staff close flow, response-time tracking, rating, and ticket history.
- TODO(admin API): add status, active managed-channel list, empty-delete queue, manual delete, broadcast, online users, and stats endpoints.
- TODO(security): add rate-limit dimensions for owner, database ID, unique ID, and IP plus rapid-move strikes and blacklist API.
- TODO(automation): add full restart reconcile, leader-transition scans, metadata repair, and health monitor metrics.
- TODO(welcome/afk/vip/stats/auditLog): add optional modules for welcome/rules, AFK moves, VIP templates, daily admin stats, and staff audit logs.
