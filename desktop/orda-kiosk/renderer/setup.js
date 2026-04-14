const $ = (id) => document.getElementById(id)

async function init() {
  const cfg = await window.setupApi.load()
  $('stationCode').value = cfg.stationCode || ''
  $('heartbeatUrl').value = cfg.heartbeatUrl || ''
  $('heartbeatSecret').value = cfg.heartbeatSecret || ''
  $('wsUrl').value = cfg.wsUrl || ''
  $('clubName').value = cfg.clubName || ''
  $('defaultGame').value = cfg.defaultGamePath || ''
}

$('save').addEventListener('click', async () => {
  const msg = $('msg')
  msg.classList.add('hidden')
  const res = await window.setupApi.save({
    stationCode: $('stationCode').value,
    heartbeatUrl: $('heartbeatUrl').value,
    heartbeatSecret: $('heartbeatSecret').value,
    wsUrl: $('wsUrl').value,
    clubName: $('clubName').value,
    defaultGamePath: $('defaultGame').value,
  })
  if (!res.ok) {
    msg.textContent = res.error || 'Ошибка сохранения'
    msg.classList.remove('hidden')
    return
  }
})

void init()
