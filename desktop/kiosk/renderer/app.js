function formatSec(sec) {
  const total = Math.max(0, Number(sec || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = Math.floor(total % 60)
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':')
}

const $ = (id) => document.getElementById(id)

const ui = {
  clubName: $('clubName'),
  stationCode: $('stationCode'),
  deviceIp: $('deviceIp'),
  deviceMac: $('deviceMac'),
  tariffName: $('tariffName'),
  timer: $('timer'),
  blockedReason: $('blockedReason'),
  gamesCount: $('gamesCount'),
  gamesGrid: $('gamesGrid'),
  idle: $('screenIdle'),
  active: $('screenActive'),
  ended: $('screenEnded'),
  blocked: $('screenBlocked'),
}

function renderGames(games) {
  ui.gamesCount.textContent = String(games.length)
  ui.gamesGrid.innerHTML = ''
  if (!games.length) {
    const p = document.createElement('p')
    p.className = 'games-empty'
    p.textContent = 'Игры пока не настроены администратором.'
    ui.gamesGrid.appendChild(p)
    return
  }
  games.forEach((game) => {
    const card = document.createElement('button')
    card.className = 'game-card'
    card.type = 'button'
    card.addEventListener('click', () => window.kioskApi.requestLaunchGame(game.id))

    const img = document.createElement('img')
    img.className = 'game-logo'
    img.alt = game.title || 'Game'
    img.src = game.logoUrl || ''
    img.onerror = () => {
      img.style.display = 'none'
    }

    const title = document.createElement('span')
    title.className = 'game-title'
    title.textContent = game.title || 'Игра'

    card.appendChild(img)
    card.appendChild(title)
    ui.gamesGrid.appendChild(card)
  })
}

function render(state) {
  ui.clubName.textContent = state.clubName || 'ORDA CLUB'
  ui.stationCode.textContent = state.stationCode || 'VIP-111'
  ui.deviceIp.textContent = state.deviceIp || '-'
  ui.deviceMac.textContent = state.deviceMac || '-'
  ui.tariffName.textContent = state.tariffName || '-'
  ui.timer.textContent = formatSec(state.remainingSec)
  ui.blockedReason.textContent = state.bindingReason || 'Устройство не совпадает с привязкой станции.'
  renderGames(Array.isArray(state.games) ? state.games : [])

  ui.idle.classList.add('hidden')
  ui.active.classList.add('hidden')
  ui.ended.classList.add('hidden')
  ui.blocked.classList.add('hidden')

  if (state.screen === 'blocked') ui.blocked.classList.remove('hidden')
  else if (state.screen === 'active') ui.active.classList.remove('hidden')
  else if (state.screen === 'ended') ui.ended.classList.remove('hidden')
  else ui.idle.classList.remove('hidden')
}

$('btnExtend').addEventListener('click', () => {
  window.kioskApi.requestExtend()
})
$('btnExtendEnded').addEventListener('click', () => {
  window.kioskApi.requestExtend()
})
$('btnCallOperator').addEventListener('click', () => {
  window.kioskApi.callOperator()
})
$('btnCallOperatorIdle').addEventListener('click', () => {
  window.kioskApi.callOperator()
})
$('btnCallOperatorBlocked').addEventListener('click', () => {
  window.kioskApi.callOperator()
})
$('btnShop').addEventListener('click', () => {
  window.kioskApi.callOperator()
})

window.kioskApi.onState(render)
