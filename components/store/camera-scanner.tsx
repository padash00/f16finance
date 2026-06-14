'use client'

import { Camera, Flashlight, X, ZoomIn } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Единый сканер штрихкода с камеры телефона.
 *
 * Зачем отдельный компонент: раньше было три копии zxing-сканера с низким
 * разрешением, без зума/фонарика — мелкий EAN-13 ловился плохо. Здесь:
 *  - нативный BarcodeDetector (Android Chrome — быстрый, аппаратный), zxing как фолбэк;
 *  - высокое разрешение видео + непрерывная фокусировка;
 *  - слайдер зума (если устройство умеет) — приблизить мелкий штрихкод;
 *  - фонарик (если поддерживается);
 *  - вибро + звук на удачный/неудачный скан.
 */

// типов BarcodeDetector нет в стандартном lib.dom — обращаемся как к any
type AnyTrack = MediaStreamTrack & {
  getCapabilities?: () => any
  applyConstraints?: (c: any) => Promise<void>
}

let audioCtx: AudioContext | null = null
function ensureAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || (window as any).webkitAudioContext)()
    if (audioCtx.state === 'suspended') void audioCtx.resume()
  } catch {
    /* звук необязателен */
  }
}

/** Звук + вибро на скан. ok=false — короткий «низкий» сигнал + двойная вибрация. */
export function scanFeedback(ok: boolean) {
  try {
    ensureAudio()
    if (audioCtx) {
      const o = audioCtx.createOscillator()
      const g = audioCtx.createGain()
      o.connect(g)
      g.connect(audioCtx.destination)
      o.frequency.value = ok ? 880 : 220
      g.gain.value = 0.05
      o.start()
      o.stop(audioCtx.currentTime + (ok ? 0.08 : 0.18))
    }
  } catch {
    /* звук необязателен */
  }
  try {
    navigator.vibrate?.(ok ? 30 : [40, 40, 40])
  } catch {
    /* вибро необязательно */
  }
}

const PRODUCT_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'itf', 'codabar']

type CameraScannerProps = {
  /** Вызывается с распознанным штрихкодом (после дебаунса). Лукап/звук — на стороне родителя (scanFeedback). */
  onDetect: (code: string) => void
  onError?: (message: string) => void
  /** Пауза распознавания (камера остаётся включённой) — напр. пока открыт лист ввода количества. */
  paused?: boolean
  /** Плашка обратной связи поверх видео. */
  feedback?: { ok: boolean; text: string } | null
  /** Tailwind-класс соотношения сторон, по умолчанию aspect-[4/3]. */
  aspectClass?: string
  startLabel?: string
  accent?: 'amber' | 'emerald'
  /** Окно подавления повторного скана того же кода, мс. */
  debounceMs?: number
}

