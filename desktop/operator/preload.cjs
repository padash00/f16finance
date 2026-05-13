/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electron', {
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (config) => ipcRenderer.invoke('config:set', config),
  },
  queue: {
    add: (data) => ipcRenderer.invoke('queue:add', data),
    list: (opts) => ipcRenderer.invoke('queue:list', opts),
    update: (data) => ipcRenderer.invoke('queue:update', data),
    done: (data) => ipcRenderer.invoke('queue:done', data),
    count: () => ipcRenderer.invoke('queue:count'),
  },
  dialog: {
    openFile: (opts) => ipcRenderer.invoke('dialog:openFile', opts),
  },
  file: {
    readBuffer: (path) => ipcRenderer.invoke('file:readBuffer', path),
  },
  cache: {
    get: () => ipcRenderer.invoke('cache:get'),
    set: (data) => ipcRenderer.invoke('cache:set', data),
  },
  app: {
    version: () => ipcRenderer.invoke('app:version'),
  },
  updater: {
    getState: () => ipcRenderer.invoke('updater:getState'),
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    openReleases: () => ipcRenderer.invoke('updater:openReleases'),
    onStateChange: (callback) => {
      const handler = (_, state) => callback(state)
      ipcRenderer.on('updater:state', handler)
      return () => ipcRenderer.removeListener('updater:state', handler)
    },
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  },
  customerDisplay: {
    available: () => ipcRenderer.invoke('customer-display:available'),
    open: () => ipcRenderer.invoke('customer-display:open'),
    close: () => ipcRenderer.invoke('customer-display:close'),
    push: (state) => ipcRenderer.send('customer-display:push', state),
    onState: (callback) => {
      const handler = (_, state) => callback(state)
      ipcRenderer.on('customer-display:state', handler)
      return () => ipcRenderer.removeListener('customer-display:state', handler)
    },
  },
})
