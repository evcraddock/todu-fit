const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('fit', Object.freeze({
  status: () => ipcRenderer.invoke('daemon:status'),
  listDishes: () => ipcRenderer.invoke('dishes:list'),
  createDish: name => ipcRenderer.invoke('dishes:create', name),
}));
