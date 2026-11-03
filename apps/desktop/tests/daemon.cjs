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

test('version 2 application protocol shares the owner on Unix sockets and Windows pipes', async () => {
  const net = require('node:net');
  const { randomUUID } = require('node:crypto');
  const f = await fixture();
  const request = operation => new Promise((resolve, reject) => {
    const id = randomUUID();
    const socket = net.createConnection(f.endpoint.trim());
    let frame = '';
    socket.setTimeout(10000, () => socket.destroy(new Error('API request timed out')));
    socket.on('error', reject);
    socket.on('connect', () => socket.write(JSON.stringify({ version: 2, id, operation }) + '\n'));
    socket.on('data', chunk => {
      frame += chunk.toString();
      if (!frame.includes('\n')) return;
      socket.end();
      try {
        const response = JSON.parse(frame.split('\n')[0]);
        assert.equal(response.version, 2);
        assert.equal(response.id, id);
        assert.equal(response.outcome.status, 'ok');
        resolve(response.outcome.value.data);
      } catch (error) { reject(error); }
    });
  });
  try {
    const dish = await request({ type: 'dish_create', name: 'Typed API apple' });
    assert.match(await f.cli('dish', 'show', dish.id), /Typed API apple/);
    await f.cli('dish', 'create', 'Legacy CLI banana');
    assert.equal((await request({ type: 'dishes_list' })).length, 2);
    assert.equal((await request({ type: 'changes', after: 0 })).changed, true);
  } finally { await f.close(); }
});
