const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const mainEntry = path.join(root, 'dist/main/main.js');
const deadline = Date.now() + 30_000;

function rendererReady() {
  return new Promise((resolve) => {
    const request = http.get('http://localhost:5174', (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });
    request.setTimeout(500, () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

async function waitForBuilds() {
  while (Date.now() < deadline) {
    if (fs.existsSync(mainEntry) && await rendererReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Timed out waiting for Vite and the Electron main-process build.');
}

async function start() {
  await waitForBuilds();
  const electron = require('electron');
  const child = spawn(electron, ['.'], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'development' },
    stdio: 'inherit',
  });

  const forwardSignal = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  process.once('SIGINT', () => forwardSignal('SIGINT'));
  process.once('SIGTERM', () => forwardSignal('SIGTERM'));
  child.once('error', (error) => {
    console.error('[electron] Failed to start:', error);
    process.exitCode = 1;
  });
  child.once('close', (code) => process.exit(code ?? 0));
}

start().catch((error) => {
  console.error(`[electron] ${error.message}`);
  process.exit(1);
});
