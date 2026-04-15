import { useState, useEffect } from 'react'
import { Clock, User, PhoneCall, Plus, Gamepad2, Globe, AppWindow, Play } from 'lucide-react'
import type { KioskState, ClientSession, Game } from '@/types'
import { formatSec, cn } from '@/lib/utils'

type CatalogTab = 'game' | 'browser' | 'app'

interface Props {
  kioskState: KioskState
  client: ClientSession | null
  onProfile: () => void
  onExtend: () => void
  onCallOperator: () => void
  onLaunchGame: (id: string) => void
  accentColor?: string | null
}

const TAB_LABELS: Record<CatalogTab, string> = {
  game: 'Игры',
  browser: 'Браузер',
  app: 'Программы',
}

const TAB_ICONS: Record<CatalogTab, React.ReactNode> = {
  game: <Gamepad2 size={16} />,
  browser: <Globe size={16} />,
  app: <AppWindow size={16} />,
}

export default function ShellScreen({ kioskState, client, onProfile, onExtend, onCallOperator, onLaunchGame, accentColor }: Props) {
  const accent = accentColor || '#2563eb'
  const [tab, setTab] = useState<CatalogTab>('game')
  const [warningLevel, setWarningLevel] = useState<'none' | 'warn' | 'danger'>('none')

  const { remainingSec, tariffName, games } = kioskState

  useEffect(() => {
    if (remainingSec <= 60) setWarningLevel('danger')
    else if (remainingSec <= 300) setWarningLevel('warn')
    else setWarningLevel('none')
  }, [remainingSec])

  const filteredGames = games.filter((g) => (g.category || 'game') === tab)

  return (
    <div className="h-screen w-screen flex flex-col bg-[#07080a] overflow-hidden">
      {/* Топ-бар */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-white/5 bg-[#0c0f16] shrink-0">
        {/* Левая часть — профиль */}
        <button
          onClick={client ? onProfile : undefined}
          className={cn(
            'flex items-center gap-3 rounded-xl px-3 py-2 transition-colors',
            client ? 'hover:bg-white/5 cursor-pointer' : 'cursor-default',
          )}
        >
          <div className="w-9 h-9 rounded-full flex items-center justify-center overflow-hidden" style={{ backgroundColor: `${accent}33`, border: `1px solid ${accent}33` }}>
            {client?.avatarUrl ? (
              <img src={client.avatarUrl} alt="avatar" className="w-full h-full object-cover" />
            ) : (
              <User size={18} style={{ color: accent }} />
            )}
          </div>
          <div className="text-left">
            <p className="text-white text-sm font-medium leading-none">
              {client?.displayName || 'Гость'}
            </p>
            {client && (
              <p className="text-white/40 text-xs mt-0.5">
                Баланс: {client.balance} ₸
              </p>
            )}
          </div>
        </button>

        {/* Центр — тариф и таймер */}
        <div className="flex items-center gap-4">
          <div className="text-center">
            <p className="text-white/40 text-xs uppercase tracking-wider">{tariffName}</p>
            <p className={cn(
              'text-3xl font-mono font-bold tabular-nums',
              warningLevel === 'danger' && 'text-red-400 animate-pulse',
              warningLevel === 'warn' && 'text-yellow-400',
              warningLevel === 'none' && 'text-green-400',
            )}>
              {formatSec(remainingSec)}
            </p>
          </div>
        </div>

        {/* Правая часть — действия */}
        <div className="flex items-center gap-2">
          <button
            onClick={onExtend}
            style={{ backgroundColor: `${accent}26`, borderColor: `${accent}33`, color: accent }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border hover:opacity-90 transition-opacity text-sm"
          >
            <Plus size={15} />
            Продлить
          </button>
          <button
            onClick={onCallOperator}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 transition-colors text-sm"
          >
            <PhoneCall size={15} />
            Оператор
          </button>
        </div>
      </header>

      {/* Вкладки каталога */}
      <div className="flex gap-1 px-6 pt-4 pb-3 shrink-0">
        {(Object.keys(TAB_LABELS) as CatalogTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-150',
              tab === t
                ? 'bg-blue-600 text-white'
                : 'bg-white/5 text-white/50 hover:bg-white/8 hover:text-white/70',
            )}
          >
            {TAB_ICONS[t]}
            {TAB_LABELS[t]}
          </button>
        ))}
        <div className="ml-auto flex items-center">
          <span className="text-white/20 text-xs">{filteredGames.length} элементов</span>
        </div>
      </div>

      {/* Каталог */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {filteredGames.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-white/20">
            <Gamepad2 size={48} />
            <p className="text-sm">Ничего не настроено</p>
          </div>
        ) : (
          <div className="grid grid-cols-5 gap-4">
            {filteredGames.map((game) => (
              <GameCard key={game.id} game={game} onLaunch={() => onLaunchGame(game.id)} />
            ))}
          </div>
        )}
      </div>

      {/* Предупреждение о времени */}
      {warningLevel !== 'none' && (
        <div className={cn(
          'fixed bottom-0 left-0 right-0 py-2 text-center text-sm font-medium',
          warningLevel === 'danger' ? 'bg-red-500/20 text-red-300' : 'bg-yellow-500/15 text-yellow-300',
        )}>
          {warningLevel === 'danger'
            ? '⚠ Осталась 1 минута! Продлите сессию.'
            : '⏱ Осталось менее 5 минут'}
        </div>
      )}
    </div>
  )
}

function GameCard({ game, onLaunch }: { game: Game; onLaunch: () => void }) {
  const [imgError, setImgError] = useState(false)

  return (
    <div className="group relative rounded-2xl overflow-hidden bg-[#11141a] border border-white/5 hover:border-white/15 transition-all duration-200 cursor-pointer"
      onClick={onLaunch}>
      {/* Обложка */}
      <div className="aspect-[3/4] relative overflow-hidden bg-[#0c0f16]">
        {game.logoUrl && !imgError ? (
          <img
            src={game.logoUrl}
            alt={game.title}
            onError={() => setImgError(true)}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Gamepad2 size={32} className="text-white/10" />
          </div>
        )}

        {/* Hover оверлей */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all duration-200 flex items-center justify-center">
          <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-blue-600 rounded-full p-3 shadow-lg">
            <Play size={20} className="text-white fill-white" />
          </div>
        </div>
      </div>

      {/* Название */}
      <div className="px-3 py-2.5">
        <p className="text-white text-sm font-medium truncate">{game.title}</p>
      </div>
    </div>
  )
}
