'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2, ShieldCheck, AlertCircle } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'

type OtpFlowType = 'signup' | 'magiclink' | 'recovery' | 'invite' | 'email_change' | 'email'

const OTP_TYPES = new Set<OtpFlowType>(['signup', 'magiclink', 'recovery', 'invite', 'email_change', 'email'])

function parseHashParams() {
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash
  return new URLSearchParams(hash)
}

async function getDefaultPath() {
  const response = await fetch('/api/auth/session-role').catch(() => null)
  const json = await response?.json().catch(() => null)
  if (response?.ok && json?.defaultPath) {
    return String(json.defaultPath)
  }

  return '/'
}

function CallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    const finishAuth = async () => {
      try {
        const queryError = searchParams.get('error_description') || searchParams.get('error')
        if (queryError) {
          throw new Error(queryError)
        }

        const nextParam = searchParams.get('next')
        const code = searchParams.get('code')
        const tokenHash = searchParams.get('token_hash')
        const queryType = searchParams.get('type')
        const queryMode = searchParams.get('mode')

        let flowType = (queryMode || queryType || 'auth') as string

        if (tokenHash && queryType && OTP_TYPES.has(queryType as OtpFlowType)) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: queryType as OtpFlowType,
          })

          if (error) throw error
          flowType = queryType
        } else if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code)
          if (error) throw error
        } else {
          const hashParams = parseHashParams()
          const accessToken = hashParams.get('access_token')
          const refreshToken = hashParams.get('refresh_token')
          const hashType = hashParams.get('type')

          if (accessToken && refreshToken) {
            const { error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            })

            if (error) throw error
            flowType = hashType || flowType
          }
        }

        const {
          data: { session },
        } = await supabase.auth.getSession()

        if (!session) {
          throw new Error('Ссылка устарела или уже была использована.')
        }

        if (!active) return

        if (nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//')) {
          router.replace(nextParam)
          return
        }

        if (flowType === 'recovery' || flowType === 'invite') {
          router.replace(`/reset-password?mode=${flowType}`)
          return
        }

        if (flowType === 'magiclink') {
          router.replace(await getDefaultPath())
          return
        }

        router.replace(`/auth/complete?mode=${encodeURIComponent(flowType)}`)
      } catch (err: any) {
        if (!active) return
        setError(err?.message || 'Не удалось обработать ссылку авторизации.')
      }
    }

    finishAuth()

    return () => {
      active = false
    }
  }, [router, searchParams])

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 p-4">
        <div className="mx-auto flex min-h-screen max-w-md items-center justify-center">
          <Card className="w-full border-red-500/20 bg-gray-900/60 p-6 text-white">
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-2xl bg-red-500/10 p-3">
                <AlertCircle className="h-6 w-6 text-red-400" />
              </div>
              <div>
                <h1 className="text-lg font-semibold">Ссылка недействительна</h1>
                <p className="text-sm text-gray-400">Нужно запросить новую ссылку.</p>
              </div>
            </div>

            <p className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-gray-300">{error}</p>

            <Button className="mt-5 w-full" onClick={() => router.push('/login')}>
              Перейти ко входу
            </Button>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 p-4">
      <div className="mx-auto flex min-h-screen max-w-md items-center justify-center">
        <Card className="w-full border-white/10 bg-gray-900/60 p-6 text-white">
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-2xl bg-violet-500/10 p-3">
              <ShieldCheck className="h-6 w-6 text-violet-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">Проверяем ссылку</h1>
              <p className="text-sm text-gray-400">Подтверждаем доступ и перенаправляем дальше.</p>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-sm text-gray-300">
            <Loader2 className="h-4 w-4 animate-spin text-violet-400" />
            Пожалуйста, подожди пару секунд...
          </div>
        </Card>
      </div>
    </div>
  )
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={null}>
      <CallbackContent />
    </Suspense>
  )
}
