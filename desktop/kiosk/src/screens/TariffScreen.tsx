import { useState, useEffect } from 'react'
import { Clock, Loader2, ArrowLeft } from 'lucide-react'
import type { ClientSession, KioskConfig, Tariff } from '@/types'
import { fetchTariffs, buyTariff } from '@/lib/api'
import { ipc } from '@/lib/ipc'
import { cn } from '@/lib/utils'

interface Props {
  client: ClientSession
  config: KioskConfig
  onActivated: () => void
  onBack: () => void
}

export default function TariffScreen({ client, config, onActivated, onBack }: Props) {
  const [tariffs, setTariffs] = useState<Tariff[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [buying, setBuying] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchTariffs(config)
      .then(setTariffs)
      .catch(() => setError('Не удалось загрузить тарифы'))
      .finally(() => setLoading(false))
  }, [])

  async function handleBuy() {
    if (!selected) return
    setBuying(true)
    setError('')
    try {
      const res = await buyTariff(config, client.token, selected)
      if (!res.ok) throw new Error(res.error || 'Ошибка покупки')
      // Запускаем сессию локально — main process обновит таймер
      await ipc.startSessionLocal({
        durationSec: res.durationMin * 60,
        tariffName: selectedTariff!.name,
      })
      onActivated()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setBuying(false)
    }
  }

  const selectedTariff = tariffs.find((t) => t.id === selected)
  const canAfford = selectedTariff ? client.balance >= selectedTariff.price : false

  return (
    <div className="h-screen w-screen flex flex-col bg-[#07080a] overflow-hidden">
      {/* Шапка */}
      <header className="flex items-center gap-4 px-8 py-5 border-b border-white/5">
        <button onClick={onBack} className="text-white/40 hover:text-white/70 transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-white">Выбор тарифа</h1>
          <p className="text-white/40 text-sm">{client.displayName} · Баланс: <span className="text-white">{client.balance} ₸</span></p>
        </div>
      </header>

      <div className="flex-1 flex gap-8 p-8 overflow-hidden">
        {/* Список тарифов */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 size={32} className="text-blue-500 animate-spin" />
            </div>
          ) : tariffs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-white/30">
              <p>Тарифы не найдены. Обратитесь к оператору.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 pr-2">
              {tariffs.map((t) => {
                const affordable = client.balance >= t.price
                const isSelected = selected === t.id
                return (
                  <button
                    key={t.id}
                    onClick={() => setSelected(t.id)}
                    disabled={!affordable}
                    className={cn(
                      'relative text-left p-5 rounded-2xl border transition-all duration-150',
                      isSelected
                        ? 'bg-blue-600/15 border-blue-500/40'
                        : affordable
                          ? 'bg-white/4 border-white/8 hover:bg-white/6 hover:border-white/15'
                          : 'bg-white/2 border-white/5 opacity-40 cursor-not-allowed',
                    )}
                  >
                    {isSelected && (
                      <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
                        <div className="w-2 h-2 rounded-full bg-white" />
                      </div>
                    )}
                    <div className="flex items-center gap-2 mb-3">
                      <Clock size={16} className="text-white/40" />
                      <span className="text-white/60 text-sm">
                        {t.durationMin >= 60
                          ? `${Math.floor(t.durationMin / 60)} ч${t.durationMin % 60 ? ` ${t.durationMin % 60} мин` : ''}`
                          : `${t.durationMin} мин`}
                      </span>
                    </div>
                    <p className="text-white font-semibold text-lg mb-1">{t.name}</p>
                    {t.description && (
                      <p className="text-white/40 text-xs mb-3">{t.description}</p>
                    )}
                    <p className="text-2xl font-bold text-white">{t.price} <span className="text-base font-normal text-white/50">₸</span></p>
                    {!affordable && (
                      <p className="text-red-400 text-xs mt-2">Недостаточно средств</p>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Правая панель — итог и кнопка */}
        <div className="w-72 flex flex-col gap-4 shrink-0">
          <div className="rounded-2xl bg-[#11141a] border border-white/8 p-5 flex-1">
            <h3 className="text-white/50 text-sm font-medium uppercase tracking-wider mb-4">Итог</h3>
            {selectedTariff ? (
              <>
                <p className="text-white font-semibold text-lg">{selectedTariff.name}</p>
                <p className="text-white/40 text-sm mt-1">
                  {selectedTariff.durationMin >= 60
                    ? `${Math.floor(selectedTariff.durationMin / 60)} час${selectedTariff.durationMin % 60 ? ` ${selectedTariff.durationMin % 60} мин` : ''}`
                    : `${selectedTariff.durationMin} минут`}
                </p>
                <div className="mt-4 pt-4 border-t border-white/8">
                  <div className="flex justify-between items-center">
                    <span className="text-white/50 text-sm">Баланс</span>
                    <span className="text-white">{client.balance} ₸</span>
                  </div>
                  <div className="flex justify-between items-center mt-2">
                    <span className="text-white/50 text-sm">Стоимость</span>
                    <span className="text-white">−{selectedTariff.price} ₸</span>
                  </div>
                  <div className="flex justify-between items-center mt-2 pt-2 border-t border-white/8">
                    <span className="text-white/50 text-sm">Остаток</span>
                    <span className={cn('font-semibold', canAfford ? 'text-green-400' : 'text-red-400')}>
                      {client.balance - selectedTariff.price} ₸
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-white/20 text-sm">Выберите тариф</p>
            )}
          </div>

          {error && (
            <p className="text-red-400 text-sm text-center">{error}</p>
          )}

          <button
            onClick={handleBuy}
            disabled={!selected || !canAfford || buying}
            className={cn(
              'w-full py-4 rounded-2xl font-semibold text-white text-base transition-all duration-200',
              'flex items-center justify-center gap-2',
              'disabled:opacity-30 disabled:cursor-not-allowed',
              'bg-blue-600 hover:bg-blue-500',
            )}
          >
            {buying && <Loader2 size={18} className="animate-spin" />}
            {buying ? 'Активация...' : 'Купить и начать'}
          </button>

          <p className="text-white/20 text-xs text-center">
            Если недостаточно средств — пополните баланс у оператора
          </p>
        </div>
      </div>
    </div>
  )
}
