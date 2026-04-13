const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('kioskApi', {
  onState: (listener) => {
    const wrapped = (_event, payload) => listener(payload)
    ipcRenderer.on('kiosk:state', wrapped)
    return () => ipcRenderer.removeListener('kiosk:state', wrapped)
  },
  requestLaunchGame: (gameId) => ipcRenderer.invoke('kiosk:launch-game', gameId),
  requestExtend: () => ipcRenderer.invoke('kiosk:extend'),
  callOperator: () => ipcRenderer.invoke('kiosk:call-operator'),
})
