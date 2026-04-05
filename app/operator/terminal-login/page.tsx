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

function videoFrameToImageData(video: HTMLVideoElement, canvas: HTMLCanvasElement, maxSide = 960): ImageData | null {
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
  /** Поток камеры: отдельно от scanning, чтобы <video> успел смонтироваться и ref был не null. */
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const barcodeDetectorRef = useRef<{ detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>> } | null>(
    null,
  )

  const stopScan = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    barcodeDetectorRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setCameraStream(null)
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
      const BD = (typeof window !== 'undefined'
        ? (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
        : undefined) as BarcodeDetectorCtor | undefined
      barcodeDetectorRef.current = BD ? new BD({ formats: ['qr_code'] }) : null
      streamRef.current = stream
      setCameraStream(stream)
      setScanning(true)
    } catch {
      setScanError('Камера недоступна. Разрешите доступ в настройках браузера или загрузите фото с QR ниже.')
    }
  }

  /** После scanning=true в DOM появляется <video> — ждём ref, вешаем stream и цикл распознавания. */
  useEffect(() => {
    if (!scanning || !cameraStream) return

    let cancelled = false

    const finishRaw = (raw: string) => {
      if (cancelled) return
      const n = nonceFromQrText(raw)
      stopScan()
      if (n) {
        router.push(`/operator/point-qr-confirm?n=${encodeURIComponent(n)}`)
        return
      }
      setScanError('В QR нет ссылки входа Orda Point. Введите код вручную ниже.')
    }

    const waitForVideoSize = (video: HTMLVideoElement) =>
      new Promise<void>((resolve) => {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          resolve()
          return
        }
        const done = () => {
          video.removeEventListener('loadedmetadata', done)
          video.removeEventListener('playing', done)
          resolve()
        }
        video.addEventListener('loadedmetadata', done, { once: true })
        video.addEventListener('playing', done, { once: true })
        window.setTimeout(resolve, 2500)
      })

    const run = async () => {
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))

      const video = videoRef.current
      const canvas = canvasRef.current
      if (cancelled || !video || !canvas) {
        if (!cancelled) {
          setScanError('Не удалось открыть превью. Нажмите «Стоп» и «Сканировать» ещё раз.')
          stopScan()
        }
        return
      }

      video.srcObject = cameraStream

      try {
        await video.play()
      } catch {
        if (!cancelled) setScanError('Не удалось запустить превью камеры.')
        stopScan()
        return
      }

      await waitForVideoSize(video)
      if (cancelled) return

      const detector = barcodeDetectorRef.current

      const tick = async () => {
        if (cancelled) return
        const el = videoRef.current
        const cv = canvasRef.current
        if (!el || !cv || el.readyState < 2) {
          rafRef.current = requestAnimationFrame(() => void tick())
          return
        }

        try {
          if (detector) {
            const barcodes = await detector.detect(el)
            const raw = barcodes[0]?.rawValue
            if (raw) {
              finishRaw(raw)
              return
            }
          }
        } catch {
          /* пропуск кадра */
        }

        try {
          const imageData = videoFrameToImageData(el, cv)
          if (imageData) {
            const raw = decodeQrWithJsQR(imageData)
            if (raw) {
              finishRaw(raw)
              return
            }
          }
        } catch {
          /* пропуск кадра */
        }

        rafRef.current = requestAnimationFrame(() => void tick())
      }

      void tick()
    }

    void run()

    return () => {
      cancelled = true
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [scanning, cameraStream, router, stopScan])

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
                На телефоне нажмите <strong className="text-white">«Сканировать QR»</strong>, разрешите камеру — появится превью, наведите на QR на экране ПК.
              </li>
              <li>Можно загрузить фото с QR или вставить код из ссылки вручную.</li>
            </ol>
          </div>
        </div>
      </OperatorPanel>

      <OperatorPanel className="border-white/10 bg-white/[0.045]">
        <OperatorSectionHeading
          title="Сканировать камерой"
          description="После разрешения камеры должно появиться изображение. Если чёрный экран подождите 1–2 с или нажмите «Стоп» и снова «Сканировать»."
        />
        {scanning ? (
          <div className="mt-4 space-y-3">
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/40">
              <video ref={videoRef} className="aspect-video w-full object-cover" playsInline muted autoPlay />
            </div>
            <p className="text-center text-xs text-slate-400">Держите QR в центре кадра 2–5 секунд при хорошем свете.</p>
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
