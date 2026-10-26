/**
 * OpenDialer desktop - Electron main process.
 *
 * A thin, secure shell around the OpenDialer web console:
 *   - asks for the server URL once (src/connect.html) and remembers it,
 *   - trusts a self-signed server certificate only for the configured host,
 *     after asking the user, pinned to the certificate fingerprint,
 *   - grants microphone + notifications only to the configured server origin,
 *   - keeps timers / ring tones running while minimised (backgroundThrottling off),
 *   - tray icon with "minimise to tray" on Windows / Linux.
 *
 * Config lives in <userData>/config.json (see README.md for the locations).
 * `electron . --smoke` opens the connect page, prints SMOKE_OK and exits 0 (CI / self-test).
 */
'use strict';

const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, nativeTheme, screen, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');

const SMOKE = process.argv.includes('--smoke');
const DOCS_URL = 'https://github.com/cyberkyd01/OpenDialer';
const DEFAULT_SERVER = 'https://localhost:8443';
const CONNECT_PAGE = path.join(__dirname, 'connect.html');
const ICON_PATH = path.join(__dirname, '..', 'build', 'icon.png');
const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
/** Permissions granted to the configured server origin. Everything else is denied. */
const ALLOWED_PERMISSIONS = new Set(['media', 'notifications', 'clipboard-sanitized-write']);

/* ------------------------------------------------------------------ */
/* config                                                              */
/* ------------------------------------------------------------------ */

const DEFAULT_CONFIG = {
  serverUrl: null,
  /** { [hostname]: certificate fingerprint ("sha256/...") the user agreed to trust } */
  trustedCertificates: {},
  bounds: null,
  maximized: false,
  minimiseToTray: IS_WIN,
  theme: 'system',
};

function configFile() {
  return path.join(app.getPath('userData'), 'config.json');
}

function loadConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    return { ...DEFAULT_CONFIG, ...parsed, trustedCertificates: { ...(parsed.trustedCertificates || {}) } };
  } catch {
    return { ...DEFAULT_CONFIG, trustedCertificates: {} };
  }
}

let config = DEFAULT_CONFIG;

function saveConfig() {
  if (SMOKE) return; // never touch the user's config during a smoke test
  try {
    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    const tmp = configFile() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
    fs.renameSync(tmp, configFile());
  } catch (err) {
    console.error('Could not save config:', err);
  }
}

/** Normalise user input to an origin-only URL (scheme://host[:port]) or throw. */
function normaliseServerUrl(input) {
  let s = String(input || '').trim();
  if (!s) throw new Error('Please enter the server address.');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
  const u = new URL(s);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('The address must start with https:// or http://');
  if (!u.hostname) throw new Error('The address has no host name.');
  return u.origin;
}

function serverOrigin() {
  try {
    return config.serverUrl ? new URL(config.serverUrl).origin : null;
  } catch {
    return null;
  }
}

function isServerOrigin(urlOrOrigin) {
  const origin = serverOrigin();
  if (!origin || !urlOrOrigin) return false;
  try {
    return new URL(urlOrOrigin).origin === origin;
  } catch {
    return false;
  }
}

function isLocalHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

/* ------------------------------------------------------------------ */
/* early process setup (must run before "ready")                       */
/* ------------------------------------------------------------------ */

if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

config = loadConfig();
app.setAppUserModelId('com.opendialer.desktop'); // Windows: needed for native notifications
// Ring tones / alerts must play without a click first.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Microphone access needs a secure context. For a plain-http LAN server (not recommended,
// prefer https://<ip>:8443) treat exactly that origin as secure. Switches only apply at start.
(() => {
  const origin = serverOrigin();
  if (!origin) return;
  const u = new URL(origin);
  if (u.protocol === 'http:' && !isLocalHost(u.hostname)) {
    app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', origin);
  }
})();
const insecureOriginAtStart = app.commandLine.getSwitchValue('unsafely-treat-insecure-origin-as-secure') || null;

/* ------------------------------------------------------------------ */
/* window                                                              */
/* ------------------------------------------------------------------ */

/** @type {BrowserWindow | null} */
let win = null;
/** @type {Tray | null} */
let tray = null;
let quitting = false;

