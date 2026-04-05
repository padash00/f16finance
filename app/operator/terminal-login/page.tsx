'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { Camera, ChevronRight, ImageUp, Keyboard, MonitorSmartphone } from 'lucide-react'

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

function decodeQrWithJsQR(imageData: ImageData): string | null {
  const result = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' })
  return result?.data ?? null
}

/** Рисуем кадр видео на canvas и читаем QR через jsQR (Safari, Firefox, большинство мобильных). */
function videoFrameToImageData(video: HTMLVideoElement, canvas: HTMLCanvasElement, maxSide = 720): ImageData | null {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) return null

  const scale = Math.min(1, maxSide / Math.max(vw, vh))
  const cw = Math.max(1, Math.floor(vw * scale))
  const ch = Math.max(1, Math.floor(vh * scale))

  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  canvas.width = cw
  canvas.height = ch
  ctx.drawImage(video, 0, 0, cw, ch)
  return ctx.getImageData(0, 0, cw, ch)
}

export default function OperatorTerminalLoginPage() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [scanError, setScanError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [scanning, setScanning] = useState(false)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const frameCountRef = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const stopScan = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    frameCountRef.current = 0
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

  const handleDecodedRaw = (raw: string) => {
    const n = nonceFromQrText(raw)
    stopScan()
    if (n) {
      router.push(`/operator/point-qr-confirm?n=${encodeURIComponent(n)}`)
      return
    }
    setScanError('В QR нет ссылки входа Orda Point. Введите код вручную ниже.')
  }

  const startScan = async () => {
    setScanError(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setScanError('Браузер не даёт доступ к камере. Откройте страницу по HTTPS или используйте другой браузер.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
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

      const BD = (typeof window !== 'undefined'
        ? (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
        : undefined) as BarcodeDetectorCtor | undefined
      const barcodeDetector = BD ? new BD({ formats: ['qr_code'] }) : null

      const tick = async () => {
        const el = videoRef.current
        const canvas = canvasRef.current
        if (!el || !canvas || el.readyState < 2) {
          rafRef.current = requestAnimationFrame(() => void tick())
          return
        }

        frameCountRef.current += 1
        const useHeavyJsQr = frameCountRef.current % 3 === 0

        try {
          if (barcodeDetector) {
            const barcodes = await barcodeDetector.detect(el)
            const raw = barcodes[0]?.rawValue
            if (raw) {
              handleDecodedRaw(raw)
              return
            }
          }
        } catch {
          /* кадр BarcodeDetector пропускаем */
        }

        if (useHeavyJsQr) {
          try {
            const imageData = videoFrameToImageData(el, canvas)
            if (imageData) {
              const raw = decodeQrWithJsQR(imageData)
              if (raw) {
                handleDecodedRaw(raw)
                return
              }
            }
          } catch {
            /* кадр jsQR пропускаем */
          }
        }

        rafRef.current = requestAnimationFrame(() => void tick())
      }
      void tick()
    } catch {
      setScanError('Камера недоступна. Разрешите доступ в настройках браузера или загрузите фото с QR ниже.')
    }
  }

  const onPickImage = () => fileInputRef.current?.click()

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !file.type.startsWith('image/')) {
      setScanError('Выберите файл изображения (JPG, PNG).')
      return
    }
    setScanError(null)
    const canvas = canvasRef.current
    if (!canvas) return

    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      try {
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) {
          setScanError('Не удалось обработать изображение.')
          return
        }
        const maxSide = 1600
        let w = img.naturalWidth
        let h = img.naturalHeight
        const scale = Math.min(1, maxSide / Math.max(w, h))
        w = Math.floor(w * scale)
        h = Math.floor(h * scale)
        canvas.width = w
        canvas.height = h
        ctx.drawImage(img, 0, 0, w, h)
        const imageData = ctx.getImageData(0, 0, w, h)
        const raw = decodeQrWithJsQR(imageData)
        if (raw) {
          const n = nonceFromQrText(raw)
          if (n) {
            router.push(`/operator/point-qr-confirm?n=${encodeURIComponent(n)}`)
            return
          }
        }
        setScanError('На фото не найден QR Orda Point. Сделайте крупнее или используйте камеру.')
      } catch {
        setScanError('Не удалось прочитать файл.')
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      setScanError('Не удалось открыть изображение.')
    }
    img.src = url
  }

  return (
    <div className="space-y-4">
      <canvas ref={canvasRef} className="pointer-events-none fixed left-0 top-0 h-px w-px opacity-0" aria-hidden />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={onFileChange}
      />

      <OperatorPanel className="border-white/10 bg-white/[0.045]">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl border border-amber-400/25 bg-amber-400/10 p-3 text-amber-200">
            <MonitorSmartphone className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <OperatorSectionHeading
              title="Вход на Orda Point по QR"
              description="Без ввода пароля на кассе — подтверждение здесь, в кабинете оператора."
            />
            <ol className="mt-3 list-decimal space-y-2 pl-4 text-sm leading-relaxed text-slate-300">
              <li>На кассе в Orda Point откройте вход «QR-код».</li>
              <li>
                На телефоне нажмите <strong className="text-white">«Сканировать QR»</strong> и наведите камеру на экран — код
                считается прямо в браузере.
              </li>
              <li>Можно сделать фото QR и загрузить файл — или вставить код из ссылки вручную.</li>
            </ol>
          </div>
        </div>
      </OperatorPanel>

      <OperatorPanel className="border-white/10 bg-white/[0.045]">
        <OperatorSectionHeading
          title="Сканировать камерой"
          description="Работает на HTTPS в большинстве браузеров (включая многие версии Safari). Разрешите доступ к камере."
        />
        {scanning ? (
          <div className="mt-4 space-y-3">
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/40">
              <video ref={videoRef} className="aspect-video w-full object-cover" playsInline muted />
            </div>
            <p className="text-center text-xs text-slate-400">Держите QR в рамке, подождите 1–3 секунды.</p>
            <Button type="button" variant="outline" className="w-full border-white/20 text-white" onClick={stopScan}>
              Остановить камеру
            </Button>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              className="flex-1 gap-2 bg-[linear-gradient(135deg,rgba(255,179,107,0.96),rgba(255,122,89,0.94))] text-slate-950 hover:opacity-95"
              onClick={() => void startScan()}
            >
              <Camera className="h-4 w-4" />
              Сканировать QR
            </Button>
            <Button type="button" variant="outline" className="flex-1 gap-2 border-white/20 text-white" onClick={onPickImage}>
              <ImageUp className="h-4 w-4" />
              Фото с QR
            </Button>
          </div>
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
