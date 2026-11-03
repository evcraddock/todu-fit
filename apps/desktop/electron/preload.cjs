const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('fit', Object.freeze({
  listDishes: () => ipcRenderer.invoke('dishes:list'),
  createDish: name => ipcRenderer.invoke('dishes:create', name),
}));
