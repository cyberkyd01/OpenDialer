# OpenDialer Desktop

A small desktop app (Windows, macOS, Linux) for agents and supervisors. It opens your
OpenDialer server's web console in its own window, so agents get:

- a dedicated window with its own taskbar/dock icon, which remembers its size and position,
- microphone and desktop notifications without browser permission prompts (allowed **only** for
  your OpenDialer server),
- a softphone that keeps ringing and counting while the window is minimised,
- a tray icon on Windows/Linux, with optional "minimise to tray",
- a one-time "trust this certificate" prompt for servers that use the self-signed certificate
  OpenDialer creates on first start.

The desktop app contains no dialer logic. Everything runs on the OpenDialer server, so you can
use the desktop app, a browser, and Android phones (PWA) side by side.

## Install (agents)

1. Download the installer for your system from the project's Releases page, or ask your administrator for it:
   - **Windows:** `OpenDialer Setup x.y.z.exe` (installer) or `OpenDialer x.y.z.exe` (portable, no install needed)
   - **macOS:** `OpenDialer-x.y.z.dmg` (Intel) or `OpenDialer-x.y.z-arm64.dmg` (Apple Silicon)
   - **Linux:** `OpenDialer-x.y.z.AppImage` (`chmod +x` it, then run it) or `opendialer-desktop_x.y.z_amd64.deb`
     (`sudo apt install ./opendialer-desktop_*.deb`)
2. Start **OpenDialer**. The first time, it asks for the **server address**:
   - same computer as the server: `https://localhost:8443`
   - office network: the `https://<server-ip>:8443` address shown when the server starts
   - remote/over the internet: the https address your administrator gave you (for example `https://dialer.example.com`)
3. Click **Connect**. The app checks `<address>/api/health` and shows the server version, then opens the console.
4. If the server uses OpenDialer's self-signed certificate, a dialog asks
   *"This server uses a self-signed certificate. Trust it?"* Click **Trust**. The app remembers the
   certificate's fingerprint for that host. If the certificate changes later, you are asked again
   with a warning.
5. Log in with the username and password your administrator created.

> The installers are not code-signed unless your organisation signs them. Windows SmartScreen may
> show "Windows protected your PC": click **More info, Run anyway**. On macOS, right-click the app,
> choose **Open**, then confirm.

## Everyday use

| Menu | What it does |
|---|---|
| File → Change server… | Forget the saved address and show the connect screen again |
| File → Reload (Ctrl/Cmd+R) | Reload the console |
| File → Minimise to tray (Windows/Linux) | When ticked, closing the window hides it to the tray instead of quitting. On by default on Windows |
| File → Quit (Ctrl/Cmd+Q) | Really quit, even with minimise to tray on |
| View → Toggle Dark/Light (Ctrl/Cmd+Shift+L) | Switch the app between dark and light |
| View → Zoom / Toggle DevTools | Zoom in/out/reset; developer tools for troubleshooting |
| Help → About | App version, server address, location of the settings file |
| Help → Open documentation | Opens the project page in your browser |

Links to other websites open in your normal browser, not in the app.

## Where settings are stored

Settings are kept in `config.json` in the app's user-data folder:

| OS | Path |
|---|---|
| Windows | `%APPDATA%\@opendialer\desktop\config.json` |
| macOS | `~/Library/Application Support/@opendialer/desktop/config.json` |
| Linux | `~/.config/@opendialer/desktop/config.json` |

Help → About shows the exact path. The file contains:

```json
{
  "serverUrl": "https://192.168.1.10:8443",
  "trustedCertificates": { "192.168.1.10": "sha256/…" },
  "bounds": { "x": 100, "y": 80, "width": 1280, "height": 820 },
  "maximized": false,
  "minimiseToTray": true,
  "theme": "system"
}
```

To **pre-configure** many PCs, copy a `config.json` that contains only `serverUrl` into that
folder before first start. To **reset** the app, quit it and delete the file.

## Pointing it at a remote server

Any address that serves the OpenDialer web console works. Use a real (publicly trusted)
certificate for internet access, for example from Caddy, nginx with Let's Encrypt, a Cloudflare
Tunnel, or `tailscale cert`. See [docs/REMOTE-ACCESS.md](../../docs/REMOTE-ACCESS.md). Then:

1. File → **Change server…**
2. Enter `https://dialer.example.com` and click **Connect**.

Plain `http://` addresses work but are not recommended. Microphones need a secure connection,
so for a non-localhost `http://` server the app restarts itself once and treats only that one
address as secure.

Calls themselves (audio) go from the softphone straight to your PBX / SIP provider over WSS.
That address must be reachable from the agent's PC as well. See [docs/SIP-SETUP.md](../../docs/SIP-SETUP.md).

## Security model

- `contextIsolation`, `sandbox` and no Node.js integration in the page. The page only sees
  `window.opendialerDesktop = { version, platform }`.
- Permissions: microphone (audio only), notifications and clipboard-write are granted to the
  configured server origin, and everything else is denied.
- Certificate errors are only ever accepted for the configured server host, after the user
  confirms, and pinned to the certificate fingerprint.
- Navigation away from the server origin is blocked; such links open in the system browser.
- Single instance: starting the app again just focuses the existing window.

## Building from source (developers)

From the repository root:

```bash
npm install
npm run desktop          # run the app against any server (same as: cd packages/desktop && npm start)
npm run desktop:dist     # build installers for the current OS into packages/desktop/release/
```

Inside `packages/desktop`:

```bash
npm start            # electron .
npm run smoke        # opens the connect page, prints SMOKE_OK, exits 0 after 3 s
npm run dist:win     # NSIS installer + portable exe (x64)
npm run dist:mac     # dmg for x64 + arm64 (build on a Mac)
npm run dist:linux   # AppImage + deb
npm run gen-icon     # regenerate build/icon.png (dependency-free script in /scripts)
```

Notes:

- If you run these from a VS Code terminal and Electron behaves like plain Node.js
  (`Cannot read properties of undefined (reading 'setAppUserModelId')`), the terminal has
  `ELECTRON_RUN_AS_NODE=1` set. Clear it first: PowerShell `Remove-Item Env:ELECTRON_RUN_AS_NODE`,
  bash `unset ELECTRON_RUN_AS_NODE`.
- electron-builder generates `.ico`/`.icns` from `build/icon.png`. macOS builds must be made on a
  Mac; for distribution outside your company, sign and notarise them (set `CSC_LINK` /
  `APPLE_ID` env vars, see the electron-builder docs). Signed macOS builds need the
  `com.apple.security.device.audio-input` entitlement for the microphone.
- Windows code signing: set `CSC_LINK` and `CSC_KEY_PASSWORD` before `npm run dist:win`.