export function CameraScanner({
  onDetect,
  onError,
  paused = false,
  feedback = null,
  aspectClass = 'aspect-[4/3]',
  startLabel = 'Включить камеру',
  accent = 'amber',
  debounceMs = 1500,
}: CameraScannerProps) {
  const [scanning, setScanning] = useState(false)
  const [starting, setStarting] = useState(false)
  const [hasTorch, setHasTorch] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [zoom, setZoom] = useState<{ min: number; max: number; step: number; value: number } | null>(null)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const trackRef = useRef<AnyTrack | null>(null)
  const zxingControlsRef = useRef<{ stop: () => void } | null>(null)
  const loopRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stoppedRef = useRef(true)
  const lastRef = useRef<{ code: string; t: number }>({ code: '', t: 0 })

  // актуальные значения внутри замыканий цикла распознавания
  const pausedRef = useRef(paused)
  const onDetectRef = useRef(onDetect)
  useEffect(() => { pausedRef.current = paused }, [paused])
  useEffect(() => { onDetectRef.current = onDetect }, [onDetect])

  const emit = useCallback((raw: string) => {
    const code = String(raw || '').trim()
    if (!code || pausedRef.current) return
    const now = Date.now()
    if (lastRef.current.code === code && now - lastRef.current.t < debounceMs) return
    lastRef.current = { code, t: now }
    onDetectRef.current(code)
  }, [debounceMs])

  const stop = useCallback(() => {
    stoppedRef.current = true
    if (loopRef.current) { clearTimeout(loopRef.current); loopRef.current = null }
    try { zxingControlsRef.current?.stop() } catch { /* noop */ }
    zxingControlsRef.current = null
    try { streamRef.current?.getTracks().forEach((t) => t.stop()) } catch { /* noop */ }
    streamRef.current = null
    trackRef.current = null
    setTorchOn(false)
    setHasTorch(false)
    setZoom(null)
    setScanning(false)
  }, [])

  const start = useCallback(async () => {
    if (scanning || starting) return
    setStarting(true)
    ensureAudio()
    try { navigator.vibrate?.(10) } catch { /* noop */ }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      })
      streamRef.current = stream
      const video = videoRef.current
      if (!video) { stream.getTracks().forEach((t) => t.stop()); setStarting(false); return }
      video.srcObject = stream
      video.setAttribute('playsinline', 'true')
      await video.play().catch(() => {})

      const track = stream.getVideoTracks()[0] as AnyTrack
      trackRef.current = track
      // непрерывная фокусировка + параметры зума/фонарика
      const caps: any = track.getCapabilities?.() || {}
      if (caps.focusMode && Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
        try { await track.applyConstraints?.({ advanced: [{ focusMode: 'continuous' }] }) } catch { /* noop */ }
      }
      if (caps.torch) setHasTorch(true)
      if (typeof caps.zoom === 'object' && caps.zoom && 'max' in caps.zoom) {
        const z = caps.zoom
        const value = (track.getSettings?.() as any)?.zoom ?? z.min ?? 1
        setZoom({ min: Number(z.min ?? 1), max: Number(z.max ?? 1), step: Number(z.step || 0.1), value: Number(value) })
      }

      stoppedRef.current = false
      setScanning(true)
      setStarting(false)

      const Detector = (window as any).BarcodeDetector
      if (Detector) {
        let formats = PRODUCT_FORMATS
        try {
          const supported: string[] = await Detector.getSupportedFormats?.()
          if (Array.isArray(supported) && supported.length) formats = PRODUCT_FORMATS.filter((f) => supported.includes(f))
        } catch { /* возьмём все */ }
        const detector = new Detector({ formats: formats.length ? formats : PRODUCT_FORMATS })
        const tick = async () => {
          if (stoppedRef.current) return
          try {
            const found = await detector.detect(video)
            if (found && found[0]?.rawValue) emit(String(found[0].rawValue))
          } catch { /* кадр пропускаем */ }
          if (!stoppedRef.current) loopRef.current = setTimeout(() => void tick(), 140)
        }
        void tick()
      } else {
        // Фолбэк: zxing декодит из уже запущенного потока (используем наш track для зума/фонарика)
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        const reader = new BrowserMultiFormatReader()
        const controls = await reader.decodeFromStream(stream, video, (res) => {
          if (res) emit(res.getText())
        })
        zxingControlsRef.current = controls
      }
    } catch (e: any) {
      setStarting(false)
      stop()
      onError?.('Камера недоступна: ' + (e?.message || 'нет доступа'))
    }
  }, [scanning, starting, emit, onError, stop])

  // очистка при размонтировании
  useEffect(() => () => stop(), [stop])

  const toggleTorch = async () => {
    const track = trackRef.current
    if (!track) return
    try {
      await track.applyConstraints?.({ advanced: [{ torch: !torchOn }] })
      setTorchOn((v) => !v)
    } catch { /* фонарик не поддерживается */ }
  }

  const applyZoom = async (value: number) => {
    const track = trackRef.current
    if (!track) return
    setZoom((z) => (z ? { ...z, value } : z))
    try { await track.applyConstraints?.({ advanced: [{ zoom: value }] }) } catch { /* noop */ }
  }

  const accentBorder = accent === 'emerald' ? 'border-emerald-400/80' : 'border-amber-400/80'
  const accentBtn = accent === 'emerald' ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-300' : 'border-amber-400/50 bg-amber-400/10 text-amber-300'

  return (
    <div className={`relative w-full overflow-hidden border border-white/10 bg-black ${aspectClass}`}>
      <video ref={videoRef} className="h-full w-full object-cover" playsInline muted autoPlay />

      {scanning ? (
        <>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className={`h-24 w-3/4 border-2 ${accentBorder}`} />
          </div>
          <div className="absolute right-2 top-2 flex gap-2">
            {hasTorch ? (
              <button type="button" onClick={() => void toggleTorch()} aria-label="Фонарик" className={`border p-2 ${torchOn ? 'border-amber-400 text-amber-300' : 'border-white/25 text-white'}`}>
                <Flashlight className="h-4 w-4" />
              </button>
            ) : null}
            <button type="button" onClick={stop} className="border border-white/25 px-3 py-2 font-mono text-xs uppercase text-white">Стоп</button>
          </div>
          {zoom && zoom.max > zoom.min ? (
            <div className="absolute inset-x-2 bottom-2 flex items-center gap-2 bg-black/50 px-2 py-1.5">
              <ZoomIn className="h-3.5 w-3.5 text-white/70" />
              <input
                type="range"
                min={zoom.min}
                max={zoom.max}
                step={zoom.step}
                value={zoom.value}
                onChange={(e) => void applyZoom(Number(e.target.value))}
                className="h-1 w-full accent-amber-400"
                aria-label="Зум"
              />
            </div>
          ) : null}
        </>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70">
          <Camera className="h-8 w-8 text-zinc-500" />
          <button type="button" onClick={() => void start()} disabled={starting} className={`border px-5 py-2.5 font-mono text-[13px] uppercase tracking-wide disabled:opacity-50 ${accentBtn}`}>
            {starting ? 'Запуск…' : startLabel}
          </button>
        </div>
      )}

      {feedback ? (
        <div className={`pointer-events-none absolute inset-x-0 bottom-0 px-3 py-2 font-mono text-[12px] ${feedback.ok ? 'bg-emerald-500/85 text-black' : 'bg-rose-500/90 text-white'}`}>{feedback.text}</div>
      ) : null}
    </div>
  )
}
