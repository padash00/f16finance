import { useState } from 'react'
import { ArrowLeft, User, Lock, Loader2, Check } from 'lucide-react'
import type { ClientSession, KioskConfig } from '@/types'
import { changePassword } from '@/lib/api'
import { cn } from '@/lib/utils'

interface Props {
  client: ClientSession
  config: KioskConfig
  onBack: () => void
  onLogout: () => void
  onClientUpdated: (client: ClientSession) => void
}

type Tab = 'info' | 'password'

export default function ProfileScreen({ client, config, onBack, onLogout }: Props) {
  const [tab, setTab] = useState<Tab>('info')
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    if (newPw !== confirmPw) { setError('Пароли не совпадают'); return }
    if (newPw.length < 6) { setError('Минимум 6 символов'); return }
    setLoading(true)
    setError('')
    try {
      await changePassword(config, client.token, oldPw, newPw)
      setSuccess(true)
      setOldPw(''); setNewPw(''); setConfirmPw('')
      setTimeout(() => setSuccess(false), 3000)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-[#07080a] overflow-hidden">
      <header className="flex items-center gap-4 px-8 py-5 border-b border-white/5">
        <button onClick={onBack} className="text-white/40 hover:text-white/70 transition-colors">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold text-white flex-1">Профиль</h1>
        <button
          onClick={onLogout}
          className="px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 text-sm transition-colors"
        >
          Выйти
        </button>
      </header>

      <div className="flex flex-1 gap-6 p-8 overflow-hidden">
        {/* Боковая панель */}
        <div className="w-64 shrink-0 flex flex-col gap-3">
          {/* Аватар и имя */}
          <div className="rounded-2xl bg-[#11141a] border border-white/5 p-5 flex flex-col items-center gap-3">
            <div className="w-20 h-20 rounded-full bg-blue-600/20 border-2 border-blue-500/20 flex items-center justify-center overflow-hidden">
              {client.avatarUrl ? (
                <img src={client.avatarUrl} alt="avatar" className="w-full h-full object-cover" />
              ) : (
                <User size={32} className="text-blue-400" />
              )}
            </div>
            <div className="text-center">
              <p className="text-white font-semibold">{client.displayName}</p>
              <p className="text-white/40 text-sm">@{client.username}</p>
            </div>
            <div className="w-full pt-3 border-t border-white/5 text-center">
              <p className="text-white/40 text-xs">Баланс</p>
              <p className="text-white font-bold text-xl">{client.balance} ₸</p>
            </div>
          </div>

          {/* Навигация */}
          <nav className="flex flex-col gap-1">
            {[
              { id: 'info' as Tab, label: 'Информация', icon: <User size={16} /> },
              { id: 'password' as Tab, label: 'Сменить пароль', icon: <Lock size={16} /> },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 rounded-xl text-sm text-left transition-colors',
                  tab === item.id
                    ? 'bg-blue-600/15 text-blue-300 border border-blue-500/20'
                    : 'text-white/50 hover:bg-white/5 hover:text-white/70',
                )}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Контент */}
        <div className="flex-1 rounded-2xl bg-[#11141a] border border-white/5 p-6 overflow-y-auto">
          {tab === 'info' && (
            <div className="flex flex-col gap-4">
              <h2 className="text-white font-semibold text-lg">Информация об аккаунте</h2>
              <div className="grid gap-3">
                {[
                  { label: 'Отображаемое имя', value: client.displayName },
                  { label: 'Логин', value: client.username },
                  { label: 'ID клиента', value: client.clientId },
                ].map((row) => (
                  <div key={row.label} className="flex justify-between py-3 border-b border-white/5">
                    <span className="text-white/40 text-sm">{row.label}</span>
                    <span className="text-white text-sm">{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'password' && (
            <div className="max-w-sm">
              <h2 className="text-white font-semibold text-lg mb-6">Смена пароля</h2>
              <form onSubmit={handleChangePassword} className="flex flex-col gap-4">
                {[
                  { label: 'Текущий пароль', value: oldPw, setter: setOldPw },
                  { label: 'Новый пароль', value: newPw, setter: setNewPw },
                  { label: 'Повторите новый пароль', value: confirmPw, setter: setConfirmPw },
                ].map((field) => (
                  <div key={field.label}>
                    <label className="block text-white/40 text-xs mb-1.5">{field.label}</label>
                    <input
                      type="password"
                      value={field.value}
                      onChange={(e) => field.setter(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-white/25 text-sm"
                    />
                  </div>
                ))}

                {error && <p className="text-red-400 text-sm">{error}</p>}
                {success && (
                  <p className="text-green-400 text-sm flex items-center gap-2">
                    <Check size={16} /> Пароль успешно изменён
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading || !oldPw || !newPw || !confirmPw}
                  className="flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors mt-2"
                >
                  {loading && <Loader2 size={16} className="animate-spin" />}
                  Сохранить
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
