const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { Session } = require('../native/core.node');
const { openBridge } = require('../electron/bridge.cjs');
const addon = path.resolve(__dirname, '../native/core.node');

test('native session persists Core dishes, rejects competing sessions and closes', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'todu-native-'));
  try {
    const first = new Session(root);
    assert.deepEqual(first.listDishes(), []);
    assert.throws(() => new Session(root), /STORE_BUSY/);
    assert.throws(() => first.createDish('  '), /INVALID_INPUT/);
    assert.throws(() => first.createDish('é'.repeat(257)), /INVALID_INPUT/);
    const dish = first.createDish('  Lentil soup  ');
    assert.equal(dish.name, 'Lentil soup');
    first.close();
    assert.throws(() => first.listDishes(), /CLOSED/);
    const second = new Session(root);
    assert.deepEqual(second.listDishes(), [dish]);
    second.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('refuses to initialize unrelated or damaged storage', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'todu-invalid-'));
  try {
    writeFileSync(path.join(root, 'existing-data'), 'preserve');
    assert.throws(() => new Session(root), /Refusing/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('worker serializes concurrent writes and drains accepted work on close', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'todu-worker-'));
  try {
    const bridge = openBridge(addon, root);
    const requests = Array.from({ length: 12 }, (_, i) => bridge.create('Dish ' + i));
    const closed = bridge.close();
    await assert.rejects(bridge.create('Too late'), /CLOSED/);
    const dishes = await Promise.all(requests);
    await closed;
    const second = openBridge(addon, root);
    assert.deepEqual((await second.list()).map(d => d.id).sort(), dishes.map(d => d.id).sort());
    await second.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test('repeated quit requests cannot bypass the pending storage drain', async () => {
  const vm = require('node:vm');
  const { readFileSync } = require('node:fs');
  const handlers = new Map();
  let finishClose;
  let closes = 0;
  let quits = 0;
  const bridge = {
    ready: Promise.resolve(),
    close: () => { closes++; return new Promise(resolve => { finishClose = resolve; }); },
  };
  const app = {
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
    getPath: () => '/unused-proof-test',
    on: (name, handler) => handlers.set(name, handler),
    quit: () => { quits++; },
  };
  class BrowserWindow {
    constructor() {
      this.webContents = {
        setWindowOpenHandler() {}, on() {},
        session: { setPermissionRequestHandler() {} },
      };
    }
    loadFile() { return Promise.resolve(); }
  }
  vm.runInNewContext(readFileSync(path.resolve(__dirname, '../electron/main.cjs'), 'utf8'), {
    __dirname: path.resolve(__dirname, '../electron'),
    process: { env: {} },
    require: name => name === 'electron' ? {
      app, BrowserWindow, ipcMain: { handle() {} }, dialog: { showErrorBox() {} },
    } : name === './bridge.cjs' ? { openBridge: () => bridge } : require(name),
  });
  await new Promise(resolve => setImmediate(resolve));
  let prevented = 0;
  const event = { preventDefault() { prevented++; } };
  handlers.get('before-quit')(event);
  handlers.get('before-quit')(event);
  assert.equal(prevented, 2);
  assert.equal(closes, 1);
  assert.equal(quits, 0);
  finishClose();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(quits, 1);
  handlers.get('before-quit')(event);
  assert.equal(prevented, 2);
});
