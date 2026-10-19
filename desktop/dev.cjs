'use strict';
// `npm run desktop:dev`: open the desktop shell on the running Vite dev server (start it with
// `npm run dev`). Set OFFICE_DEV_SERVER_URL to use another local port.
const { spawn } = require('node:child_process');
const path = require('node:path');
const electron = require('electron'); // the path to the Electron binary when required from Node

const env = { ...process.env, OFFICE_DEV_SERVER_URL: process.env.OFFICE_DEV_SERVER_URL || 'http://localhost:5173' };
const child = spawn(electron, [path.resolve(__dirname, '..')], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
