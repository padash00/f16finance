import { useState, useEffect } from 'react'
import { Loader2, Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FormData {
  stationCode: string
  serverBaseUrl: string
  provisioningKey: string
  wsUrl: string
  clubName: string
  defaultGamePath: string
}

export default function SetupScreen() {
  const [form, setForm] = useState<FormData>({
    stationCode: '',
    serverBaseUrl: '',
    provisioningKey: '',
    wsUrl: '',
    clubName: '',
    defaultGamePath: '',
  })
  const [showKey, setShowKey] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [loadingData, setLoadingData] = useState(true)

  useEffect(() => {
    window.kioskApi.setup.load().then((data) => {
      setForm((prev) => ({ ...prev, ...data }))
    }).catch(() => null).finally(() => setLoadingData(false))
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.stationCode.trim()) { setError('Укажите код станции'); return }
    if (!form.serverBaseUrl.trim()) { setError('Укажите URL сервера'); return }
    if (!form.provisioningKey.trim()) { setError('Укажите ключ активации'); return }

    setLoading(true)
    setError('')
    try {
      const res = await window.kioskApi.setup.save({
        stationCode: form.stationCode.trim(),
        serverBaseUrl: form.serverBaseUrl.trim(),
        provisioningKey: form.provisioningKey.trim(),
        wsUrl: form.wsUrl.trim(),
        clubName: form.clubName.trim(),
        defaultGamePath: form.defaultGamePath.trim(),
      })
      if (!res.ok) throw new Error(res.error || 'Ошибка сохранения')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Ошибка')
      setLoading(false)
    }
  }

  function set(key: keyof FormData) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }))
  }

  if (loadingData) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#07080a]">
        <Loader2 size={32} className="text-blue-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-[#07080a]">
      <div className="w-full max-w-lg bg-[#11141a] border border-white/8 rounded-2xl p-8">
        <h1 className="text-2xl font-bold text-white mb-1">Настройка Orda Kiosk</h1>
        <p className="text-white/40 text-sm mb-8">Конфиг сохранится локально после регистрации</p>

        <form onSubmit={handleSave} className="flex flex-col gap-4">
          {[
            { key: 'stationCode' as const, label: 'Код станции', placeholder: 'VIP-111', required: true },
            { key: 'serverBaseUrl' as const, label: 'URL сайта Orda', placeholder: 'https://example.com', required: true },
            { key: 'wsUrl' as const, label: 'WebSocket URL', placeholder: 'wss://example.com/ws/kiosk', required: false },
            { key: 'clubName' as const, label: 'Название клуба', placeholder: 'ORDA CLUB', required: false },
            { key: 'defaultGamePath' as const, label: 'Путь к игре по умолчанию', placeholder: 'D:\\Games\\CS2\\cs2.exe', required: false },
          ].map((field) => (
            <div key={field.key}>
              <label className="block text-white/50 text-xs mb-1.5">
                {field.label}
                {field.required && <span className="text-red-400 ml-1">*</span>}
              </label>
              <input
                type="text"
                value={form[field.key]}
                onChange={set(field.key)}
                placeholder={field.placeholder}
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/20 focus:outline-none focus:border-white/25 text-sm"
              />
            </div>
          ))}

          {/* Provisioning key отдельно — с глазом */}
          <div>
            <label className="block text-white/50 text-xs mb-1.5">
              Ключ активации (provisioning key)
              <span className="text-red-400 ml-1">*</span>
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={form.provisioningKey}
                onChange={set('provisioningKey')}
                placeholder="Из раздела Станции на сайте"
                className="w-full px-4 py-3 pr-11 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/20 focus:outline-none focus:border-white/25 text-sm"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-red-400 text-sm">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className={cn(
              'mt-2 w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold',
              'flex items-center justify-center gap-2 transition-colors',
              'disabled:opacity-40 disabled:cursor-not-allowed',
            )}
          >
            {loading && <Loader2 size={18} className="animate-spin" />}
            {loading ? 'Регистрация...' : 'Сохранить и запустить'}
          </button>

          <button
            type="button"
            onClick={() => {
              if (confirm('Сбросить конфигурацию? Программа перезапустится для повторной регистрации.')) {
                window.kioskApi.setup.clearConfig()
              }
            }}
            className="w-full py-2.5 rounded-xl border border-white/10 text-white/30 hover:text-white/60 hover:border-white/20 text-sm transition-colors"
          >
            Сбросить конфиг
          </button>
        </form>
      </div>
    </div>
  )
}
