const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { openApplicationBridge } = require("./application-bridge.cjs");
const { createExternalLinkHandler } = require("./external-links.cjs");

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
const { connectOrStart } = require("./daemon-startup.cjs");
const page = path.resolve(__dirname, "../dist/index.html");
// Only unpackaged development launches can load the fixed loopback server.
const development = !app.isPackaged && process.env.FIT_DESKTOP_DEV === "1";
const pageUrl = development
  ? "http://127.0.0.1:5174/"
  : pathToFileURL(page).href;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app
    .whenReady()
    .then(async () => {
      const binary = path.join(
        app.isPackaged ? process.resourcesPath : path.resolve(__dirname, ".."),
        "daemon",
        process.platform === "win32" ? "fit.exe" : "fit",
      );
      const endpoint = await connectOrStart({
        binary,
        config: process.env.FIT_CONFIG,
        endpoint: process.env.FIT_DAEMON_ENDPOINT,
        logPath: path.join(app.getPath("userData"), "daemon-startup.log"),
      });
      bridge = openApplicationBridge(endpoint);
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
        title: development ? "Todu Fit — Development" : "Todu Fit",
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
      window.webContents.setWindowOpenHandler(
        createExternalLinkHandler(
          (url) => shell.openExternal(url),
          (error) => dialog.showErrorBox("Unable to open link", error.message),
        ),
      );
      window.webContents.on("will-navigate", (event) => event.preventDefault());
      window.webContents.session.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false),
      );
      if (development) {
        window.on("page-title-updated", (event) => event.preventDefault());
        await window.loadURL(pageUrl);
      } else {
        await window.loadFile(page);
      }
    })
    .catch((error) => {
      console.error("Unable to connect to shared daemon:", error.message);
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
