# OpenDialer API reference

Base URL: `http(s)://<server>/api`. All responses are JSON unless noted.
Authentication: `Authorization: Bearer <token>` (from `/auth/login`) or `X-API-Key: <key>` (admin-level service access).
Roles: `agent` < `supervisor` < `admin`. A route marked *supervisor* also allows admins.

Validation errors return `400 {"error":"Validation failed","details":[{"path","message"}]}`. Other errors: `{"error": "<message>"}`.
Request/response shapes are the TypeScript types and zod schemas in [`packages/shared/src`](../packages/shared/src) – they are the source of truth.

## Public

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | `{ok, version, agentsOnline, time}` |
| GET | `/settings/public` | `PublicSettings` – `needsSetup` is true until the first admin exists |
| POST | `/setup` | `setupSchema` → `{token, user}`. Only works while there are no users. |
| POST | `/auth/login` | `loginSchema` → `{token, user}`. 10 failures per IP+user → 15 min lockout. |

## Session (agent+)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/auth/me` | `{user, settings}` |
| POST | `/auth/change-password` | `changePasswordSchema` |
| GET | `/auth/sip` | `SipCredentials` for the softphone of the logged-in user |

## Users

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/users` | supervisor | `User[]` (never includes SIP passwords) |
| GET | `/users/:id` | supervisor | admin sees `sipPassword` |
| POST | `/users` | admin | `userCreateSchema` |
| PATCH | `/users/:id` | admin | `userUpdateSchema`; cannot demote/deactivate yourself |
| DELETE | `/users/:id` | admin | users with call history are deactivated instead of deleted |

## Settings

| Method | Path | Role |
| --- | --- | --- |
| GET | `/settings` | supervisor |
| PUT | `/settings` | admin – partial deep merge (`settingsUpdateSchema`) |

## Campaigns & lists

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/campaigns` | agent | agents only get campaigns they are assigned to (active/paused) |
| GET | `/campaigns/:id` | agent | campaign + `script` + `agentIds` |
| GET | `/campaigns/:id/stats` | agent | `CampaignStats` |
| POST | `/campaigns` | supervisor | `campaignCreateSchema` (status starts as `draft`) |
| PATCH | `/campaigns/:id` | supervisor | `campaignUpdateSchema` |
| POST | `/campaigns/:id/status` | supervisor | `{status: draft|active|paused|completed}` – pausing releases locked leads |
| PUT | `/campaigns/:id/agents` | supervisor | `{userIds: number[]}` |
| POST | `/campaigns/:id/reset-leads` | supervisor | `{listId?, onlyStatus?: string[]}` → `{changed}` (never resets DNC leads) |
| DELETE | `/campaigns/:id` | admin | cascades lists, leads, callbacks |
| GET | `/campaigns/:id/lists` | agent | `LeadList[]` |
| POST | `/campaigns/:id/lists` | supervisor | `listCreateSchema` |
| GET/PATCH/DELETE | `/lists/:id` | agent / supervisor / supervisor | |

## Leads

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/leads?campaignId&listId&status&q&page&pageSize` | agent | `Paginated<Lead>`; `q` matches name/company/email/phone digits |
| GET | `/leads/:id` | agent | lead + `calls` + `callbacks` |
| POST | `/leads` | agent | `leadCreateSchema`; phone normalised to E.164, DNC numbers get status `dnc` |
| PATCH | `/leads/:id` | agent | `leadUpdateSchema`; agents cannot change `status/attempts/nextAttemptAt` |
| DELETE | `/leads/:id` | supervisor | |
| POST | `/lists/:id/import/preview` | supervisor | multipart `file` (CSV) → `{headers, mapping (guessed), rows (first 10), total}` |
| POST | `/lists/:id/import` | supervisor | multipart `file` + `mapping` (JSON string, `importMappingSchema`) → `ImportResult` |

## Do-not-call

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/dnc?q&page` | agent | `Paginated<DncEntry>` |
| GET | `/dnc/check?phone=` | agent | `{phone, dnc}` |
| POST | `/dnc` | agent | `dncCreateSchema` – marks every matching lead `dnc`, cancels its callbacks |
| POST | `/dnc/import` | supervisor | multipart `file` – one number per line/cell → `{added, invalid, total}` |
| DELETE | `/dnc/:id` | admin | |

