'use strict';
// The renderer's only door to the machine: save files, through fixed IPC channels. Calls are
// synchronous so the office loads before the first render and the last save completes while the
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
});
