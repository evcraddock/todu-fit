const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { openBridge } = require('./bridge.cjs');

// Separate proof app storage; tests always override this with a fresh temporary root.
if (process.env.TODU_FIT_PROOF_DATA) {
  if (!path.isAbsolute(process.env.TODU_FIT_PROOF_DATA)) throw new Error('Test data path must be absolute');
  app.setPath('userData', process.env.TODU_FIT_PROOF_DATA);
}
let bridge, window, shutdown, readyToQuit = false;
const page = path.resolve(__dirname, '../dist/index.html');
const pageUrl = pathToFileURL(page).href;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.whenReady().then(async () => {
    bridge = openBridge(
      path.join(app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..'), 'native/core.node'),
      path.join(app.getPath('userData'), 'core-proof')
    );
    await bridge.ready;
    function handler(operation) {
      return async (event, name) => {
        if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame ||
            event.senderFrame.url !== pageUrl) return { ok: false, error: { code: 'FORBIDDEN', message: 'Request denied' } };
        if (operation === 'create' && (typeof name !== 'string' || !name.trim() || Buffer.byteLength(name.trim()) > 512)) {
          return { ok: false, error: { code: 'INVALID_INPUT', message: 'Enter a dish name (up to 512 bytes).' } };
        }
        try {
          return { ok: true, value: await (operation === 'create' ? bridge.create(name) : bridge.list()) };
        } catch (error) {
          const code = /^(INVALID_INPUT|CLOSED|STORE_BUSY|STORAGE|WORKER_FAILED):/.exec(error.message)?.[1] || 'STORAGE';
          return { ok: false, error: { code, message: 'The local operation could not be completed.' } };
        }
      };
    }
    ipcMain.handle('dishes:list', handler('list'));
    ipcMain.handle('dishes:create', handler('create'));
    window = new BrowserWindow({ width: 760, height: 640, webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true,
    } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    await window.loadFile(page);
  }).catch(() => {
    dialog.showErrorBox('Unable to open local storage', 'The proof store could not be opened. It may be in use or damaged.');
    app.quit();
  });
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (readyToQuit || !bridge) return;
  event.preventDefault();
  if (shutdown) return;
  shutdown = bridge.close().catch(() => { process.exitCode = 1; }).finally(() => {
    readyToQuit = true;
    app.quit();
  });
});
