const baseUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL

if (!baseUrl) {
  console.error('APP_URL или NEXT_PUBLIC_APP_URL не заданы')
  process.exit(1)
}

const routes = [
  '/',
  '/login',
  '/forgot-password',
  '/reset-password',
  '/set-password',
  '/welcome',
  '/logs',
]

let hasFailure = false

for (const route of routes) {
  const url = new URL(route, baseUrl).toString()

  try {
    const response = await fetch(url, { redirect: 'manual' })
    const ok = response.status >= 200 && response.status < 400
    console.log(`${ok ? 'OK ' : 'BAD'} ${response.status} ${url}`)
    if (!ok) hasFailure = true
  } catch (error) {
    console.log(`ERR fetch ${url} :: ${error instanceof Error ? error.message : String(error)}`)
    hasFailure = true
  }
}

if (hasFailure) {
  process.exit(1)
}
