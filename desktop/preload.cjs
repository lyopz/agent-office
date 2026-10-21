'use strict';
// The renderer's only door to the machine: save files and voice input, through fixed IPC channels.
// Save calls are synchronous so the office loads before the first render and the last save completes while the
// window closes. No paths, no environment, no Node APIs are exposed.
const { contextBridge, ipcRenderer } = require('electron');

const call = (channel, ...args) => ipcRenderer.sendSync(channel, ...args);

contextBridge.exposeInMainWorld('officeDesktop', {
  version: 1,
  platform: process.platform,
  saves: {
    read: () => call('saves:read'),
    readBackup: () => call('saves:readBackup'),
    write: (text, opts) => call('saves:write', String(text), { rotateBackup: !(opts && opts.rotateBackup === false) }),
    keepDamaged: (text) => call('saves:keepDamaged', String(text)),
    info: () => call('saves:info'),
  },
  // One spoken phrase, heard by Windows' offline speech recognition; resolves { ok, text } or { ok: false, error }.
  voice: {
    listen: () => ipcRenderer.invoke('voice:listen'),
    stop: () => ipcRenderer.invoke('voice:stop'),
    // Offline natural voices (Kokoro, Piper) once npm.cmd run get-voices has downloaded them; names are "engine:voice"
    voices: () => ipcRenderer.invoke('voice:voices'),
    say: (text, name) => ipcRenderer.invoke('voice:say', String(text), String(name || '')),
    // Hey JARVIS: turn the wake-phrase listener on or off, and hear when it fires
    wake: (on) => ipcRenderer.invoke('voice:wake', !!on),
    onWake: (fn) => { const h = () => fn(); ipcRenderer.on('voice:woke', h); return () => ipcRenderer.removeListener('voice:woke', h); },
    onWakeError: (fn) => { const h = (_e, msg) => fn(String(msg)); ipcRenderer.on('voice:wake-error', h); return () => ipcRenderer.removeListener('voice:wake-error', h); },
  },
});
