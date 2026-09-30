const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('marginEdge', {
  open: () => ipcRenderer.send('panel:open'),
  onSide: fn => ipcRenderer.on('edge:side', (_event, side) => fn(side))
});
