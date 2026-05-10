'use client'

import { useEffect, useRef, useState } from 'react'
import { MoreVertical, Pencil, RefreshCw, UserCheck, UserMinus, type LucideIcon } from 'lucide-react'

export type MenuAction = {
  label: string
  icon?: LucideIcon
  onClick: () => void
  tone?: 'default' | 'danger' | 'success'
  disabled?: boolean
  hidden?: boolean
}

export function RowMenu({ actions, busy }: { actions: MenuAction[]; busy?: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const visible = actions.filter((a) => !a.hidden)
  if (visible.length === 0) return null

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className={`p-1.5 rounded-lg border border-gray-700 bg-gray-800/50 hover:bg-gray-700 hover:border-gray-600 text-gray-400 hover:text-white transition disabled:opacity-50 ${open ? 'bg-gray-700 text-white border-gray-600' : ''}`}
        title="Действия"
      >
        {busy ? (
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <MoreVertical className="w-3.5 h-3.5" />
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 min-w-[180px] py-1 rounded-lg border border-gray-700 bg-gray-900 shadow-2xl">
          {visible.map((a, i) => {
            const Icon = a.icon
            const toneCls =
              a.tone === 'danger' ? 'text-red-300 hover:bg-red-500/10'
              : a.tone === 'success' ? 'text-emerald-300 hover:bg-emerald-500/10'
              : 'text-gray-300 hover:bg-white/5 hover:text-white'
            return (
              <button
                key={i}
                onClick={() => {
                  setOpen(false)
                  a.onClick()
                }}
                disabled={a.disabled}
                className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition disabled:opacity-50 ${toneCls}`}
              >
                {Icon && <Icon className="w-3.5 h-3.5" />}
                {a.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function InlineRoleDropdown({
  current,
  positions,
  onChange,
  disabled,
}: {
  current: string | null | undefined
  positions: Array<{ name: string; label?: string | null }>
  onChange: (newRole: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const currentLabel = positions.find((p) => p.name === current)?.label || current || '—'

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className={`text-[10px] uppercase px-1.5 py-0.5 rounded border border-gray-700 hover:border-indigo-500/50 hover:bg-indigo-500/10 text-muted-foreground hover:text-indigo-300 transition cursor-pointer disabled:cursor-default disabled:hover:border-gray-700 disabled:hover:bg-transparent disabled:hover:text-muted-foreground`}
        title={disabled ? '' : 'Кликни для смены'}
      >
        {currentLabel} ▾
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-40 min-w-[160px] max-h-[280px] overflow-y-auto py-1 rounded-lg border border-gray-700 bg-gray-900 shadow-2xl">
          {positions.length === 0 && (
            <div className="px-3 py-2 text-xs text-gray-500">Нет должностей</div>
          )}
          {positions.map((p) => (
            <button
              key={p.name}
              onClick={() => {
                setOpen(false)
                if (p.name !== current) onChange(p.name)
              }}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 transition ${
                p.name === current ? 'text-indigo-300 bg-indigo-500/5' : 'text-gray-300'
              }`}
            >
              {p.label || p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
