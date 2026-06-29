'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return
      if (btnRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onScroll = () => setOpen(false)
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onEsc)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onEsc)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  const handleToggle = () => {
    if (open) {
      setOpen(false)
      return
    }
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    }
    setOpen(true)
  }

  const visible = actions.filter((a) => !a.hidden)
  if (visible.length === 0) return null

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleToggle}
        disabled={busy}
        className={`p-1.5 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 hover:bg-slate-100 dark:hover:bg-gray-700 hover:border-slate-300 dark:hover:border-gray-600 text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white transition disabled:opacity-50 ${open ? 'bg-slate-100 dark:bg-gray-700 text-foreground border-slate-300 dark:border-gray-600' : ''}`}
        title="Действия"
      >
        {busy ? (
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <MoreVertical className="w-3.5 h-3.5" />
        )}
      </button>
      {open && pos && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 200 }}
          className="min-w-[180px] py-1 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl"
        >
          {visible.map((a, i) => {
            const Icon = a.icon
            const toneCls =
              a.tone === 'danger' ? 'text-red-700 dark:text-red-300 hover:bg-red-500/10'
              : a.tone === 'success' ? 'text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10'
              : 'text-slate-700 dark:text-gray-300 hover:bg-surface-muted hover:text-slate-900 dark:hover:text-white'
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
        </div>,
        document.body,
      )}
    </>
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
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return
      if (btnRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onScroll = () => setOpen(false)
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onEsc)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onEsc)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  const handleToggle = () => {
    if (disabled) return
    if (open) {
      setOpen(false)
      return
    }
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 4, left: rect.left })
    }
    setOpen(true)
  }

  const currentLabel = positions.find((p) => p.name === current)?.label || current || '—'

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleToggle}
        disabled={disabled}
        className={`text-[10px] uppercase px-1.5 py-0.5 rounded border border-slate-200 dark:border-gray-700 hover:border-indigo-500/50 hover:bg-indigo-500/10 text-muted-foreground hover:text-indigo-600 dark:hover:text-indigo-300 transition cursor-pointer disabled:cursor-default disabled:hover:border-slate-200 dark:disabled:hover:border-gray-700 disabled:hover:bg-transparent disabled:hover:text-muted-foreground`}
        title={disabled ? '' : 'Кликни для смены'}
      >
        {currentLabel} ▾
      </button>
      {open && pos && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 200 }}
          className="min-w-[160px] max-h-[280px] overflow-y-auto py-1 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl"
        >
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
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-surface-muted transition ${
                p.name === current ? 'text-indigo-600 dark:text-indigo-300 bg-indigo-500/5' : 'text-slate-700 dark:text-gray-300'
              }`}
            >
              {p.label || p.name}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
