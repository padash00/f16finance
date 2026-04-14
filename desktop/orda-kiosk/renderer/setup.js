const $ = (id) => document.getElementById(id)

async function init() {
  const cfg = await window.setupApi.load()
  $('stationCode').value = cfg.stationCode || ''
  $('serverBaseUrl').value = cfg.serverBaseUrl || ''
  $('provisioningKey').value = cfg.provisioningKey || ''
  $('wsUrl').value = cfg.wsUrl || ''
  $('clubName').value = cfg.clubName || ''
  $('defaultGame').value = cfg.defaultGamePath || ''
}

$('save').addEventListener('click', async () => {
  const msg = $('msg')
  const btn = $('save')
  msg.classList.add('hidden')
  btn.disabled = true
  const res = await window.setupApi.save({
    stationCode: $('stationCode').value,
    serverBaseUrl: $('serverBaseUrl').value,
    provisioningKey: $('provisioningKey').value,
    wsUrl: $('wsUrl').value,
    clubName: $('clubName').value,
    defaultGamePath: $('defaultGame').value,
  })
  if (!res.ok) {
    msg.textContent = res.error || 'Ошибка сохранения'
    msg.classList.remove('hidden')
    btn.disabled = false
    return
  }
  msg.textContent = 'Сохранено. Приложение перезапускается…'
  msg.style.color = '#a7f3d0'
  msg.classList.remove('hidden')
})

void init()