function visibleBounds(bounds) {
  if (!bounds || typeof bounds.width !== 'number') return null;
  const onScreen = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return bounds.x < a.x + a.width - 50 && bounds.x + bounds.width > a.x + 50 && bounds.y >= a.y - 10 && bounds.y < a.y + a.height - 50;
  });
  return onScreen ? bounds : { width: bounds.width, height: bounds.height };
}

function createWindow() {
  const saved = visibleBounds(config.bounds);
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    ...(saved || {}),
    show: false,
    title: 'OpenDialer',
    icon: ICON_PATH,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f172a' : '#f8fafc',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
      // keep softphone timers, Socket.IO heartbeats and ring tones running while minimised
      backgroundThrottling: false,
    },
  });
  if (config.maximized && !SMOKE) win.maximize();
  win.once('ready-to-show', () => {
    if (SMOKE) win.showInactive();
    else win.show();
  });

  let boundsTimer = null;
  const rememberBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      config.maximized = win.isMaximized();
      if (!config.maximized && !win.isMinimized() && !win.isFullScreen()) config.bounds = win.getBounds();
      saveConfig();
    }, 400);
  };
  win.on('resize', rememberBounds);
  win.on('move', rememberBounds);
  win.on('maximize', rememberBounds);
  win.on('unmaximize', rememberBounds);

  win.on('close', (e) => {
    if (!quitting && tray && config.minimiseToTray && !IS_MAC) {
      e.preventDefault();
      win.hide();
      return;
    }
    if (!win.isMaximized() && !win.isMinimized()) config.bounds = win.getBounds();
    config.maximized = win.isMaximized();
    saveConfig();
  });
  win.on('closed', () => {
    win = null;
  });

  const wc = win.webContents;
  // Only the configured server and the bundled connect page may be shown in the window.
  wc.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (url.startsWith('file:') && url.split('?')[0] === pathToFileUrl(CONNECT_PAGE)) return;
    if (isServerOrigin(url)) return;
    e.preventDefault();
    openExternalSafe(url);
  });
  wc.on('did-fail-load', (_e, code, description, validatedURL, isMainFrame) => {
    if (!isMainFrame || code === -3 /* ABORTED */) return;
    if (validatedURL.startsWith('file:')) return;
    showConnectPage(`Could not open ${validatedURL}: ${description} (${code})`);
  });
  wc.on('page-title-updated', (e, title) => {
    e.preventDefault();
    win.setTitle(title && !/^opendialer$/i.test(title) ? `${title} - OpenDialer` : 'OpenDialer');
  });

  if (SMOKE || !config.serverUrl) showConnectPage();
  else win.loadURL(config.serverUrl);
}

function pathToFileUrl(p) {
  return require('node:url').pathToFileURL(p).href;
}

function openExternalSafe(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:' || u.protocol === 'tel:') shell.openExternal(u.href);
  } catch {
    /* ignore malformed URLs */
  }
}

function showConnectPage(error) {
  if (!win) return;
  const query = { url: config.serverUrl || DEFAULT_SERVER };
  if (error) query.error = error;
  win.loadFile(CONNECT_PAGE, { query });
}

function showWindow() {
  if (!win) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/* ------------------------------------------------------------------ */
/* certificates & permissions                                          */
/* ------------------------------------------------------------------ */

/** hostname -> pending trust prompt, so parallel requests only ask once */
const pendingPrompts = new Map();

function onCertificateError(event, _webContents, url, error, certificate, callback) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return callback(false);
  }
  const origin = serverOrigin();
  if (!origin || new URL(origin).hostname !== host) return callback(false); // never for third-party hosts
  event.preventDefault();
  if (config.trustedCertificates[host] === certificate.fingerprint) return callback(true);

  let prompt = pendingPrompts.get(host);
  if (!prompt) {
    const changed = Boolean(config.trustedCertificates[host]);
    prompt = dialog
      .showMessageBox(win && !win.isDestroyed() ? win : undefined, {
        type: changed ? 'warning' : 'question',
        buttons: ['Trust', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        title: 'Server certificate',
        message: changed
          ? `The certificate of ${host} has CHANGED since you last trusted it. Trust the new certificate?`
          : 'This server uses a self-signed certificate. Trust it?',
        detail:
          `Server: ${host}\nIssued to: ${certificate.subjectName}\nIssuer: ${certificate.issuerName}\n` +
          `Fingerprint: ${certificate.fingerprint}\nError: ${error}\n\n` +
          'Only trust it if this is your own OpenDialer server (the fingerprint can be compared with the one your administrator gives you).',
      })
      .then(({ response }) => {
        const ok = response === 0;
        if (ok) {
          config.trustedCertificates[host] = certificate.fingerprint;
          saveConfig();
        }
        return ok;
      })
      .finally(() => pendingPrompts.delete(host));
    pendingPrompts.set(host, prompt);
  }
  prompt.then((ok) => callback(ok && config.trustedCertificates[host] === certificate.fingerprint));
}

