'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, ChevronRight, Keyboard, MonitorSmartphone } from 'lucide-react'

import { OperatorPanel, OperatorSectionHeading } from '@/components/operator/operator-mobile-ui'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type BarcodeDetectorCtor = new (opts: { formats: string[] }) => {
  detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>>
}

function nonceFromQrText(raw: string): string | null {
  const t = raw.trim()
  try {
    if (t.includes('://')) {
      const u = new URL(t)
      const n = u.searchParams.get('n')
      if (n?.trim()) return n.trim()
    }
  } catch {
    /* not a URL */
  }
  if (/^[A-Za-z0-9_-]{16,256}$/.test(t)) return t
  return null
}

export default function OperatorTerminalLoginPage() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [scanError, setScanError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [scanning, setScanning] = useState(false)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)

  const stopScan = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setScanning(false)
  }, [])

  useEffect(() => () => stopScan(), [stopScan])

  const goConfirm = (n: string) => {
    const trimmed = n.trim()
    if (!trimmed) return
    router.push(`/operator/point-qr-confirm?n=${encodeURIComponent(trimmed)}`)
  }

  const startScan = async () => {
    const BD = (typeof window !== 'undefined' ? (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector : undefined) as BarcodeDetectorCtor | undefined
    if (!BD) {
      setScanError(
        'В этом браузере нет встроенного сканера QR. Наведите штатную «Камеру» телефона на экран с Orda Point — откроется страница подтверждения. Либо введите код вручную ниже.',
      )
      return
    }
    setScanError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
      })
      streamRef.current = stream
      const v = videoRef.current
      if (!v) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      v.srcObject = stream
      await v.play()
      setScanning(true)
      const detector = new BD({ formats: ['qr_code'] })

      const tick = async () => {
        const el = videoRef.current
        if (!el || el.readyState < 2) {
          rafRef.current = requestAnimationFrame(() => void tick())
          return
        }
        try {
          const barcodes = await detector.detect(el)
          const raw = barcodes[0]?.rawValue
          if (raw) {
            const n = nonceFromQrText(raw)
            stopScan()
            if (n) {
              router.push(`/operator/point-qr-confirm?n=${encodeURIComponent(n)}`)
              return
            }
            setScanError('В QR нет ссылки входа Orda Point. Введите код вручную.')
            return
          }
        } catch {
          /* single frame failed */
        }
        rafRef.current = requestAnimationFrame(() => void tick())
      }
      void tick()
    } catch {
      setScanError('Камера недоступна. Разрешите доступ в настройках или отсканируйте системной камерой QR на мониторе кассы.')
    }
  }

  return (
    <div className="space-y-4">
      <OperatorPanel className="border-white/10 bg-white/[0.045]">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl border border-amber-400/25 bg-amber-400/10 p-3 text-amber-200">
            <MonitorSmartphone className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <OperatorSectionHeading
              title="Вход на Orda Point по QR"
              description="Без ввода пароля на кассе — только подтверждение в вашем кабинете."
            />
            <ol className="mt-3 list-decimal space-y-2 pl-4 text-sm leading-relaxed text-slate-300">
              <li>На компьютере в Orda Point выберите вход «QR-код».</li>
              <li>
                На телефоне отсканируйте QR: обычно достаточно <strong className="text-white">камеры телефона</strong> — откроется эта
                система с кнопкой подтверждения.
              </li>
              <li>Либо нажмите «Сканировать здесь» (если браузер поддерживает) или вставьте код из адреса ссылки.</li>
            </ol>
          </div>
        </div>
      </OperatorPanel>

      <OperatorPanel className="border-white/10 bg-white/[0.045]">
        <OperatorSectionHeading
          title="Сканировать QR здесь"
          description="Работает в Chrome на Android и в браузерах с поддержкой BarcodeDetector. На iPhone чаще удобнее штатная «Камера»."
        />
        {scanning ? (
          <div className="mt-4 space-y-3">
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/40">
              <video ref={videoRef} className="aspect-video w-full object-cover" playsInline muted />
            </div>
            <Button type="button" variant="outline" className="w-full border-white/20 text-white" onClick={stopScan}>
              Остановить камеру
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            className="mt-4 w-full gap-2 bg-[linear-gradient(135deg,rgba(255,179,107,0.96),rgba(255,122,89,0.94))] text-slate-950 hover:opacity-95"
            onClick={() => void startScan()}
          >
            <Camera className="h-4 w-4" />
            Сканировать QR
          </Button>
        )}
        {scanError ? <p className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">{scanError}</p> : null}
      </OperatorPanel>

      <OperatorPanel className="border-white/10 bg-white/[0.045]">
        <OperatorSectionHeading
          title="Код из ссылки"
          description="Если ссылка уже открыта в другом окне — скопируйте из адреса значение параметра n= (длинная строка)."
        />
        <div className="mt-4 space-y-2">
          <Label htmlFor="terminal-nonce" className="text-slate-300">
            Код
          </Label>
          <Input
            id="terminal-nonce"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Вставьте код после n= …"
            className="border-white/15 bg-white/[0.06] text-white placeholder:text-slate-500"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        </div>
        <Button
          type="button"
          className="mt-4 w-full gap-2"
          variant="secondary"
          onClick={() => goConfirm(code)}
          disabled={!code.trim()}
        >
          <Keyboard className="h-4 w-4" />
          Перейти к подтверждению
          <ChevronRight className="h-4 w-4 opacity-70" />
        </Button>
      </OperatorPanel>
    </div>
  )
}
