const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { openApplicationBridge } = require("./application-bridge.cjs");

// Separate proof app storage; tests always override this with a fresh temporary root.
if (process.env.TODU_FIT_PROOF_DATA) {
  if (!path.isAbsolute(process.env.TODU_FIT_PROOF_DATA))
    throw new Error("Test data path must be absolute");
  app.setPath("userData", process.env.TODU_FIT_PROOF_DATA);
}
let bridge,
  window,
  shutdown,
  readyToQuit = false;
const page = path.resolve(__dirname, "../dist/index.html");
const pageUrl = pathToFileURL(page).href;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app
    .whenReady()
    .then(async () => {
      if (!process.env.FIT_DAEMON_ENDPOINT)
        throw new Error("Set FIT_DAEMON_ENDPOINT to the shared daemon socket");
      bridge = openApplicationBridge(process.env.FIT_DAEMON_ENDPOINT);
      ipcMain.handle(
        "application:request",
        async (event, operation, requestId) => {
          if (
            event.sender !== window?.webContents ||
            event.senderFrame !== window.webContents.mainFrame ||
            event.senderFrame.url !== pageUrl
          ) {
            return { ok: false, error: "Request denied" };
          }
          try {
            return {
              ok: true,
              value: await bridge.request(operation, requestId),
            };
          } catch (error) {
            return { ok: false, error: error.message };
          }
        },
      );
      window = new BrowserWindow({
        width: 1180,
        height: 820,
        minWidth: 720,
        minHeight: 560,
        webPreferences: {
          preload: path.join(__dirname, "preload.cjs"),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event) => event.preventDefault());
      window.webContents.session.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false),
      );
      await window.loadFile(page);
    })
    .catch((error) => {
      dialog.showErrorBox("Unable to connect to shared daemon", error.message);
      app.quit();
    });
}
app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (readyToQuit || !bridge) return;
  event.preventDefault();
  if (shutdown) return;
  shutdown = bridge
    .close()
    .catch(() => {
      process.exitCode = 1;
    })
    .finally(() => {
      readyToQuit = true;
      app.quit();
    });
});
