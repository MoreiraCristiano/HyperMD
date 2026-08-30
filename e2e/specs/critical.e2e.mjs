import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const workspaceRoot = process.env.HYPERMD_E2E_WORKSPACE;
if (!workspaceRoot) throw new Error('HYPERMD_E2E_WORKSPACE is required.');

let testDirectory;
let outsideDirectory;

async function waitForApp() {
  const activeHandle = await browser.getWindowHandle();
  await browser.switchToWindow(activeHandle);
  await browser.$('.ProseMirror').waitForDisplayed({ timeout: 15_000 });
  await browser.waitUntil(
    () => browser.executeScript('return Boolean(window.__HYPERMD_E2E__);', []),
    {
      timeout: 10_000,
      timeoutMsg: 'HyperMD E2E API was not installed.',
    },
  );
}

async function callApp(method, ...args) {
  return browser.executeAsyncScript(
    `const methodName = arguments[0];
     const methodArgs = arguments[1];
     const done = arguments[arguments.length - 1];
     const api = window.__HYPERMD_E2E__;
     if (!api) {
       done({ ok: false, error: 'HyperMD E2E API is unavailable.' });
       return;
     }
     Promise.resolve(api[methodName](...methodArgs)).then(
       (value) => done({ ok: true, value }),
       (error) => done({
         ok: false,
         error: error instanceof Error
           ? error.message
           : typeof error === 'string'
             ? error
             : JSON.stringify(error),
       }),
     );`,
    [method, args],
  );
}

async function invoke(command, args = {}) {
  return browser.executeAsyncScript(
    `const commandName = arguments[0];
     const commandArgs = arguments[1];
     const done = arguments[arguments.length - 1];
     window.__TAURI_INTERNALS__.invoke(commandName, commandArgs).then(
       (value) => done({ ok: true, value }),
       (error) => done({ ok: false, error: String(error) }),
     );`,
    [command, args],
  );
}

async function resetApp() {
  await waitForApp();
  const reset = await invoke('e2e_reset_state');
  assert.equal(reset.ok, true, reset.error);
  await browser.executeScript('localStorage.clear();', []);
  await browser.refresh();
  await waitForApp();
}

async function setEditorContent(content) {
  const editor = await browser.$('.ProseMirror');
  await editor.click();
  await browser.keys(['Control', 'a']);
  await browser.keys('Backspace');
  if (content) await browser.keys(content);
}

async function editorText() {
  return browser.$('.ProseMirror').getText();
}

async function openDocument(path) {
  const opened = await callApp('openDocument', path);
  assert.equal(opened.ok, true, opened.error);
  assert.equal(opened.value, true);
  await tabName(path).waitForDisplayed();
}

function tabName(path) {
  const name = basename(path);
  return browser.$(
    `//div[@role="tab"]//span[contains(@class,"tab-name") and normalize-space()="${name}"]`,
  );
}

async function saveShortcut() {
  await browser.keys(['Control', 's']);
}

async function waitForFile(path, expected) {
  await browser.waitUntil(() => readFileSync(path, 'utf8') === expected, {
    timeout: 10_000,
    interval: 50,
    timeoutMsg: `File did not reach expected content: ${path}`,
  });
}

async function beginWindowPreparation() {
  await browser.executeScript(
    'window.__HYPERMD_E2E_PENDING_CLOSE__ = window.__HYPERMD_E2E__.prepareWindowClose();',
    [],
  );
  await browser.$('.app-dialog').waitForDisplayed();
}

async function finishWindowPreparation() {
  return browser.executeAsyncScript(
    `const done = arguments[arguments.length - 1];
     window.__HYPERMD_E2E_PENDING_CLOSE__.then(
       (value) => done({ ok: true, value }),
       (error) => done({ ok: false, error: String(error) }),
     );`,
    [],
  );
}

function launchSecondaryInstance() {
  const extension = process.platform === 'win32' ? '.exe' : '';
  const appBinary = resolve(
    import.meta.dirname,
    `../../src-tauri/target/debug/hypermd${extension}`,
  );
  return new Promise((resolveLaunch, reject) => {
    const child = spawn(appBinary, [], { env: process.env, stdio: 'ignore' });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Secondary HyperMD instance did not exit.'));
    }, 10_000);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      resolveLaunch({ code, signal });
    });
  });
}

