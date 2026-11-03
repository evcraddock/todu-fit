// One connection per bounded request. The desktop never opens the daemon store.
const net = require('node:net');
const { randomUUID } = require('node:crypto');
function openDaemonBridge(endpoint) {
  let closed = false;
  const pending = new Map();
  function request(operation, id = randomUUID()) {
    if (closed) return Promise.reject(new Error('CLOSED: Client closed'));
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(endpoint);
      let buffer = Buffer.alloc(0);
      const timer = setTimeout(() => finish(new Error(`OUTCOME_UNKNOWN: Retry request ${id}`)), 15000);
      const finish = (error, value) => {
        clearTimeout(timer); pending.delete(id); socket.destroy();
        if (error) reject(error); else resolve(value);
      };
      pending.set(id, () => finish(new Error('CLOSED: Client closed')));
      socket.on('error', e => finish(new Error(`DAEMON_UNAVAILABLE: ${e.message}; request ${id}`)));
      socket.on('connect', () => socket.write(JSON.stringify({ version: 1, id, operation }) + '\n'));
      socket.on('data', chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length > 8 * 1024 * 1024) return finish(new Error('INVALID_FRAME: Response too large'));
        const end = buffer.indexOf(10);
        if (end < 0) return;
        try {
          const response = JSON.parse(buffer.subarray(0, end));
          if (response.error) return finish(new Error(response.error));
          if (response.id !== id || !Number.isSafeInteger(response.revision)) throw new Error('Invalid daemon response');
          finish(null, response.value);
        } catch (error) { finish(error); }
      });
      socket.on('end', () => { if (pending.has(id)) finish(new Error(`OUTCOME_UNKNOWN: Connection closed; request ${id}`)); });
    });
  }
  // Retain an uncertain save's ID for retries in this client session.
  let retry;
  return {
    ready: request({ type: 'status' }),
    list: () => request({ type: 'list_dishes' }),
    status: () => request({ type: 'status' }),
    changes: after => request({ type: 'changes', after }),
    create: async name => {
      const id = retry?.name === name ? retry.id : randomUUID();
      retry = { name, id };
      const result = await request({ type: 'create_dish', name }, id);
      retry = undefined;
      return result;
    },
    close: async () => { closed = true; for (const cancel of [...pending.values()]) cancel(); },
  };
}
module.exports = { openDaemonBridge };
