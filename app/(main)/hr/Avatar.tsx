'use client'

const COLORS = [
  'bg-rose-500/20 text-rose-300 border-rose-500/30',
  'bg-orange-500/20 text-orange-300 border-orange-500/30',
  'bg-amber-500/20 text-amber-300 border-amber-500/30',
  'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  'bg-teal-500/20 text-teal-300 border-teal-500/30',
  'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  'bg-blue-500/20 text-blue-300 border-blue-500/30',
  'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
  'bg-violet-500/20 text-violet-300 border-violet-500/30',
  'bg-purple-500/20 text-purple-300 border-purple-500/30',
  'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30',
  'bg-pink-500/20 text-pink-300 border-pink-500/30',
]

function hashToColor(str: string): string {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i)
  return COLORS[Math.abs(h) % COLORS.length]
}

function getInitials(name: string): string {
  if (!name) return '?'
  const words = name.trim().split(/\s+/).slice(0, 2)
  return words.map((w) => w[0] || '').join('').toUpperCase()
}

type Props = {
  name: string
  photoUrl?: string | null
  size?: 'sm' | 'md' | 'lg'
  status?: 'online' | 'offline' | 'no-login' | null
}

export default function Avatar({ name, photoUrl, size = 'md', status }: Props) {
  const cls =
    size === 'sm' ? 'w-7 h-7 text-[10px]'
    : size === 'lg' ? 'w-12 h-12 text-base'
    : 'w-9 h-9 text-xs'

  const dotCls =
    size === 'sm' ? 'w-2 h-2'
    : size === 'lg' ? 'w-3 h-3'
    : 'w-2.5 h-2.5'

  const dotColor =
    status === 'online' ? 'bg-emerald-400 ring-2 ring-emerald-400/30'
    : status === 'no-login' ? 'bg-orange-400 ring-2 ring-orange-400/30'
    : status === 'offline' ? 'bg-gray-500'
    : null

  return (
    <div className="relative shrink-0">
      {photoUrl ? (
        <img
          src={photoUrl}
          alt={name}
          className={`${cls} rounded-full object-cover ring-1 ring-white/10`}
          onError={(e) => {
            ;(e.currentTarget as HTMLImageElement).style.display = 'none'
          }}
        />
      ) : (
        <div className={`${cls} rounded-full flex items-center justify-center font-semibold border ${hashToColor(name)}`}>
          {getInitials(name)}
        </div>
      )}
      {dotColor && (
        <div className={`absolute -bottom-0 -right-0 ${dotCls} rounded-full ${dotColor}`} title={status || ''} />
      )}
    </div>
  )
}
