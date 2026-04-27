/** True when a fetch or async task was cancelled via AbortController. */
export function isAbortError(err: unknown): boolean {
  if (err == null) return false
  if (err instanceof Error && err.name === 'AbortError') return true
  if (typeof (err as { name?: string }).name === 'string' && (err as { name: string }).name === 'AbortError') {
    return true
  }
  if (err instanceof DOMException && err.name === 'AbortError') return true
  return false
}
