# Giving agents access to OpenDialer

OpenDialer runs on one computer. This page explains how agents reach it, both on the office network
and from home or another site.

**The one rule:** browsers only allow the **microphone** on **https://** pages (the only exception is
`http://localhost` on the server itself). Every agent therefore needs an https address.

- [1. Same office network (LAN)](#1-same-office-network-lan)
- [2. Remote agents](#2-remote-agents)
  - [Option A: Caddy (automatic HTTPS, easiest)](#option-a-caddy-automatic-https-easiest)
  - [Option B: nginx](#option-b-nginx)
  - [Option C: Cloudflare Tunnel (no open ports)](#option-c-cloudflare-tunnel-no-open-ports)
  - [Option D: Tailscale or WireGuard (private network)](#option-d-tailscale-or-wireguard-private-network)
- [3. Security checklist](#3-security-checklist)
- [4. Don't forget the phone system](#4-dont-forget-the-phone-system)

---

## 1. Same office network (LAN)

When the server starts it prints its addresses:

```text
  Open the console at:
    http://localhost:8080
    http://192.168.1.10:8080
    https://localhost:8443
    https://192.168.1.10:8443      <- agents use this one
```

### Step 1: open the firewall on the server

Windows (PowerShell **as Administrator**):

```powershell
New-NetFirewallRule -DisplayName "OpenDialer" -Direction Inbound -Protocol TCP -LocalPort 8080,8443 -Action Allow -Profile Private,Domain
```

Also make sure the server's network is set to **Private** (Settings → Network & Internet →
your connection → *Private network*). Public networks block incoming connections.

Linux with ufw: `sudo ufw allow 8443/tcp` (and `8080/tcp` if you want plain http on the LAN).
macOS: click **Allow** when asked whether `node` may accept incoming connections.

### Step 2: give the server a fixed IP address

Reserve the server's IP in your router (DHCP reservation), so the address and its certificate stay
valid. If the IP changes, stop the server, delete the `tls/` folder in the data directory and start it again.
This creates a new certificate that includes the new IP.

### Step 3: accept the certificate once on every agent device

OpenDialer creates its own (self-signed) certificate, so each device warns once:

- **Chrome / Edge (Windows, macOS, Linux):** open `https://192.168.1.10:8443`. On *"Your connection
  is not private"* click **Advanced → Continue to 192.168.1.10 (unsafe)**.
- **Firefox:** **Advanced… → Accept the Risk and Continue**.
- **Safari (macOS):** **Show Details → visit this website**, then confirm with your password.
- **Android (Chrome):** open the address, tap **Advanced → Proceed to 192.168.1.10 (unsafe)**.
  Then install the app (see [ANDROID.md](ANDROID.md)).
- **OpenDialer desktop app:** enter the address and click **Connect**, then **Trust** in the dialog.

The browser remembers this decision for a while (Chrome: usually until it restarts or for a few
days). To get rid of the warning permanently, trust the certificate (below) or use a real
certificate (section 2).

### Optional: trust the certificate on each device (no more warnings)

The certificate file is `tls/cert.pem` in the server's data directory (`packages/server/data/tls/cert.pem`
with a default install). Copy it to the agent's device, then:

**Windows** (PowerShell as Administrator; trusts it for Chrome, Edge and the desktop app):

```powershell
Copy-Item .\cert.pem .\opendialer.cer
Import-Certificate -FilePath .\opendialer.cer -CertStoreLocation Cert:\LocalMachine\Root
```

**macOS** (Terminal):

```bash
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain cert.pem
```

**Linux (Debian/Ubuntu, system-wide):** `sudo cp cert.pem /usr/local/share/ca-certificates/opendialer.crt && sudo update-ca-certificates`.
Chrome on Linux uses its own store: *Settings → Privacy and security → Security → Manage certificates →
Authorities → Import*.

**Firefox** (any OS): *Settings → Privacy & Security → Certificates → View Certificates → Authorities → Import*.

**Android:** copy the file to the phone and go to *Settings → Security & privacy → More security settings →
Encryption & credentials → Install a certificate → CA certificate* (menu names vary by brand).
Android is strict about self-signed server certificates, so on some versions Chrome still warns. If it does,
just accept the warning or use options A–D below.

Only trust a certificate you copied from **your own server**.

## 2. Remote agents

Do **not** open ports 8080/8443 on your router to the whole internet. Put OpenDialer behind one of
the following instead. All of them handle the WebSocket connection (Socket.IO at `/socket.io/`) that
OpenDialer uses for live updates.

| Option | You need | Certificate | Open ports |
|---|---|---|---|
| A. Caddy | a domain name, port 443 forwarded to the server | automatic (Let's Encrypt) | 80 + 443 |
| B. nginx | a domain name, port 443 forwarded | Let's Encrypt via certbot | 80 + 443 |
| C. Cloudflare Tunnel | a domain on Cloudflare (free plan is fine) | automatic (Cloudflare) | none |
| D. Tailscale / WireGuard | Tailscale (or WireGuard) installed on server **and** every agent device | `tailscale cert` / `tailscale serve` | none |

With a reverse proxy on the same machine you can keep using OpenDialer's own https port for the
office LAN, or set `TLS=off` and use only the proxied address. Set `PUBLIC_URL` to the public
address, for example `PUBLIC_URL=https://dialer.example.com`.

### Option A: Caddy (automatic HTTPS, easiest)

1. Point a DNS name (for example `dialer.example.com`) to your office's public IP, and forward ports
   **80 and 443** on the router to the server.
2. Install Caddy: <https://caddyserver.com/docs/install>
   (Windows: `winget install CaddyServer.Caddy`; macOS: `brew install caddy`; Debian/Ubuntu: see the link).
3. Create a file named `Caddyfile`:

   ```caddyfile
   dialer.example.com {
       reverse_proxy localhost:8080
   }
   ```

4. Run `caddy run` in that folder. For a permanent setup, Linux packages install a service that reads
   `/etc/caddy/Caddyfile` (`sudo systemctl reload caddy`).

Caddy obtains and renews the certificate and passes WebSockets through automatically. Agents use
`https://dialer.example.com`.

### Option B: nginx

```nginx
# /etc/nginx/sites-available/opendialer  (then: ln -s ../sites-available/opendialer /etc/nginx/sites-enabled/)
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl;
    http2 on;
    server_name dialer.example.com;

    ssl_certificate     /etc/letsencrypt/live/dialer.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dialer.example.com/privkey.pem;

    client_max_body_size 50m;          # lead CSV uploads and call recordings

    # Socket.IO (live agent/lead updates) needs the WebSocket upgrade headers
    location /socket.io/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name dialer.example.com;
    return 301 https://$host$request_uri;
}
```

Get the certificate with certbot: `sudo apt install certbot python3-certbot-nginx && sudo certbot --nginx -d dialer.example.com`,
then `sudo nginx -t && sudo systemctl reload nginx`. (Older nginx before 1.25: use `listen 443 ssl http2;` and drop the `http2 on;` line.)

### Option C: Cloudflare Tunnel (no open ports)

The server makes an outgoing connection to Cloudflare, so nothing has to be opened on your router.
WebSockets are enabled by default.

1. Add your domain to Cloudflare (free plan).
2. Install `cloudflared` on the server: Windows `winget install --id Cloudflare.cloudflared`,
   macOS `brew install cloudflared`, Linux: <https://pkg.cloudflare.com>.
3. Create the tunnel:

   ```bash
   cloudflared tunnel login
   cloudflared tunnel create opendialer
   cloudflared tunnel route dns opendialer dialer.example.com
   ```

4. Create `~/.cloudflared/config.yml` (Windows: `%USERPROFILE%\.cloudflared\config.yml`):

   ```yaml
   tunnel: opendialer
   credentials-file: /home/you/.cloudflared/<tunnel-id>.json   # path printed by "tunnel create"
   ingress:
     - hostname: dialer.example.com
       service: http://localhost:8080
     - service: http_status:404
   ```

5. Test with `cloudflared tunnel run opendialer`, then install it as a service:
   `cloudflared service install` (run as Administrator / with sudo).

Alternatively create the tunnel in the Cloudflare dashboard (*Zero Trust → Networks → Tunnels*), which
gives you a one-line install command, and add a public hostname pointing to `http://localhost:8080`.
Cloudflare Access can add a second login (for example email one-time code) in front of OpenDialer.

### Option D: Tailscale or WireGuard (private network)

Agents join a private network, so OpenDialer is never visible on the internet.

**Tailscale** (free for small teams):

1. Install Tailscale on the server and every agent PC/phone (<https://tailscale.com/download>) and
   log in to the same tailnet.
2. In the Tailscale admin console enable **MagicDNS** and **HTTPS certificates**.
3. Give OpenDialer a trusted certificate. Either:
   - **Simplest:** on the server run `tailscale serve --bg 8080`. Agents then open
     `https://<server-name>.<your-tailnet>.ts.net` (port 443, real certificate, no warnings), or
   - use `tailscale cert`, then point OpenDialer's `TLS` setting at it:

     ```bash
     mkdir -p /opt/opendialer-tls && cd /opt/opendialer-tls
     tailscale cert --cert-file cert.pem --key-file key.pem <server-name>.<your-tailnet>.ts.net
     # then start OpenDialer with TLS=/opt/opendialer-tls
     ```

     Agents open `https://<server-name>.<your-tailnet>.ts.net:8443`. These certificates last 90 days,
     so repeat the `tailscale cert` command monthly (scheduled task / cron) and restart OpenDialer.

**WireGuard:** agents connect to the office VPN and use the LAN address from section 1 exactly
like in the office (including accepting or trusting the self-signed certificate).

## 3. Security checklist

- [ ] **Strong admin password**, a separate account for every person, and deactivate accounts of
      people who leave (Users page).
- [ ] **TRUST_PROXY:** leave it `true` (default) when a proxy/tunnel is in front, so login lockouts and
      the audit log see the real client IP. Set `TRUST_PROXY=false` if the server is reachable
      directly without a proxy, otherwise clients could fake their IP.
- [ ] **Keep port 8080 private** when you use a proxy: don't forward it on the router. If the proxy
      runs on the same machine you can also set `HOST=127.0.0.1` (this disables direct LAN access to
      8443 too, so then the whole office uses the proxied address).
- [ ] **CORS_ORIGINS:** leave empty. Set it only if you host the web console on a different
      address than the server.
- [ ] **API keys** (Admin → API keys) act as full administrators. Create one per integration,
      store them like passwords, and delete unused ones.
- [ ] **Backups** are copied off the machine ([DEPLOYMENT.md](DEPLOYMENT.md#8-backups)).
- [ ] Keep the server's OS, Node.js and OpenDialer up to date.
- [ ] Lead data is personal data: limit who is a supervisor/admin and see [COMPLIANCE.md](COMPLIANCE.md).

## 4. Don't forget the phone system

OpenDialer's server only coordinates agents, leads and calls. **The call audio does not go through it.**
Each agent's softphone (browser, desktop app or phone) connects **directly** to your PBX or SIP provider:

```text
agent device ──https/wss──▶ OpenDialer server         (console, leads, live updates)
agent device ──wss (SIP)──▶ PBX / SIP provider         (call signalling)
agent device ◀──SRTP/UDP──▶ PBX / provider / TURN      (call audio)
```

So remote agents also need to reach:

- the PBX/provider's **WSS address** (for example `wss://pbx.example.com:8089/ws`) with a certificate
  their browser trusts, and
- the media path: **STUN/TURN** servers, plus the PBX's RTP port range if the PBX is in your office.
  Without a reachable TURN server, calls from home networks often connect with **no audio or one-way audio**.

Details and examples: [SIP-SETUP.md](SIP-SETUP.md).
