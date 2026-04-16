const { spawn } = require('node:child_process')

let activeGame = null

function launchGame(gamePath, options = {}) {
  if (!gamePath || typeof gamePath !== 'string') {
    throw new Error('game-path-required')
  }

  if (activeGame && !activeGame.killed) {
    return { ok: true, alreadyRunning: true, pid: activeGame.pid || null }
  }

  const child = spawn(gamePath, [], {
    detached: false,
    shell: false,
    stdio: 'ignore',
    windowsHide: false,
  })

  activeGame = child

  // Catch ENOENT / permission errors — don't let them bubble to uncaughtException
  child.on('error', (err) => {
    activeGame = null
    if (typeof options?.onError === 'function') options.onError(err)
    else if (typeof options?.onExit === 'function') options.onExit()
  })

  child.on('exit', () => {
    activeGame = null
    if (typeof options?.onExit === 'function') options.onExit()
  })

  return { ok: true, pid: child.pid || null }
}

function stopGame() {
  if (!activeGame || activeGame.killed || !activeGame.pid) {
    activeGame = null
    return { ok: true, stopped: false }
  }

  try {
    spawn('taskkill', ['/PID', String(activeGame.pid), '/T', '/F'], {
      detached: false,
      shell: true,
      windowsHide: true,
      stdio: 'ignore',
    })
  } catch (_) {}
  activeGame = null
  return { ok: true, stopped: true }
}

function getGameState() {
  return {
    running: Boolean(activeGame && !activeGame.killed),
    pid: activeGame?.pid || null,
  }
}

module.exports = {
  launchGame,
  stopGame,
  getGameState,
}
