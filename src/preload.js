const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sitepilot', {
  config: {
    load: () => ipcRenderer.invoke('config:load'),
    save: (data) => ipcRenderer.invoke('config:save', data),
  },
  key: {
    generate: () => ipcRenderer.invoke('key:generate'),
  },
  connection: {
    test: (opts) => ipcRenderer.invoke('connection:test', opts),
    autoSetup: (opts) => ipcRenderer.invoke('connection:auto-setup', opts),
    disconnect: () => ipcRenderer.invoke('connection:disconnect'),
  },
  claude: {
    configure: (opts) => ipcRenderer.invoke('claude:configure', opts),
  },
  server: {
    start: (opts) => ipcRenderer.invoke('server:start', opts),
    stop: () => ipcRenderer.invoke('server:stop'),
    status: () => ipcRenderer.invoke('server:status'),
  },
  shell: {
    open: (url) => ipcRenderer.invoke('shell:open', url),
  },
});