function mediaIsAudioOnly(details) {
  const types = details && details.mediaTypes;
  return !types || types.length === 0 || types.every((t) => t === 'audio');
}

function setupPermissions(ses) {
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const url = (details && (details.requestingUrl || details.securityOrigin)) || '';
    let ok = ALLOWED_PERMISSIONS.has(permission) && isServerOrigin(url);
    if (ok && permission === 'media') ok = mediaIsAudioOnly(details);
    callback(ok);
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
    if (!ALLOWED_PERMISSIONS.has(permission)) return false;
    if (!isServerOrigin(requestingOrigin)) return false;
    if (permission === 'media' && details && details.mediaType && details.mediaType !== 'audio' && details.mediaType !== 'unknown') return false;
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* IPC for the connect page                                            */
/* ------------------------------------------------------------------ */

function fromConnectPage(event) {
  const url = (event.senderFrame && event.senderFrame.url) || '';
  return url.split('?')[0] === pathToFileUrl(CONNECT_PAGE);
}

/**
 * GET <origin>/api/health. Certificate validation is relaxed ONLY for this probe so a
 * self-signed server can be identified; the window itself still goes through
 * the certificate-error prompt above.
 */
function probeHealth(origin) {
  return new Promise((resolve) => {
    const target = new URL('/api/health', origin);
    const mod = target.protocol === 'https:' ? https : http;
    const req = mod.request(
      target,
      { method: 'GET', timeout: 8000, headers: { accept: 'application/json' }, ...(target.protocol === 'https:' ? { rejectUnauthorized: false } : {}) },
      (res) => {
        const trusted = target.protocol === 'https:' ? Boolean(res.socket && res.socket.authorized) : null;
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => {
          body += c;
          if (body.length > 64 * 1024) req.destroy(new Error('Response too large'));
        });
        res.on('end', () => {
          if (res.statusCode !== 200) return resolve({ ok: false, error: `The server answered HTTP ${res.statusCode}. Is this an OpenDialer server?` });
          try {
            const json = JSON.parse(body);
            if (!json || json.ok !== true) throw new Error('bad');
            resolve({ ok: true, url: origin, version: String(json.version || '?'), certificateTrusted: trusted });
          } catch {
            resolve({ ok: false, error: 'The address answered, but it does not look like an OpenDialer server.' });
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timed out after 8 s')));
    req.on('error', (err) => resolve({ ok: false, error: `Could not reach ${origin}: ${err.code || err.message}` }));
    req.end();
  });
}

ipcMain.on('desktop:info', (event) => {
  event.returnValue = { version: app.getVersion(), platform: process.platform };
});

ipcMain.handle('connect:check', async (event, input) => {
  if (!fromConnectPage(event)) return { ok: false, error: 'Not allowed' };
  let origin;
  try {
    origin = normaliseServerUrl(input);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  return probeHealth(origin);
});

ipcMain.handle('connect:open', async (event, input) => {
  if (!fromConnectPage(event)) return { ok: false, error: 'Not allowed' };
  let origin;
  try {
    origin = normaliseServerUrl(input);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  config.serverUrl = origin;
  saveConfig();
  buildMenu();
  const u = new URL(origin);
  if (u.protocol === 'http:' && !isLocalHost(u.hostname) && insecureOriginAtStart !== origin && !SMOKE) {
    // the "treat as secure" switch for microphone access only takes effect on start
    app.relaunch();
    quitting = true;
    app.exit(0);
    return { ok: true, relaunching: true };
  }
  win.loadURL(origin);
  return { ok: true };
});

/* ------------------------------------------------------------------ */
/* menu & tray                                                         */
/* ------------------------------------------------------------------ */

function changeServer() {
  config.serverUrl = null;
  saveConfig();
  buildMenu();
  showWindow();
  showConnectPage();
}

function toggleTheme() {
  nativeTheme.themeSource = nativeTheme.shouldUseDarkColors ? 'light' : 'dark';
  config.theme = nativeTheme.themeSource;
  saveConfig();
}

function showAbout() {
  dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
    type: 'info',
    title: 'About OpenDialer',
    message: `OpenDialer Desktop ${app.getVersion()}`,
    detail: [
      `Server: ${config.serverUrl || '(not connected)'}`,
      `Electron ${process.versions.electron} / Chromium ${process.versions.chrome} / Node ${process.versions.node}`,
      `Settings file: ${configFile()}`,
      '',
      'Self-hosted call-center dialer. MIT licensed.',
    ].join('\n'),
    buttons: ['OK'],
  });
}

function buildMenu() {
  const fileMenu = {
    label: 'File',
    submenu: [
      { label: 'Change server…', click: changeServer },
      { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => win && win.webContents.reload() },
      { type: 'separator' },
      ...(!IS_MAC
        ? [
            {
              label: 'Minimise to tray',
              type: 'checkbox',
              checked: Boolean(config.minimiseToTray),
              click: (item) => {
                config.minimiseToTray = item.checked;
                saveConfig();
              },
            },
            { type: 'separator' },
          ]
        : []),
      { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: quit },
    ],
  };
  const template = [
    ...(IS_MAC ? [{ role: 'appMenu' }] : []),
    fileMenu,
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Dark/Light', accelerator: 'CmdOrCtrl+Shift+L', click: toggleTheme },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'About OpenDialer', click: showAbout },
        { label: 'Open documentation', click: () => shell.openExternal(DOCS_URL) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  if (IS_MAC || SMOKE) return; // macOS uses the dock
  try {
    const image = nativeImage.createFromPath(ICON_PATH).resize({ width: IS_WIN ? 16 : 24, height: IS_WIN ? 16 : 24 });
    tray = new Tray(image);
  } catch (err) {
    console.error('Tray not available:', err.message);
    tray = null;
    return;
  }
  tray.setToolTip('OpenDialer');
  const toggle = () => {
    if (win && win.isVisible() && !win.isMinimized()) win.hide();
    else showWindow();
  };
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show / hide OpenDialer', click: toggle },
      { type: 'separator' },
      { label: 'Quit', click: quit },
    ]),
  );
  tray.on('click', toggle);
}

function quit() {
  quitting = true;
  app.quit();
}

/* ------------------------------------------------------------------ */
/* lifecycle                                                           */
/* ------------------------------------------------------------------ */

app.on('second-instance', () => showWindow());
app.on('before-quit', () => {
  quitting = true;
});
app.on('certificate-error', onCertificateError);
app.on('window-all-closed', () => {
  if (!IS_MAC) app.quit();
});
app.on('activate', () => showWindow());
app.on('web-contents-created', (_e, contents) => {
  // no <webview> tags, ever
  contents.on('will-attach-webview', (ev) => ev.preventDefault());
});

app.whenReady().then(() => {
  nativeTheme.themeSource = ['light', 'dark', 'system'].includes(config.theme) ? config.theme : 'system';
  setupPermissions(session.defaultSession);
  buildMenu();
  createTray();
  createWindow();

  if (SMOKE) {
    let loaded = false;
    win.webContents.once('did-finish-load', () => {
      loaded = true;
    });
    setTimeout(() => {
      const ok = loaded && win && !win.isDestroyed();
      process.stdout.write(ok ? 'SMOKE_OK\n' : 'SMOKE_FAIL: connect page did not load\n');
      quitting = true;
      app.exit(ok ? 0 : 1);
    }, 3000);
  }
});
