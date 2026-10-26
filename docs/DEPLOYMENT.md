# Deploying OpenDialer

This guide installs the OpenDialer server on one computer in your office (or a small cloud VM).
Agents then use it from a browser, the desktop app, or an Android phone.

- [1. Requirements](#1-requirements)
- [2. Install from source](#2-install-from-source)
- [3. First run: the setup wizard](#3-first-run-the-setup-wizard)
- [4. Configuration (environment variables)](#4-configuration-environment-variables)
- [5. The data directory](#5-the-data-directory)
- [6. Run it as a service (start automatically)](#6-run-it-as-a-service-start-automatically)
- [7. Docker](#7-docker)
- [8. Backups](#8-backups)
- [9. Upgrading](#9-upgrading)
- [10. Troubleshooting](#10-troubleshooting)

---

## 1. Requirements

| | Minimum | Notes |
|---|---|---|
| Operating system | Windows 10/11 or Server 2019+, macOS 12+, any current 64-bit Linux | Or anything that runs Docker |
| Node.js | **20 or newer** (22 LTS recommended) | Not needed with Docker |
| CPU / RAM | 1 core / 512 MB for ~25 agents | The server only does signalling; audio never passes through it |
| Disk | 1 GB + space for call recordings | Recordings are about 0.5 MB per minute of talk time |
| Network | Ports **8080** (http) and **8443** (https) reachable by agents | Configurable |
| Telephony | A SIP PBX or provider that supports **WebRTC (SIP over WSS)**, or Simulator mode | See [SIP-SETUP.md](SIP-SETUP.md) |

Install Node.js from <https://nodejs.org> (LTS installer), or:

```powershell
# Windows (PowerShell)
winget install OpenJS.NodeJS.LTS
```

```bash
# macOS (Homebrew)
brew install node@22
# Debian / Ubuntu
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
```

Check with `node -v` (must print v20 or higher).

## 2. Install from source

1. Download the code and install dependencies:

   ```bash
   git clone https://github.com/cyberkyd01/OpenDialer.git
   cd OpenDialer
   npm install
   ```

   No git? Download the ZIP from the GitHub page, extract it, and open a terminal in that folder.

2. Build the server, shared code and web console:

   ```bash
   npm run build
   ```

3. Start the server:

   ```bash
   npm start
   ```

   You will see a banner like this:

   ```text
     OpenDialer v1.0.0 is running

     Open the console at:
       http://localhost:8080
       http://192.168.1.10:8080
       https://localhost:8443
       https://192.168.1.10:8443
     ...
     Data directory: C:\OpenDialer\packages\server\data
   ```

   Keep the window open, or set it up as a service (section 6). Stop it with **Ctrl+C**.

> `npm install` downloads the Electron runtime for the desktop app (~100 MB). On a
> server-only machine you can skip it: PowerShell `$env:ELECTRON_SKIP_BINARY_DOWNLOAD=1; npm install`,
> macOS/Linux `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install`.

## 3. First run: the setup wizard

1. On the server computer open **<http://localhost:8080>** (or `https://localhost:8443`: accept the
   certificate warning, see section 10).
2. The setup wizard asks for your company name and the **first administrator** account. Pick a
   strong password: this account can see everything.
3. Log in, then:
   1. **Settings → Telephony**: leave **Simulator** on to try things out, or enter your SIP/WebRTC
      details ([SIP-SETUP.md](SIP-SETUP.md)).
   2. **Users**: create agents and supervisors, and fill in each agent's SIP credentials.
   3. **Campaigns**: create a campaign, upload a CSV lead list, assign agents, set it to *Active*.
4. Agents on the office network open the **https://<LAN-IP>:8443** address from the banner. Other options are in
   [REMOTE-ACCESS.md](REMOTE-ACCESS.md).

No browser on the server? Create the admin from the command line instead. Run it from the
`packages/server` folder so it uses the same data directory as `npm start`:

```bash
cd packages/server
node dist/cli.js create-admin admin "a-long-password" "Administrator"
```

## 4. Configuration (environment variables)

Everything has a sensible default, so most installations need no settings at all.

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8080` | HTTP port. `0` disables plain HTTP. |
| `HTTPS_PORT` | `8443` | HTTPS port. `0` disables HTTPS. |
| `TLS` | `auto` | `auto` = create a self-signed certificate in `DATA_DIR/tls` on first start (covers `localhost`, the hostname and all LAN IPs). `off` = HTTP only (use behind a reverse proxy). Or a **folder path** containing your own `cert.pem` + `key.pem`. |
| `HOST` | `0.0.0.0` | Network interface to listen on. `127.0.0.1` = only this computer (good behind a reverse proxy on the same machine). |
| `DATA_DIR` | `data` inside the server's working folder, i.e. **`packages/server/data`** when started with `npm start` | Where the database, recordings, certificate and backups live. The startup banner prints the full path. |
| `JWT_SECRET` | random, stored in `DATA_DIR/secret.key` | Secret that signs login tokens. Only set it if you run several servers that must accept the same tokens. Changing it logs everyone out. |
| `TOKEN_TTL` | `12h` | How long a login stays valid (`8h`, `24h`, `7d`, ...). |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`. |
| `WEB_DIR` | auto (`packages/web/dist`) | Folder of the built web console, if you moved it. |
| `CORS_ORIGINS` | *(empty)* | Comma-separated extra origins allowed to call the API. Only needed when the web console is hosted on a **different** address than the server. |
| `PUBLIC_URL` | *(empty)* | Your public address (e.g. `https://dialer.example.com`), used in printed hints and webhooks. |
| `TRUST_PROXY` | `true` | Trust `X-Forwarded-For`/`-Proto` headers from a reverse proxy (correct client IPs for login lockout and audit). Set `false` if the server is directly exposed to the internet without a proxy. |
| `ENGINE_INTERVAL_MS` | `3000` | How often the dialer engine checks for work (callbacks, timeouts). Rarely changed. |

How to set them:

```powershell
# Windows PowerShell (current window only)
$env:PORT = "80"; $env:HTTPS_PORT = "443"; $env:DATA_DIR = "D:\OpenDialerData"
npm start
```

```bash
# macOS / Linux
PORT=80 HTTPS_PORT=443 DATA_DIR=/var/lib/opendialer npm start
```

For services, set them in the service definition (section 6). Ports below 1024 need
administrator/root rights on Linux/macOS.

## 5. The data directory

Everything that matters lives in one folder, `DATA_DIR`. With `npm start` it is
`packages/server/data`, and the startup banner prints the exact path. The service scripts below use the same
folder unless you choose another one.

```text
data/
├── opendialer.sqlite        # the database (users, campaigns, leads, calls, settings, DNC ...)
├── opendialer.sqlite-wal    # SQLite write-ahead log (part of the database, keep with it)
├── opendialer.sqlite-shm    # SQLite shared memory (recreated automatically)
├── secret.key               # signs login tokens (keep private)
├── recordings/              # call recordings uploaded by the softphone
├── tls/
│   ├── cert.pem             # self-signed certificate (TLS=auto), share it to trust it on devices
│   └── key.pem              # its private key (keep private)
├── backups/                 # database backups (System page or `npm run backup`)
└── logs/                    # only when run by scripts/windows/install-service.ps1
```

Back up the whole folder. Protect it: it contains personal data (leads) and secrets.

To regenerate the certificate (for example after the server's IP address changed): stop the
server, delete the `tls/` folder in the data directory, start again. Devices will have to accept the new certificate.

## 6. Run it as a service (start automatically)

### Windows: option A, Task Scheduler (built in, recommended)

The repository includes a script that creates a scheduled task that starts OpenDialer at boot
(as SYSTEM, before anyone logs on), restarts it if it crashes and writes a log file.

1. Build first (`npm install`, `npm run build`).
2. Open **PowerShell as Administrator** in the OpenDialer folder.
3. Preview what it will do:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\windows\install-service.ps1 -DryRun
   ```

4. Install (and open the firewall for the office network):

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\windows\install-service.ps1 -OpenFirewall
   ```

   By default it uses the same data directory as `npm start` (`packages\server\data`).
   Useful options: `-DataDir D:\OpenDialerData`, `-Port 80 -HttpsPort 443`,
   `-Trigger Logon` (run as you, at logon, instead of at startup), `-NoStart`.

5. Check it: `Get-ScheduledTask -TaskName OpenDialer | Get-ScheduledTaskInfo`; the log is in
   `packages\server\data\logs\server.log`.

Remove it again (your data is kept):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\uninstall-service.ps1 -RemoveFirewallRule
```

### Windows: option B, NSSM (a real Windows service)

[NSSM](https://nssm.cc) wraps any program as a Windows service, visible in `services.msc`.

```powershell
winget install NSSM.NSSM          # or download nssm.exe from https://nssm.cc
$dir  = "C:\OpenDialer"           # your OpenDialer folder
$node = (Get-Command node).Source
nssm install OpenDialer $node "packages\server\dist\index.js"
nssm set OpenDialer AppDirectory $dir
nssm set OpenDialer AppEnvironmentExtra "DATA_DIR=$dir\packages\server\data" "NODE_ENV=production"
nssm set OpenDialer AppStdout "$dir\packages\server\data\server.log"
nssm set OpenDialer AppStderr "$dir\packages\server\data\server.log"
nssm set OpenDialer Start SERVICE_AUTO_START
nssm start OpenDialer
```

Remove: `nssm stop OpenDialer; nssm remove OpenDialer confirm`.

### Linux: systemd

```bash
sudo useradd --system --home /opt/opendialer --shell /usr/sbin/nologin opendialer
sudo git clone https://github.com/cyberkyd01/OpenDialer.git /opt/opendialer
cd /opt/opendialer
sudo ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci
sudo npm run build
sudo mkdir -p /var/lib/opendialer
sudo chown -R opendialer:opendialer /var/lib/opendialer
sudo cp scripts/linux/opendialer.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now opendialer
journalctl -u opendialer -f          # shows the banner with the URLs
```

The unit uses `DATA_DIR=/var/lib/opendialer` and `/usr/bin/node`. Put extra settings in
`/etc/opendialer.env` (one `KEY=value` per line) and `sudo systemctl restart opendialer`.

If `ufw` is active: `sudo ufw allow 8080/tcp && sudo ufw allow 8443/tcp`.

### macOS: launchd

1. Edit `scripts/macos/com.opendialer.server.plist`: replace `/usr/local/bin/node` with the
   output of `command -v node` and `/Users/you/OpenDialer` with your folder.
2. Install and start it:

   ```bash
   mkdir -p ~/OpenDialer/packages/server/data/logs
   cp scripts/macos/com.opendialer.server.plist ~/Library/LaunchAgents/
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.opendialer.server.plist
   ```

3. Restart it with `launchctl kickstart -k gui/$(id -u)/com.opendialer.server`, and stop and remove it with
   `launchctl bootout gui/$(id -u)/com.opendialer.server`.

This starts the server when you log in. To start at boot without login, see the comments in the plist
(LaunchDaemon). macOS asks once whether `node` may accept incoming network connections: click **Allow**.

## 7. Docker

The image is built from the included `Dockerfile` and runs as a non-root user. All data is stored in
the `/data` volume.

**Base image:** `node:22-bookworm-slim` (Debian). The database driver `better-sqlite3` is a native
module: on Debian (glibc) npm installs a prebuilt binary, while Alpine (musl) often needs a full
compile. Compilers are only installed in the build stages, so the final image stays small.

### With Docker Compose (easiest)

```bash
git clone https://github.com/cyberkyd01/OpenDialer.git
cd OpenDialer
docker compose up -d
docker compose logs -f          # wait for the "OpenDialer is running" banner
```

Open <http://localhost:8080>. Data is stored in `./data` next to `docker-compose.yml`. Edit the
`environment:` section of `docker-compose.yml` to change settings, then run `docker compose up -d` again.

> **Certificate and LAN IPs in Docker:** inside a container the server only knows the container's
> own IP, so the auto-generated certificate will not list your host's LAN IP. Agents will still
> get a certificate warning they can accept, but for a clean setup use a reverse proxy with a real
> certificate ([REMOTE-ACCESS.md](REMOTE-ACCESS.md)) or mount your own `cert.pem`/`key.pem` and set
> `TLS=/data/mycert`.
>
> **Linux bind-mount permissions:** the container runs as user `node` (uid 1000). If `./data`
> was created by root: `sudo chown -R 1000:1000 ./data`.

### With plain Docker

```bash
docker build -t opendialer .
docker run -d --name opendialer --restart unless-stopped \
  -p 8080:8080 -p 8443:8443 -v "$PWD/data:/data" opendialer
```

```powershell
docker build -t opendialer .
docker run -d --name opendialer --restart unless-stopped `
  -p 8080:8080 -p 8443:8443 -v "${PWD}\data:/data" opendialer
```

Command-line tools inside the container:

```bash
docker exec opendialer node packages/server/dist/cli.js backup
docker exec opendialer node packages/server/dist/cli.js reset-password admin "new-long-password"
```

## 8. Backups

Choose one or more:

1. **Admin console**: **System** page → **Create backup**. Backups are listed there and can be
   downloaded. They are written to the `backups/` folder of the data directory.
2. **Command line** (safe while the server is running):

   ```bash
   npm run backup -w @opendialer/server
   ```

   This writes `packages/server/data/backups/opendialer-<timestamp>.sqlite` (or `backups/` in your `DATA_DIR`). Run it from a scheduled task or cron job, for example
   daily at 23:00 on Linux: `0 23 * * * cd /opt/opendialer && DATA_DIR=/var/lib/opendialer npm run backup -w @opendialer/server`.
   (The command uses `DATA_DIR` too. Set it to the same value as the server.)
3. **Whole folder**: stop the server, copy the entire data directory (database, recordings,
   certificate, secret key) somewhere safe, then start it again.

Copy backups **off the machine** (NAS, cloud storage). A backup on the same disk does not survive a
disk failure.

**Restore:** stop the server, replace `opendialer.sqlite` in the data directory with the backup file (rename it to
`opendialer.sqlite`, delete `opendialer.sqlite-wal` and `-shm` if present), and start it again.

## 9. Upgrading

1. Make a backup (section 8).
2. Stop the server (or service).
3. Get the new version and rebuild:

   ```bash
   git pull
   npm install
   npm run build
   ```

   Docker: `git pull && docker compose up -d --build`.
4. Start the server. Database changes are applied automatically on start.
5. Ask agents to reload the console (the desktop app: **File → Reload**; Android: close and reopen
   the app).

## 10. Troubleshooting

| Problem | Fix |
|---|---|
| `Could not listen on port 8080` / `EADDRINUSE` | Another program uses the port. Find it: Windows `Get-NetTCPConnection -LocalPort 8080 \| Select OwningProcess` then `Get-Process -Id <id>`. macOS/Linux `sudo lsof -i :8080`. Stop it, or start OpenDialer with another port: `PORT=8081`. |
| Browser shows "Your connection is not private" / `NET::ERR_CERT_AUTHORITY_INVALID` on `https://...:8443` | Expected with the self-signed certificate. Click **Advanced → Proceed** once per device, or install `tls/cert.pem` from the data directory as trusted, or use a reverse proxy with a real certificate ([REMOTE-ACCESS.md](REMOTE-ACCESS.md)). |
| Certificate warning mentions the wrong name/IP | The server's IP changed after the certificate was created. Stop the server, delete the `tls/` folder in the data directory, start it again. |
| Softphone says microphone blocked / `getUserMedia` undefined | Browsers only allow the microphone on **https** (or `http://localhost`). Agents must use `https://<ip>:8443`, a proxied https address, or the desktop app. Also check the browser's site permissions (padlock icon → Microphone → Allow) and the OS privacy settings (Windows: Settings → Privacy → Microphone; macOS: System Settings → Privacy & Security → Microphone). |
| Agents on other PCs cannot open the page | Firewall. Windows: `New-NetFirewallRule -DisplayName OpenDialer -Direction Inbound -Protocol TCP -LocalPort 8080,8443 -Action Allow -Profile Private,Domain` (as Administrator). Check that the server PC's network is set to *Private*, not *Public*. |
| The page says "The web client is not built" | Run `npm run build` in the repository root and restart. |
| Forgot the admin password | `npm run reset-password -w @opendialer/server -- admin "new-long-password"` (set `DATA_DIR` first if the server uses a custom one). |
| `better-sqlite3` error after upgrading Node.js | Native module built for the old Node version: `npm rebuild better-sqlite3` (or delete `node_modules` and `npm install`). |
| Calls fail but the console works | That is the SIP/WebRTC side. See the troubleshooting table in [SIP-SETUP.md](SIP-SETUP.md). |

Run with more logging: `LOG_LEVEL=debug npm start` (PowerShell: `$env:LOG_LEVEL="debug"; npm start`).
