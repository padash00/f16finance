import { mkdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

run('npx', ['next', 'typegen'])

mkdirSync('.next/types', { recursive: true })
writeFileSync('.next/types/cache-life.d.ts', 'export {}\n')

run('npx', ['tsc', '--noEmit', '--incremental', 'false'])
