# OpenDialer

**Self-hosted call-center auto-dialer** — campaigns, lead lists, preview & progressive (power) dialing, a WebRTC softphone that works with any SIP provider or PBX, do-not-call enforcement, callbacks, scripts, recordings, live wallboard and reports.
Agents connect from the same office network or remotely, from **Windows, macOS, Linux (desktop app or browser) and Android (installable PWA)**.

OpenDialer is an open-source alternative to commercial Windows-only dialers such as Ecsow: one small server (Node.js + SQLite, no external database) and a web console.

> This is agent-driven calling software: a human agent is on every call. It deliberately does not include unattended pre-recorded message blasting. You are responsible for complying with the calling laws that apply to you — see [docs/COMPLIANCE.md](docs/COMPLIANCE.md).

---

## Features

**Dialing**
- Dial modes per campaign: **Manual** (click-to-dial), **Preview** (agent sees the lead, presses Dial or Skip, optional auto-dial countdown) and **Progressive / power** (next lead is dialed the moment the agent is ready).
- Built-in **simulator** telephony mode — evaluate and train with no SIP account; swap to a real SIP trunk/PBX in Settings.
- Softphone in the browser: SIP over WebSocket (SIP.js) → Asterisk / FreePBX / FreeSWITCH / Telnyx / any WebRTC-capable provider. Mute, hold, DTMF keypad, blind transfer, call timer.
- Per-agent SIP credentials, caller ID and dial prefix per campaign.

**Leads & compliance**
- CSV import wizard with column mapping, phone normalisation to E.164, de-duplication, invalid-number and DNC reporting, custom fields.
- **Do-not-call list** (global, bulk import, one-click add by agents) — checked before *every* dial, automatic and manual.
- **Calling hours per lead time zone** (derived from the lead's zone or its NANP area code), calling days, max attempts per lead, retry delays per disposition, daily attempt cap per number, optional consent flag.
- Callbacks: personal or campaign-wide, reminders, automatic hand-out when due.
- Lead recycling / reset, priorities, notes, full call history per lead.

**Agents & supervisors**
- Agent console: lead card, editable notes, call script with `{{placeholders}}`, disposition grid, callback scheduler, wrap-up timer, pause codes, manual dial with DNC check, my callbacks, recent calls.
- Live **wallboard**: every agent's state and timer, campaign progress, today's totals; force-logout.
- Call recording (browser-side, uploaded to the server) with a configurable consent notice and per-campaign policy.
- Reports: by campaign, agent, disposition and hour; CSV export of calls and leads.
- Roles: admin / supervisor / agent. Audit log of every change.

**Platform**
- Single server process, SQLite database, automatic HTTPS with a self-signed certificate (microphone access needs HTTPS), prints the LAN URLs on start.
- Remote agents through a reverse proxy, Cloudflare Tunnel or Tailscale — see [docs/REMOTE-ACCESS.md](docs/REMOTE-ACCESS.md).
- Desktop app (Electron) for Windows/macOS/Linux, PWA for Android/iOS browsers, or just a browser.
- REST API with API keys, webhooks (HMAC-signed), one-click backups, CLI for backup / password reset.
- Dark and light theme, responsive down to phone width.

---

## Quick start (5 minutes)

Requirements: [Node.js 20+](https://nodejs.org) (22 recommended) on Windows, macOS or Linux. Docker instructions are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

```bash
git clone https://github.com/cyberkyd01/OpenDialer.git
cd OpenDialer
npm install
npm run build
npm start
```

The server prints something like:

```
  OpenDialer v1.0.0 is running
  Open the console at:
    http://localhost:8080
    https://192.168.1.44:8443
```

1. Open the URL in a browser and complete the **first-run wizard** (admin account, company, default country and time zone).
2. **Settings → Telephony**: keep *Simulator* to try things out, or enter your SIP provider's WSS URL / domain and give each agent SIP credentials under **Users** ([docs/SIP-SETUP.md](docs/SIP-SETUP.md)).
3. **Campaigns → New**: choose the dial mode, calling hours, max attempts, script; add a **list** and **import a CSV**; assign agents; **Activate**.
4. Agents open the `https://<server-ip>:8443` address (accept the certificate once), log in, pick the campaign and press **Ready**.

Agents on other networks: see [docs/REMOTE-ACCESS.md](docs/REMOTE-ACCESS.md). Android: [docs/ANDROID.md](docs/ANDROID.md). Desktop app: [packages/desktop/README.md](packages/desktop/README.md).

All data (SQLite database, recordings, TLS certificate, backups) lives in one folder — `packages/server/data` by default, or wherever `DATA_DIR` points. Back it up by copying that folder or with **System → Backup now**.

---

## How it works

```
                 ┌────────────────────────────────────────────────┐
  Admin / Supervisor  ──►  │  OpenDialer server (Node.js)                   │
  (browser)               │   REST API  ·  Socket.IO realtime  ·  SQLite    │
                          │   dialer engine · compliance gate · reports      │
  Agent console  ◄──────► │                                                  │
  (browser / desktop app /└────────────────────────────────────────────────┘
   Android PWA)
        │
        │  SIP over WebSocket + WebRTC media (or the built-in simulator)
        ▼
  Your PBX / SIP provider  ──►  PSTN
```

The server decides *who calls whom and when* (campaign rules, lead queue, DNC, calling hours, callbacks) and keeps the call log; the agent's softphone places the actual call through your SIP provider. Because media never touches the OpenDialer server, it runs happily on a small VM or an office PC. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Repository layout

| Path | What |
| --- | --- |
| `packages/server` | Express + Socket.IO + better-sqlite3 server, dialer engine, REST API, tests |
| `packages/web` | React + Vite agent/admin console, installable PWA, SIP.js softphone, Playwright e2e |
| `packages/desktop` | Electron shell for Windows / macOS / Linux |
| `packages/shared` | Types, zod schemas, socket event contract, phone / time-zone / script helpers |
| `docs/` | Deployment, remote access, SIP setup, Android, architecture, API, compliance |
| `scripts/` | Service installers (Windows Task Scheduler, systemd, launchd) |

## Development

```bash
npm install
npm run dev          # server with reload on :8080 + Vite dev server with proxy
npm test             # shared + server + web unit tests
npm run typecheck
npm run e2e -w @opendialer/web   # Playwright end-to-end (builds against the real server)
npm run desktop      # launch the Electron shell
```

Environment variables (`PORT`, `HTTPS_PORT`, `TLS`, `DATA_DIR`, `JWT_SECRET`, `CORS_ORIGINS`, `TRUST_PROXY`, …) are listed in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). The API is documented in [docs/API.md](docs/API.md).

## Roadmap

- Predictive dialing (requires a media server such as Asterisk ARI / FreeSWITCH ESL so the server can dial ahead of agents)
- Inbound call routing and queues
- Multi-tenant mode
- SMS / e-mail follow-ups from dispositions

## License

MIT — see [LICENSE](LICENSE).

---

## ⭐ Support

Please give stars and if possible Buy me a coffee (USDT-TRC20) - `TA216k3WgWTrKnUKxZrSDNGzSJj3eHtEcH`

Telegram: [@Cyberkyd](https://t.me/Cyberkyd)
