/**
 * OpenDialer desktop - preload script (runs sandboxed, with context isolation).
 *
 * Exposes to every page:
 *   window.opendialerDesktop = { version, platform }
 * so the web client can detect it runs inside the desktop app.
 *
 * Only the bundled connect page (file://.../connect.html) additionally gets
 *   window.opendialerConnect = { check(url), open(url) }
 * The main process re-checks the sender before acting on these calls.
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const info = ipcRenderer.sendSync('desktop:info') || {};

contextBridge.exposeInMainWorld('opendialerDesktop', Object.freeze({
  version: String(info.version || ''),
  platform: String(info.platform || ''),
}));

if (window.location.protocol === 'file:' && /\/connect\.html$/i.test(window.location.pathname)) {
  contextBridge.exposeInMainWorld('opendialerConnect', Object.freeze({
    check: (url) => ipcRenderer.invoke('connect:check', String(url)),
    open: (url) => ipcRenderer.invoke('connect:open', String(url)),
  }));
}
