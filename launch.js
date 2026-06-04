// Launches Electron with a clean environment.
//
// This machine has ELECTRON_RUN_AS_NODE=1 set globally (inherited from other
// Electron tooling). When that var is present, the Electron binary runs as
// plain Node instead of a browser, so `require('electron')` returns a path
// string and `app` is undefined. We strip it here before spawning Electron.
const { spawn } = require('child_process');
const electronBinary = require('electron'); // resolves to the binary path under Node

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, ['.'], { stdio: 'inherit', env });
child.on('close', (code) => process.exit(code ?? 0));
