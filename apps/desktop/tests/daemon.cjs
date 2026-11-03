const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./daemon-fixture.cjs');
const { openDaemonBridge } = require('../electron/daemon-bridge.cjs');
test('CLI and desktop share durable owner; closing desktop leaves CLI usable', async () => {
  const f = await fixture();
  let bridge;
  try {
    bridge = openDaemonBridge(f.endpoint); await bridge.ready;
    const before = await bridge.status();
    await f.cli('dish', 'create', 'CLI banana');
    assert.deepEqual((await bridge.list()).map(d => d.name), ['CLI banana']);
    const apple = await bridge.create('Desktop apple');
    assert.match(await f.cli('dish', 'show', apple.id), /Desktop apple/);
    const changes = await bridge.changes(before.revision);
    assert.equal(changes.changed, true);
    await bridge.close();
    await f.cli('dish', 'create', 'After desktop quit');
    bridge = openDaemonBridge(f.endpoint); await bridge.ready;
    assert.equal((await bridge.list()).length, 3);
  } finally { if (bridge) await bridge.close(); await f.close(); }
});
