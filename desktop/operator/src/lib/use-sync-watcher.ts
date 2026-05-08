import { useEffect, useRef, useState } from 'react'
import * as api from '@/lib/api'
import type { AppConfig } from '@/types'

const POLL_INTERVAL_MS = 30_000 // 30 секунд

export type SyncStatus = 'online' | 'syncing' | 'stale' | 'offline'

interface UseSyncWatcherOptions {
  config: AppConfig
  /** Какие версии (timestamps) отслеживать. Если поле меняется → onSyncNeeded() */
  watch: Array<Exclude<keyof api.SyncVersions, 'pendingMessages' | 'serverTime'>>
  /** Колбек когда обнаружено изменение на сервере */
  onSyncNeeded: () => void
  /** Колбек когда пришло push-сообщение от админа */
  onPushMessage?: (msg: api.PushMessage) => void
  /** Если false — не опрашиваем (например, если оффлайн) */
  enabled?: boolean
}

/**
 * Хук опрашивает /api/point/sync-check каждые 30с и:
 *  — вызывает onSyncNeeded() если изменилась версия одной из watched полей
 *  — обновляет SyncStatus для индикатора (online / syncing / stale / offline)
 *
 * Использование:
 *   const { status, lastSyncedAt } = useSyncWatcher({
 *     config, watch: ['catalogVersion', 'balancesVersion'],
 *     onSyncNeeded: () => void load(true)
 *   })
 */
export function useSyncWatcher({ config, watch, onSyncNeeded, onPushMessage, enabled = true }: UseSyncWatcherOptions) {
  const [status, setStatus] = useState<SyncStatus>('syncing')
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const lastVersionsRef = useRef<api.SyncVersions | null>(null)
  const seenMessagesRef = useRef<Set<string>>(new Set())
  const onSyncNeededRef = useRef(onSyncNeeded)
  const onPushMessageRef = useRef(onPushMessage)
  onSyncNeededRef.current = onSyncNeeded
  onPushMessageRef.current = onPushMessage

  useEffect(() => {
    if (!enabled) {
      setStatus('offline')
      return
    }

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const tick = async () => {
      try {
        const versions = await api.checkSync(config)
        if (cancelled) return

        const prev = lastVersionsRef.current
        let changed = false
        if (prev) {
          for (const key of watch) {
            if (versions[key] !== prev[key]) {
              changed = true
              break
            }
          }
        }
        lastVersionsRef.current = versions
        setLastSyncedAt(new Date())
        setStatus('online')

        if (changed) {
          onSyncNeededRef.current()
        }

        // Обрабатываем push-сообщения (показываем тосты, потом ack)
        for (const msg of versions.pendingMessages || []) {
          if (seenMessagesRef.current.has(msg.id)) continue
          seenMessagesRef.current.add(msg.id)
          onPushMessageRef.current?.(msg)
          // Подтверждаем доставку (даже если onPushMessage пустой)
          api.ackSyncMessage(config, msg.id).catch(() => {})
        }
      } catch {
        if (cancelled) return
        // Сетевая ошибка — переходим в offline
        setStatus('offline')
      } finally {
        if (!cancelled) {
          timer = setTimeout(tick, POLL_INTERVAL_MS)
        }
      }
    }

    void tick()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [config, enabled, watch.join(',')])

  return { status, lastSyncedAt }
}
