const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('kioskApi', {
  // Состояние от main process (WebSocket, таймер)
  onState: (listener) => {
    const wrapped = (_event, payload) => listener(payload)
    ipcRenderer.on('kiosk:state', wrapped)
    return () => ipcRenderer.removeListener('kiosk:state', wrapped)
  },

  // Действия клиента
  launchGame: (gameId) => ipcRenderer.invoke('kiosk:launch-game', gameId),
  requestExtend: () => ipcRenderer.invoke('kiosk:extend'),
  callOperator: () => ipcRenderer.invoke('kiosk:call-operator'),

  // Setup (первый запуск)
  setup: {
    load: () => ipcRenderer.invoke('setup:load'),
    save: (payload) => ipcRenderer.invoke('setup:save', payload),
    clearConfig: () => ipcRenderer.invoke('setup:clear-config'),
  },

  // Конфиг для API запросов
  getConfig: () => ipcRenderer.invoke('kiosk:get-config'),

  // Локальный старт сессии после self-purchase (без WS команды)
  startSessionLocal: (payload) => ipcRenderer.invoke('kiosk:start-session-local', payload),
})
