/**
 * Модалка настроек оператора: тема, размер шрифта, звуки.
 * Открывается через шестерёнку в шапке.
 */

import { useState, useEffect } from 'react'
import { Sun, Moon, Monitor, Volume2, VolumeX, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  type Theme,
  type FontSize,
  getTheme,
  setTheme,
  getFontSize,
  setFontSize,
  isSoundEnabled,
  setSoundEnabled,
} from '@/lib/preferences'

type PreferencesModalProps = {
  open: boolean
  onClose: () => void
}

export function PreferencesModal({ open, onClose }: PreferencesModalProps) {
  const [theme, setThemeState] = useState<Theme>(getTheme())
  const [fontSize, setFontSizeState] = useState<FontSize>(getFontSize())
  const [sound, setSound] = useState<boolean>(isSoundEnabled())

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  const onThemeChange = (t: Theme) => {
    setThemeState(t)
    setTheme(t)
  }
  const onFontChange = (f: FontSize) => {
    setFontSizeState(f)
    setFontSize(f)
  }
  const onSoundChange = (s: boolean) => {
    setSound(s)
    setSoundEnabled(s)
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <h3 className="text-lg font-bold">Настройки</h3>
          <button
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Theme */}
        <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <p className="mb-3 text-sm font-medium">Тема</p>
          <div className="flex gap-2">
            {([
              { value: 'light', label: 'Светлая', icon: Sun },
              { value: 'dark', label: 'Тёмная', icon: Moon },
              { value: 'system', label: 'Авто', icon: Monitor },
            ] as Array<{ value: Theme; label: string; icon: any }>).map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => onThemeChange(value)}
                className={`flex flex-1 flex-col items-center gap-1.5 rounded-xl border-2 px-3 py-3 transition ${
                  theme === value
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
                    : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600'
                }`}
              >
                <Icon className="h-5 w-5" />
                <span className="text-xs">{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Font size */}
        <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <p className="mb-3 text-sm font-medium">Размер текста</p>
          <div className="flex gap-2">
            {([
              { value: 'sm', label: 'А', size: 'text-sm' },
              { value: 'md', label: 'А', size: 'text-base' },
              { value: 'lg', label: 'А', size: 'text-lg' },
              { value: 'xl', label: 'А', size: 'text-xl' },
            ] as Array<{ value: FontSize; label: string; size: string }>).map(({ value, label, size }) => (
              <button
                key={value}
                onClick={() => onFontChange(value)}
                className={`flex-1 rounded-xl border-2 py-3 font-bold transition ${size} ${
                  fontSize === value
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
                    : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Sound */}
        <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <p className="mb-3 text-sm font-medium">Звуки</p>
          <button
            onClick={() => onSoundChange(!sound)}
            className={`flex w-full items-center justify-between rounded-xl border-2 px-4 py-3 transition ${
              sound
                ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
                : 'border-slate-200 dark:border-slate-700'
            }`}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              {sound ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
              {sound ? 'Звуки включены' : 'Звуки отключены'}
            </span>
            <div className={`h-6 w-12 rounded-full transition ${sound ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'} relative`}>
              <div className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${sound ? 'left-6' : 'left-0.5'}`} />
            </div>
          </button>
        </div>

        {/* Footer */}
        <div className="flex justify-end p-4">
          <Button onClick={onClose} className="bg-slate-900 text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200">
            Готово
          </Button>
        </div>
      </div>
    </div>
  )
}
