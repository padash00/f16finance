import { ShieldAlert, PhoneCall } from 'lucide-react'
import { ipc } from '@/lib/ipc'

interface Props {
  reason: string
}

export default function BlockedScreen({ reason }: Props) {
  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center gap-8 bg-[#07080a]">
      <div className="w-24 h-24 rounded-full bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
        <ShieldAlert size={40} className="text-orange-400" />
      </div>

      <div className="text-center max-w-md">
        <h1 className="text-3xl font-bold text-white mb-3">Станция заблокирована</h1>
        <p className="text-white/40">{reason || 'Устройство не совпадает с привязкой станции.'}</p>
      </div>

      <button
        onClick={() => ipc.callOperator()}
        className="flex items-center gap-2 px-8 py-4 rounded-2xl bg-orange-500/15 border border-orange-500/25 text-orange-300 hover:bg-orange-500/25 font-semibold text-base transition-colors"
      >
        <PhoneCall size={20} />
        Вызвать оператора
      </button>
    </div>
  )
}
