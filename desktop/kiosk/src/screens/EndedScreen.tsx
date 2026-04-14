import { TimerOff, Plus, LogOut } from 'lucide-react'

interface Props {
  onExtend: () => void
  onLogout: () => void
}

export default function EndedScreen({ onExtend, onLogout }: Props) {
  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center gap-8 bg-[#07080a]">
      <div className="w-24 h-24 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
        <TimerOff size={40} className="text-red-400" />
      </div>

      <div className="text-center">
        <h1 className="text-4xl font-bold text-white mb-3">Время истекло</h1>
        <p className="text-white/40">Сессия завершена. Продлите или обратитесь к оператору.</p>
      </div>

      <div className="flex gap-4">
        <button
          onClick={onExtend}
          className="flex items-center gap-2 px-8 py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-base transition-colors"
        >
          <Plus size={20} />
          Продлить сессию
        </button>
        <button
          onClick={onLogout}
          className="flex items-center gap-2 px-8 py-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 text-white/60 font-semibold text-base transition-colors"
        >
          <LogOut size={20} />
          Выйти
        </button>
      </div>
    </div>
  )
}
