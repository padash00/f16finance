const { spawn } = require('node:child_process')

function shutdownPc() {
  spawn('shutdown', ['/s', '/t', '0'], {
    shell: true,
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
  })
}

function rebootPc() {
  spawn('shutdown', ['/r', '/t', '0'], {
    shell: true,
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
  })
}

module.exports = {
  shutdownPc,
  rebootPc,
}
