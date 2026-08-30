import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const repository = resolve(import.meta.dirname, '..');
const extension = process.platform === 'win32' ? '.exe' : '';
const appBinaryPath = resolve(repository, `src-tauri/target/debug/hypermd${extension}`);
const artifacts = resolve(repository, 'e2e/artifacts');
const driverPort = Number.parseInt(process.env.HYPERMD_E2E_DRIVER_PORT ?? '', 10);
if (!Number.isInteger(driverPort)) throw new Error('HYPERMD_E2E_DRIVER_PORT is required.');
mkdirSync(artifacts, { recursive: true });

export const config = {
  runner: 'local',
  specs: [resolve(repository, 'e2e/specs/**/*.e2e.mjs')],
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'tauri',
      'tauri:options': { application: appBinaryPath },
    },
  ],
  services: [
    [
      '@wdio/tauri-service',
      {
        appBinaryPath,
        driverProvider: 'external',
        autoInstallTauriDriver: true,
        autoDownloadEdgeDriver: true,
        tauriDriverPort: driverPort,
        env: { HYPERMD_E2E_WORKSPACE: process.env.HYPERMD_E2E_WORKSPACE },
        logDir: artifacts,
      },
    ],
  ],
  framework: 'mocha',
  reporters: [['spec', { addFileInfo: true }]],
  outputDir: artifacts,
  logLevel: 'info',
  waitforTimeout: 10_000,
  connectionRetryTimeout: 90_000,
  connectionRetryCount: 2,
  mochaOpts: { timeout: 120_000 },
  afterTest: async function (test, _context, result) {
    if (result.passed) return;
    const name = test.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    await browser.saveScreenshot(resolve(artifacts, `${name}.png`));
  },
};
