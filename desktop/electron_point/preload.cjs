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
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  },
})
