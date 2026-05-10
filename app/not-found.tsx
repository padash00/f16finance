'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Home, ArrowLeft, RefreshCw, Sparkles } from 'lucide-react'

const JOKES = [
  { emoji: '🙈', text: 'Эта страница ушла на смену и не вернулась' },
  { emoji: '👻', text: 'Здесь пусто. Видимо страница уволилась' },
  { emoji: '🐱', text: 'Кошка наступила на сервер — страница где-то здесь' },
  { emoji: '☕', text: 'Страница пошла за кофе. Жди или возвращайся домой' },
  { emoji: '🛸', text: 'Страницу забрали инопланетяне для опытов' },
  { emoji: '🎩', text: 'Магия не сработала — страница не появилась' },
  { emoji: '🚀', text: 'Страница улетела в космос. Без скафандра не догнать' },
  { emoji: '🦄', text: 'Эта страница такая редкая что её никто не видел' },
  { emoji: '🍕', text: 'Страница потерялась в дороге как пицца в пробке' },
  { emoji: '🎯', text: 'Ты почти попал, но мимо. Бывает' },
  { emoji: '🐢', text: 'Страница есть, но идёт очень медленно. Возможно никогда' },
  { emoji: '🧙', text: 'Гэндальф сказал «You shall not pass» — и страница послушалась' },
  { emoji: '🎮', text: 'Game Over. Страница не загружена. Insert coin' },
  { emoji: '🏝️', text: 'Страница уехала в отпуск. Без даты возврата' },
  { emoji: '🤷', text: 'Не знаем где она. Ты тоже не знаешь. Все не знают' },
]

const TIPS = [
  'Проверь URL — может опечатка',
  'Возможно ссылка устарела',
  'Жми «Домой» и начни сначала',
  'Если думаешь что это баг — напиши в чат',
  'Страница могла быть удалена. Это не ты',
]

export default function NotFound() {
  const [joke, setJoke] = useState(JOKES[0])
  const [tip, setTip] = useState(TIPS[0])
  const [pulse, setPulse] = useState(false)

  useEffect(() => {
    const j = JOKES[Math.floor(Math.random() * JOKES.length)]
    const t = TIPS[Math.floor(Math.random() * TIPS.length)]
    setJoke(j)
    setTip(t)
  }, [])

  const reroll = () => {
    setPulse(true)
    setTimeout(() => setPulse(false), 300)
    let next = JOKES[Math.floor(Math.random() * JOKES.length)]
    while (next.text === joke.text && JOKES.length > 1) {
      next = JOKES[Math.floor(Math.random() * JOKES.length)]
    }
    setJoke(next)
    setTip(TIPS[Math.floor(Math.random() * TIPS.length)])
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-gradient-to-br from-gray-950 via-gray-900 to-indigo-950 relative overflow-hidden">
      {/* Декоративные блобы */}
      <div className="absolute top-1/4 -left-20 w-96 h-96 bg-indigo-500 rounded-full blur-3xl opacity-10 pointer-events-none animate-pulse" />
      <div className="absolute bottom-1/4 -right-20 w-96 h-96 bg-fuchsia-500 rounded-full blur-3xl opacity-10 pointer-events-none animate-pulse" style={{ animationDelay: '1s' }} />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-purple-500 rounded-full blur-3xl opacity-5 pointer-events-none" />

      <div className="relative z-10 text-center max-w-xl">
        {/* Гигантский 404 */}
        <div className="relative inline-block">
          <div className="text-[160px] sm:text-[220px] font-black bg-gradient-to-br from-indigo-400 via-fuchsia-400 to-pink-400 bg-clip-text text-transparent leading-none tracking-tighter select-none">
            404
          </div>
          {/* Парящий emoji */}
          <div className={`absolute -top-2 -right-4 sm:-top-4 sm:-right-8 text-5xl sm:text-7xl ${pulse ? 'scale-125 rotate-12' : ''} transition-transform duration-300 animate-bounce`} style={{ animationDuration: '3s' }}>
            {joke.emoji}
          </div>
        </div>

        {/* Шутка */}
        <div className={`mt-6 text-lg sm:text-xl text-white font-medium transition-opacity duration-300 ${pulse ? 'opacity-50' : 'opacity-100'}`}>
          {joke.text}
        </div>

        {/* Tip */}
        <div className="mt-3 text-sm text-gray-400">
          💡 {tip}
        </div>

        {/* Кнопки */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/dashboard">
            <button className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-fuchsia-600 hover:from-indigo-500 hover:to-fuchsia-500 text-white font-medium shadow-lg shadow-indigo-500/30 transition-all hover:scale-105 flex items-center gap-2">
              <Home className="w-4 h-4" />
              На главную
            </button>
          </Link>
          <button
            onClick={() => window.history.back()}
            className="px-5 py-2.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-white font-medium transition-all flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Назад
          </button>
          <button
            onClick={reroll}
            className="px-5 py-2.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-gray-300 font-medium transition-all flex items-center gap-2 group"
            title="Другая шутка"
          >
            <Sparkles className="w-4 h-4 group-hover:rotate-12 transition-transform" />
            Ещё шутку
          </button>
        </div>

        {/* Маленькая подпись */}
        <div className="mt-12 text-xs text-gray-600 select-none">
          Orda Control · Если это баг — пиши в командный чат
        </div>
      </div>
    </div>
  )
}
