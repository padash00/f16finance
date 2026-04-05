import 'server-only'

export function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`ENV ${name} is not set`)
  }

  return value
}
