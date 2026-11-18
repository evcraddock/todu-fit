const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld(
  "fit",
  Object.freeze({
    assistant: (operation) =>
      ipcRenderer.invoke("assistant:request", operation),
    request: (operation, requestId) =>
      ipcRenderer.invoke("application:request", operation, requestId),
  }),
);
