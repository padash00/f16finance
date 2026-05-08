import type { SyncStatus } from '@/lib/use-sync-watcher'

interface Props {
  status: SyncStatus
  lastSyncedAt: Date | null
}

/**
 * Компактный индикатор синхронизации с сайтом:
 *  🟢 online — синк ОК, < 1 мин назад
 *  🟡 stale — > 1 мин без свежей информации
 *  🔵 syncing — первая загрузка
 *  🔴 offline — не получили ответ от сервера
 *
 * Кликабельный: показывает время последней синхронизации в title.
 */
export function SyncIndicator({ status, lastSyncedAt }: Props) {
  const config = {
    online: { color: 'bg-emerald-500', glow: 'shadow-emerald-500/60', label: 'Синхронизировано с сайтом' },
    syncing: { color: 'bg-blue-500 animate-pulse', glow: 'shadow-blue-500/40', label: 'Синхронизация…' },
    stale: { color: 'bg-amber-500', glow: 'shadow-amber-500/40', label: 'Данные могут быть устаревшими' },
    offline: { color: 'bg-rose-500', glow: 'shadow-rose-500/40', label: 'Нет связи с сайтом' },
  }[status]

  const ago = lastSyncedAt ? Math.round((Date.now() - lastSyncedAt.getTime()) / 1000) : null
  const agoStr = ago === null ? 'никогда' : ago < 60 ? `${ago}с назад` : `${Math.round(ago / 60)} мин назад`

  return (
    <div
      title={`${config.label} · последняя синхронизация: ${agoStr}`}
      className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-muted-foreground no-drag"
    >
      <span className={`inline-flex h-1.5 w-1.5 rounded-full ${config.color} shadow ${config.glow}`} />
      <span className="hidden sm:inline">{status === 'online' ? 'синк' : status === 'syncing' ? 'синк…' : status === 'stale' ? 'устарело' : 'офлайн'}</span>
    </div>
  )
}
