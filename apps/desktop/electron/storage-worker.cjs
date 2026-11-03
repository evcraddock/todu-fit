const { parentPort, workerData } = require('node:worker_threads');
let session;
try {
  const { Session } = require(workerData.addon);
  session = new Session(workerData.dataRoot);
  parentPort.postMessage({ ready: true });
} catch (error) {
  parentPort.postMessage({ ready: false, error: error.message });
  parentPort.close();
}
if (session) parentPort.on('message', ({ id, operation, name }) => {
  try {
    let value;
    if (operation === 'list') value = session.listDishes();
    else if (operation === 'create') value = session.createDish(name);
    else if (operation === 'close') session.close();
    else throw new Error('INVALID_INPUT: Unknown operation');
    parentPort.postMessage({ id, value });
    if (operation === 'close') parentPort.close();
  } catch (error) {
    parentPort.postMessage({ id, error: error.message });
  }
});
