/**
 * Готовые значения переменных APNs из скачанного ключа.
 *
 * Ключ приходит файлом `AuthKey_XXXXXXXXXX.p8` с переносами строк. Вставлять
 * его в поле переменной окружения как есть — верный способ получить «invalid
 * key»: интерфейсы срезают переносы, и PEM разваливается. Поэтому отдаём
 * base64 одной строкой, а идентификатор ключа берём из имени файла — он там и
 * лежит, и переписывать его руками незачем.
 *
 *   node scripts/apns-env.mjs ~/Downloads/AuthKey_ABC1234DEF.p8
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

const path = process.argv[2]
if (!path) {
  console.error('Укажите путь к .p8: node scripts/apns-env.mjs ~/Downloads/AuthKey_XXXXXXXXXX.p8')
  process.exit(1)
}

const pem = readFileSync(path, 'utf8')
if (!pem.includes('BEGIN PRIVATE KEY')) {
  console.error('Это не похоже на ключ APNs: в файле нет строки BEGIN PRIVATE KEY.')
  process.exit(1)
}

const keyId = basename(path).replace(/^AuthKey_/, '').replace(/\.p8$/, '')
if (!/^[A-Z0-9]{10}$/.test(keyId)) {
  console.error(`Не удалось прочитать Key ID из имени файла (${basename(path)}). Возьмите его в Apple Developer → Keys.`)
}

console.log('Вставьте в переменные окружения (Vercel → Settings → Environment Variables):\n')
console.log(`APNS_KEY_ID=${keyId}`)
console.log('APNS_TEAM_ID=YRA24D32N2')
console.log(`APNS_PRIVATE_KEY=${Buffer.from(pem, 'utf8').toString('base64')}`)
console.log('APNS_BUNDLE_ID=kz.ordaops.apple')
console.log('APNS_ENVIRONMENT=production')
console.log('\nПосле сохранения нужен новый деплой: переменные подхватываются только при сборке.')
