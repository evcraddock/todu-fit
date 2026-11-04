const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld(
  "fit",
  Object.freeze({
    request: (operation, requestId) =>
      ipcRenderer.invoke("application:request", operation, requestId),
  }),
);
