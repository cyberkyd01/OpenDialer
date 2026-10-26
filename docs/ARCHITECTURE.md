# OpenDialer architecture

A short tour for administrators and contributors.

## Overview

```text
                         ┌─────────────────────────── OpenDialer server (Node.js) ───────────────────────────┐
                         │                                                                                    │
  Admin / supervisor /   │  Express  ── /api/*  REST (JWT or X-API-Key)      ──┐                              │
  agent clients          │           ── static web console (SPA, PWA)          │                              │
 ┌──────────────────┐    │                                                     ├──▶  SQLite (better-sqlite3)  │
 │ Browser / PWA    │◀──▶│  Socket.IO  namespace /rt  (live agent state,      │     opendialer.sqlite       │
 │ Electron desktop │    │             lead assignment, wallboard)             │                              │
 │ Android PWA      │    │                                                     │     data/recordings/         │
 └───────┬──────────┘    │  Dialer engine (in memory, ticks every 3 s):      ──┘                              │
         │               │   agent sessions · lead queue · compliance gate · timeouts · callbacks             │
         │               │  Webhook dispatcher (call.started/ended/disposed, lead.dnc, ...)                    │
         │               └────────────────────────────────────────────────────────────────────────────────────┘
         │
         │ SIP over WSS + WebRTC audio (DTLS-SRTP)          ┌────────────────┐         ┌──────┐
         └─────────────────────────────────────────────────▶│ PBX / SIP      │──trunk─▶│ PSTN │
                (never through the OpenDialer server)       │ provider       │         └──────┘
                                                            └────────────────┘
```

- **Server** (`packages/server`): one Node.js process. Express serves the REST API under `/api` and the
  built web console. Socket.IO (namespace `/rt`) pushes agent state, lead assignments and wallboard
  updates. Data is stored in a single SQLite file. HTTP (8080) and HTTPS (8443, self-signed
  certificate generated on first start) run side by side.
- **Shared contract** (`packages/shared`): TypeScript types, zod validation schemas, event names and phone
  number helpers used by both server and clients.
- **Web console** (`packages/web`): one single-page app for every role (agent desk, supervisor wallboard,
  admin pages) with the built-in softphone (SIP.js over WSS, or the Simulator). It is installable as a PWA.
- **Desktop app** (`packages/desktop`): an Electron window around the web console, adding certificate
  trust, microphone permission, tray and notifications. It holds no business logic.
- **Telephony** lives in your PBX/provider. The server never touches audio, so it stays small and
  needs no media server.

## Data model

All tables are in `opendialer.sqlite` (schema and migrations in `packages/server/src/db.ts`).

| Table | Purpose |
|---|---|
| `users` | Admins, supervisors, agents (bcrypt password hash, role, active flag, per-agent SIP credentials) |
| `settings` | One JSON document: company name, telephony, default country/timezone, pause codes, daily cap, consent rule |
| `scripts` | Call scripts shown to agents |
| `campaigns` | Dial mode, caller ID, script, calling hours/days, timezone mode, max attempts, retry delay, preview and wrap-up timeouts, recording policy, dial prefix, status |
| `campaign_agents` | Which agents may work which campaign |
| `lists` | Lead lists inside a campaign (can be switched on/off) |
| `leads` | Phone (E.164) + raw phone, name, company, email, timezone, custom fields (JSON), status (`new`, `in_progress`, `callback`, `done`, `dnc`, `invalid`), attempts, next attempt time, lock (which agent holds it), priority |
| `dispositions` | Call outcomes with category (`contact`, `no_contact`, `callback`, `dnc`, `invalid`), retry delay, sale/contact flags |
| `dnc` | Internal do-not-call list (E.164, source, note) |
| `calls` | One row per call: lead, campaign, agent, phone, start/answer/end times, duration, talk time, result, disposition, notes, recording path, provider call ID, hang-up cause |
| `callbacks` | Scheduled callbacks (personal or for the campaign), status |
| `agent_state_log` | Every agent state change (for time-in-state reports) |
| `audit_log` | Who did what (logins, imports, settings, deletions, backups ...) |
| `api_keys` | Hashed API keys for integrations |
| `webhooks` | Outgoing webhook targets and their events |
| `schema_migrations` | Applied migration versions |

## Agent state machine

