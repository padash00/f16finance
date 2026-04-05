import { Card } from '@/components/ui/card'

export default function SetupRequiredPage() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.16),_transparent_30%),linear-gradient(135deg,#050816_0%,#090f1f_48%,#050816_100%)] p-4 text-white">
      <div className="mx-auto flex min-h-screen max-w-4xl items-center justify-center">
        <div className="grid w-full gap-6 lg:grid-cols-[1fr_0.95fr]">
          <Card className="border-white/10 bg-slate-950/70 p-8 backdrop-blur-xl">
            <h1 className="text-3xl font-semibold">Нужно настроить окружение</h1>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              Приложение запущено, но на текущем окружении не хватает публичных переменных Supabase.
              Поэтому авторизация и страницы, завязанные на Supabase, временно недоступны.
            </p>

            <div className="mt-6 rounded-3xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-200">
              Это обычно происходит на Vercel, если после подключения GitHub-репозитория ещё не добавили env-переменные проекта.
            </div>
          </Card>

          <Card className="border-white/10 bg-slate-950/70 p-8 backdrop-blur-xl">
            <h2 className="text-lg font-semibold">Что добавить в Vercel</h2>
            <div className="mt-4 space-y-3 rounded-3xl border border-white/10 bg-black/20 p-4 text-sm text-slate-300">
              <div>
                <p className="font-medium text-white">Обязательно</p>
                <pre className="mt-2 overflow-x-auto rounded-2xl bg-slate-900/80 p-3 text-xs text-sky-200">
{`NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key`}
                </pre>
              </div>

              <div>
                <p className="font-medium text-white">Если используешь уведомления и AI</p>
                <pre className="mt-2 overflow-x-auto rounded-2xl bg-slate-900/80 p-3 text-xs text-emerald-200">
{`TELEGRAM_BOT_TOKEN=your-telegram-bot-token
GEMINI_API_KEY=your-gemini-api-key`}
                </pre>
              </div>
            </div>

            <ol className="mt-5 list-decimal space-y-2 pl-5 text-sm text-slate-300">
              <li>Открой Vercel Project Settings.</li>
              <li>Зайди в раздел `Environment Variables`.</li>
              <li>Добавь переменные из списка выше.</li>
              <li>Сохрани и сделай redeploy проекта.</li>
            </ol>
          </Card>
        </div>
      </div>
    </div>
  )
}
