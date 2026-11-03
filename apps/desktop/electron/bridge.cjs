const { Worker } = require('node:worker_threads');
const path = require('node:path');

function openBridge(addon, dataRoot) {
  const worker = new Worker(path.join(__dirname, 'storage-worker.cjs'), { workerData: { addon, dataRoot } });
  let nextId = 0;
  let closing = false;
  let failed;
  const pending = new Map();
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const fail = error => {
    failed = error;
    rejectReady(error);
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };
  worker.on('error', fail);
  worker.on('exit', code => {
    if (!closing || code !== 0 || pending.size) fail(new Error('WORKER_FAILED: Storage worker stopped'));
  });
  worker.on('message', message => {
    if ('ready' in message) {
      if (message.ready) resolveReady();
      else fail(new Error(message.error));
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error));
    else request.resolve(message.value);
  });
  async function request(operation, name) {
    // Admission happens before waiting for startup; shutdown rejects subsequent work.
    if (closing) throw new Error('CLOSED: Session is closing');
    if (failed) throw failed;
    if (operation === 'close') closing = true;
    await ready;
    if (failed) throw failed;
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, operation, name });
    });
  }
  return { ready, list: () => request('list'), create: name => request('create', name), close: () => request('close') };
}
module.exports = { openBridge };