describe('HyperMD desktop critical flows', () => {
  beforeEach(async () => {
    await resetApp();
    testDirectory = mkdtempSync(join(workspaceRoot, 'case-'));
  });

  afterEach(() => {
    if (testDirectory) rmSync(testDirectory, { recursive: true, force: true });
    if (outsideDirectory) rmSync(outsideDirectory, { recursive: true, force: true });
    testDirectory = undefined;
    outsideDirectory = undefined;
  });

  after(async () => {
    const reset = await invoke('e2e_reset_state');
    assert.equal(reset.ok, true, reset.error);
    await browser.executeScript('localStorage.clear();', []);
  });

  it('opens, edits, saves, closes and reopens a Markdown file', async () => {
    const path = join(testDirectory, 'roundtrip.md');
    writeFileSync(path, 'before', 'utf8');

    await openDocument(path);
    assert.equal(await editorText(), 'before');
    await setEditorContent('after');
    await saveShortcut();
    await waitForFile(path, 'after');

    const closed = await callApp('close');
    assert.equal(closed.ok, true, closed.error);
    assert.equal(closed.value, true);
    await openDocument(path);
    assert.equal(await editorText(), 'after');
  });

  it('keeps the newest content after two rapid saves', async () => {
    const path = join(testDirectory, 'ordered.md');
    writeFileSync(path, 'start', 'utf8');
    await openDocument(path);

    await setEditorContent('first');
    await saveShortcut();
    await setEditorContent('second');
    await saveShortcut();

    await waitForFile(path, 'second');
  });

  it('does not overwrite a file changed externally before Save', async () => {
    const path = join(testDirectory, 'external-conflict.md');
    writeFileSync(path, 'opened version', 'utf8');
    await openDocument(path);
    await setEditorContent('editor version');
    writeFileSync(path, 'external version', 'utf8');

    await saveShortcut();
    const dialog = await browser.$('.app-dialog');
    await dialog.waitForDisplayed();

    assert.match(await dialog.getText(), /changed outside HyperMD/i);
    assert.equal(readFileSync(path, 'utf8'), 'external version');
    assert.equal(
      await browser.$('[role="tab"][aria-selected="true"] .tab-dirty').isDisplayed(),
      true,
    );
    await browser.$('button=Cancel').click();
    assert.equal(readFileSync(path, 'utf8'), 'external version');
  });

  it('handles cancel, save and discard for dirty window preparation', async () => {
    const path = join(testDirectory, 'dirty.md');
    writeFileSync(path, 'saved', 'utf8');
    await openDocument(path);
    await setEditorContent('changed');

    await beginWindowPreparation();
    await browser.$('button=Cancel').click();
    let result = await finishWindowPreparation();
    assert.deepEqual(result, { ok: true, value: false });
    assert.equal(readFileSync(path, 'utf8'), 'saved');

    await beginWindowPreparation();
    await browser.$('button=Save').click();
    result = await finishWindowPreparation();
    assert.deepEqual(result, { ok: true, value: true });
    await waitForFile(path, 'changed');

    await setEditorContent('discarded');
    await beginWindowPreparation();
    await browser.$("button=Don't Save").click();
    result = await finishWindowPreparation();
    assert.deepEqual(result, { ok: true, value: true });
    assert.equal(readFileSync(path, 'utf8'), 'changed');
  });

  it('recovers an untitled document after a real app restart', async () => {
    await setEditorContent('crash recovery');
    const flushed = await callApp('flushSession');
    assert.equal(flushed.ok, true, flushed.error);

    await browser.reloadSession();
    await waitForApp();

    assert.equal(await editorText(), 'crash recovery');
    assert.equal(
      await browser.$('[role="tab"][aria-selected="true"] .tab-name').getText(),
      'Untitled.md',
    );
  });

  it('keeps one responsive window when a second instance starts', async () => {
    await setEditorContent('single instance');
    const originalHandle = await browser.getWindowHandle();

    const secondary = await launchSecondaryInstance();

    assert.deepEqual(secondary, { code: 0, signal: null });
    assert.equal(await browser.getWindowHandle(), originalHandle);
    await browser.waitUntil(() => browser.executeScript('return document.hasFocus();', []), {
      timeoutMsg: 'Existing HyperMD window did not regain focus.',
    });
    assert.equal(await editorText(), 'single instance');
  });

  it('rejects filesystem access outside the authorized temporary workspace', async () => {
    outsideDirectory = mkdtempSync(join(tmpdir(), 'hypermd-e2e-outside-'));
    const outsidePath = join(outsideDirectory, 'blocked.md');
    writeFileSync(outsidePath, 'private', 'utf8');

    const opened = await callApp('tryOpenDocument', outsidePath);

    assert.equal(opened.ok, true, opened.error);
    assert.equal(opened.value.opened, undefined);
    assert.match(opened.value.error, /forbidden|denied|scope/i);
    assert.equal(readFileSync(outsidePath, 'utf8'), 'private');
  });

  it('persists settings after a real app restart', async () => {
    await browser.$('button[aria-label="Settings"]').click();
    const theme = await browser.$('select[aria-label="Theme"]');
    await theme.waitForDisplayed();
    await theme.selectByAttribute('value', 'light');
    await browser.waitUntil(
      () => browser.executeScript('return document.documentElement.dataset.theme === "light";', []),
      { timeoutMsg: 'Light theme was not applied.' },
    );
    const flushed = await callApp('flushSettings');
    assert.equal(flushed.ok, true, flushed.error);

    await browser.reloadSession();
    await waitForApp();

    assert.equal(
      await browser.executeScript('return document.documentElement.dataset.theme;', []),
      'light',
    );
  });
});