Agent sessions live in memory in the dialer engine (`packages/server/src/engine.ts`). Every change is
pushed to the agent and to supervisors, and written to `agent_state_log`.

```text
                login / join campaign
   offline ───────────────────────────▶ paused ◀──────────────┐
      ▲                                  │  ▲                  │ pause (or pending pause
      │ logout / disconnect > 60 s       │  │ pause            │  applied after wrap-up)
      │                          ready   ▼  │                  │
      └──────────────────────────────  ready ─────────────────────────────┐
                                         │  ▲                             │ manual dial
                     engine assigns lead │  │ skip / lead not dialable    │
                    (preview/progressive)▼  │                             │
                                      assigned ──── dial ─────────▶ dialing
                                                (agent click, preview      │
                                                 countdown, or automatic   │ answered
                                                 in progressive mode)      ▼
                                                                        talking
                                                                           │ hang-up (either side,
                                                    dispose                │ or no answer / busy / failed)
                                      ready ◀───────────────────────── wrapup
                                     (or paused if a pause was requested;
                                      auto-disposed after the campaign's wrap-up timeout)
```

- Pausing while busy (`assigned`, `dialing`, `talking`, `wrapup`) is remembered as a *pending pause* and
  applied after the call is disposed.
- If an agent disconnects (network drop, app suspended) the session is kept for **60 seconds**. On reconnect
  the agent gets the current lead/call back. After that the session ends and locked leads are released.

## Compliance gate

Before a lead is assigned **and again** right before every dial (including manual dials), the engine runs
`checkDialable` (`packages/server/src/services/leads.ts`). A call is blocked when:

1. **DNC:** the number is on the internal do-not-call list. Dispositions in the `dnc` category add it
   automatically.
2. **Daily cap:** the number was already called `maxAttemptsPerDay` times in the last 24 hours, across all
   campaigns (setting, default 3, `0` = off).
3. **Calling hours:** the current time is outside the campaign's calling hours/days **in the lead's
   timezone**. The timezone comes from the lead's own timezone field, else is derived from the phone number,
   else is the campaign's fixed timezone or the default timezone (or always the fixed timezone in *fixed*
   mode). Scheduled callbacks are allowed outside the window because the person asked for them, but DNC
   and the daily cap still apply.
4. **Max attempts:** the lead has reached the campaign's maximum attempts (unless it is a callback).
5. **Consent flag:** when *Require consent* is on, the lead's custom field `consent` must be
   `yes` / `true` / `1` / `y`.

Leads that fail the gate are skipped, not consumed, so they come back when they become dialable (for example
the next morning).

## Dial modes

| Mode | What happens |
|---|---|
| **Manual** | No automatic assignment. The agent types or clicks a number. The compliance gate still applies. |
| **Preview** | The engine assigns the next lead. The agent reads the record and script, then clicks **Dial**, or the call is placed automatically when the campaign's preview countdown runs out (`previewTimeoutSec`, 0 = wait for the click). The agent can skip. |
| **Progressive** | The engine assigns the next lead **only when an agent is ready**, and the softphone dials it immediately. One call per available agent, so nobody is ever left waiting for an agent ("abandoned call"). |

**Predictive dialing is intentionally not included.** Predictive dialers place more calls than there are
free agents and connect answered calls to whoever becomes free. That requires a media server that
places and holds calls centrally (answering-machine detection, hold audio, abandonment-rate control,
which many laws strictly regulate). OpenDialer's calls are placed by each agent's own softphone, which
keeps the server simple, cheap and free of audio handling. A predictive mode built on an
Asterisk/FreeSWITCH media server (ARI/ESL) is a possible roadmap item.

## Other pieces

- **Callbacks:** personal or campaign-wide, offered to agents before new leads when due. Reminders 5 minutes
  ahead.
- **Recording:** campaign policy `off` / `always` / `agent` (agent decides). The softphone records the call
  in the browser and uploads it to the server (`data/recordings/`). Play the consent notice where required.
- **Webhooks:** `call.started`, `call.ended`, `call.disposed`, `lead.dnc`, `callback.created`,
  `campaign.status` and more, sent as JSON POSTs, signed when a secret is set. See [API.md](API.md).
- **Security:** bcrypt passwords, JWT sessions (`TOKEN_TTL`), login lockout after repeated failures,
  role checks on every route, audit log, hashed API keys.
