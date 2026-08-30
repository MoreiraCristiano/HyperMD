import { mkdtempSync, rmSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repository = resolve(import.meta.dirname, '..');
const workspaceRoot = mkdtempSync(join(tmpdir(), 'hypermd-e2e-'));
const artifacts = resolve(repository, 'e2e/artifacts');
const driverPort = randomInt(20_000, 60_000);
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('npm_execpath is required to run E2E commands.');
const environment = {
  ...process.env,
  HYPERMD_E2E_WORKSPACE: workspaceRoot,
  HYPERMD_E2E_DRIVER_PORT: String(driverPort),
  VITE_HYPERMD_E2E: '1',
};

function run(args) {
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd: repository,
    env: environment,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function stopWindowsDriverTree(port) {
  if (process.platform !== 'win32') return;
  const script = `
    function Stop-E2eProcessTree([int]$targetProcessId) {
      Get-CimInstance Win32_Process -Filter "ParentProcessId = $targetProcessId" |
        ForEach-Object { Stop-E2eProcessTree $_.ProcessId }
      Stop-Process -Id $targetProcessId -Force -ErrorAction SilentlyContinue
    }
    Get-CimInstance Win32_Process -Filter "Name = 'tauri-driver.exe'" |
      Where-Object CommandLine -Match '(^|\\s)--port\\s+${port}(\\s|$)' |
      ForEach-Object { Stop-E2eProcessTree $_.ProcessId }
  `;
  const cleanup = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      stdio: 'inherit',
    },
  );
  if (cleanup.error) console.warn(`Could not clean up E2E drivers: ${cleanup.error.message}`);
}

let exitCode = 1;
try {
  rmSync(artifacts, { recursive: true, force: true });
  const build = run([
    'run',
    'tauri',
    '--',
    'build',
    '--debug',
    '--no-bundle',
    '--features',
    'e2e',
    '--config',
    'e2e/tauri.e2e.conf.json',
    '--ci',
  ]);
  exitCode = build;
  if (exitCode === 0) {
    exitCode = run(['exec', '--', 'wdio', 'run', 'e2e/wdio.conf.mjs']);
  }
} finally {
  stopWindowsDriverTree(driverPort);
  rmSync(workspaceRoot, { recursive: true, force: true });
}

process.exitCode = exitCode;