## Dispositions & scripts

| Method | Path | Role |
| --- | --- | --- |
| GET | `/dispositions` | agent |
| POST / PATCH / DELETE | `/dispositions[/:id]` | admin (system dispositions cannot be deleted) |
| GET | `/scripts`, `/scripts/:id` | agent |
| GET | `/scripts/:id/preview?leadId=` | agent → `{rendered}` |
| POST / PATCH / DELETE | `/scripts[/:id]` | supervisor |

## Calls, recordings, callbacks

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/calls?campaignId&userId&leadId&from&to&result&dispositionId&phone&page` | agent | agents only see their own |
| GET | `/calls/:id` | agent | |
| POST | `/calls/:id/recording` | agent | multipart `file` (audio/webm, ogg, m4a, wav; ≤200 MB) |
| GET | `/calls/:id/recording` | agent | streams the audio |
| GET | `/callbacks?scope=mine|all&status&campaignId&userId` | agent | `Callback[]` with `lead` joined; agents always get their own + campaign-wide |
| GET | `/callbacks/:id` | agent | |
| PATCH | `/callbacks/:id` | agent | `callbackUpdateSchema` (reschedule / cancel / done) |

## Reports (supervisor)

`/reports/summary`, `/reports/campaigns?from&to`, `/reports/agents?from&to`, `/reports/dispositions?from&to&campaignId`, `/reports/hourly?from&to&campaignId`,
`/reports/export/calls.csv?from&to&campaignId&userId`, `/reports/export/leads.csv?campaignId&listId&status`, `/wallboard` (snapshot), `/agents` (live sessions), `POST /agents/:id/logout`.

## Admin

`/webhooks` (GET returns `{items, events}`; POST/PATCH/DELETE; `POST /webhooks/:id/test`), `/api-keys` (POST returns `plaintext` once), `/audit?entity&userId&page`,
`POST /admin/backup`, `GET /admin/backups`, `GET /admin/backups/:file` (download), `GET /admin/system`.

Webhook deliveries are `POST {event, at, data}` with header `X-OpenDialer-Event` and, when a secret is set, `X-OpenDialer-Signature: sha256=<hmac of body>`. Three attempts with back-off.

## Realtime (Socket.IO, namespace `/rt`)

Connect with `io(serverUrl + '/rt', { auth: { token } })`. Events and payloads are typed in [`packages/shared/src/events.ts`](../packages/shared/src/events.ts).
Every client→server event takes `(payload, ack)` where `ack` receives `{ok, error?, data?}`.

Agent lifecycle:

1. `agent:join {campaignId|null}` → state `paused`.
2. `agent:ready {}` → state `ready`; in preview/progressive campaigns the server immediately sends `lead:assigned` and the state becomes `assigned`.
3. Preview: agent presses Dial → `lead:dial {leadId}` → ack `{callId}`; or `lead:skip {leadId, requeue}`. Progressive: `autoDial` is true, the softphone dials at once and the client sends `lead:dial`.
4. The softphone reports `call:update {callId, state: ringing|answered|ended, cause}`; on `ended` the state becomes `wrapup`.
5. `call:dispose {callId, dispositionId, notes?, callback?, pauseAfter?}` → next lead (`assigned`) or `ready`/`paused`.
6. `agent:pause {code}` any time (applied after wrap-up when busy), `agent:leave {}` to log out.
7. `manual:dial {phone, campaignId?, leadId?}` from `ready`/`paused` – ack `{callId, dialString, lead}`; then the same `call:update` / `call:dispose` flow.

Server→client: `agent:state`, `lead:assigned`, `lead:released`, `call:started`, `call:ended`, `callback:due`, `notice`, `session:replaced`, `campaign:changed`, and for supervisors who sent `wallboard:subscribe`: `wallboard:update` (≤1/s).

A socket that drops keeps the agent session for 60 s; reconnecting and sending `agent:join` again resumes it (the lead and call are re-sent, with `autoDial` forced to false when a call is already up).

A user may hold several sockets at once (for example a supervisor's wallboard tab next to their agent console). Only the socket that last sent `agent:join` is the **agent console**: it receives agent events and may send them; the previous console socket gets `session:replaced` and its agent events are refused with "no longer the active agent console". Wallboard-only sockets never replace the console.
