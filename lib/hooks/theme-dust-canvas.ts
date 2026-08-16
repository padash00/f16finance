'use client'

/**
 * Крупинки для распада темы.
 *
 * Здесь только пыль. Сама страница уходит снимком, который бесплатно даёт
 * браузер (View Transitions) — этим занимается CSS.
 *
 * Почему не берутся настоящие пиксели страницы. Чтобы крупинка знала цвет
 * пикселя под собой, страницу нужно растеризовать. Единственный способ сделать
 * это в браузере — обойти весь DOM, вписать в каждый узел вычисленные стили и
 * отрисовать всё как SVG. На админке это многосекундная блокировка главного
 * потока: портал замирает целиком, кнопки не нажимаются. Красивая пыль такой
 * цены не стоит, поэтому крупинки берут цвет уходящей ТЕМЫ.
 *
 * Слоёв намеренно мало. Каждый слой — это полноэкранная текстура в
 * композиторе: два десятка слоёв на FullHD дают под двести мегабайт и
 * подвисание на каждом кадре. Восемь браузер тянет спокойно.
 */

export type DustOptions = {
  /** Откуда расходится фронт — центр кнопки. */
  origin: { x: number; y: number }
  /** Сколько длится всё целиком, мс. */
  duration: number
  /** Цвета уходящей темы. */
  colors: string[]
}

/**
 * Волны задают фронт: чем дальше крупинка от кнопки, тем позже трогается её
 * волна. Потоки задают разлёт: внутри волны крупинки раскиданы случайно, и
 * каждый поток летит по-своему. Без потоков волна уезжает единым пластом.
 */
const WAVES = 4
const STREAMS = 2

/** Шаг сетки крупинок в пикселях экрана. */
const STEP = 11

/** Во сколько раз холст меньше экрана. Крупинке хватает и трети. */
const SCALE = 1 / 3

/**
 * Рисует пыль и уносит её.
 *
 * Возвращает обещание, которое исполняется по окончании. Всё до первого кадра
 * делается синхронно и быстро: между нажатием и стартом анимации ожиданий нет.
 */
export function runThemeDust(options: DustOptions): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve()

  const width = window.innerWidth
  const height = window.innerHeight
  const maxDistance = Math.hypot(width, height)

  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000'

  const total = WAVES * STREAMS
  const canvases: HTMLCanvasElement[] = []
  const contexts: CanvasRenderingContext2D[] = []

  for (let i = 0; i < total; i++) {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(2, Math.floor(width * SCALE))
    canvas.height = Math.max(2, Math.floor(height * SCALE))
    canvas.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;will-change:transform,opacity'

    const context = canvas.getContext('2d')
    if (!context) continue
    context.scale(SCALE, SCALE)
    canvases.push(canvas)
    contexts.push(context)
  }

  if (contexts.length === 0) return Promise.resolve()

  // Одна сетка на весь экран: каждая клетка достаётся какой-то волне и
  // какому-то потоку. Плотнее у фронта, реже вдали — так пыль выглядит
  // сорванной, а не насыпанной.
  for (let y = 0; y < height; y += STEP) {
    for (let x = 0; x < width; x += STEP) {
      const distance = Math.hypot(x - options.origin.x, y - options.origin.y)
      const position = Math.min(
        0.999,
        Math.max(0, distance / maxDistance + (Math.random() - 0.5) * 0.24),
      )
      const wave = Math.min(WAVES - 1, (position * WAVES) | 0)
      const stream = (Math.random() * STREAMS) | 0
      const context = contexts[wave * STREAMS + stream]
      if (!context) continue

      const size = 1.5 + Math.random() * 3
      context.globalAlpha = 0.25 + Math.random() * 0.55
      context.fillStyle = options.colors[(Math.random() * options.colors.length) | 0] || '#94a3b8'
      context.fillRect(
        x + (Math.random() - 0.5) * STEP,
        y + (Math.random() - 0.5) * STEP,
        size,
        size,
      )
    }
  }

  for (const canvas of canvases) host.appendChild(canvas)
  document.body.appendChild(host)

  const animations = canvases.map((canvas, i) => {
    const wave = Math.floor(i / STREAMS)
    const stream = i % STREAMS
    const spread = (stream - (STREAMS - 1) / 2) / STREAMS
    const delay = (wave / WAVES) * 0.5

    // Разлёт вверх и вправо, как в оригинале: от кнопки идёт фронт, а не ветер.
    const dx = 26 + wave * 6 + spread * 40
    const dy = -(34 + wave * 8) + spread * 18

    return canvas.animate(
      [
        { transform: 'none', opacity: 0, offset: 0 },
        { transform: 'none', opacity: 1, offset: Math.min(0.95, delay + 0.04) },
        {
          transform: `translate3d(${dx * 0.3}px, ${dy * 0.3}px, 0)`,
          opacity: 0.85,
          offset: delay + (1 - delay) * 0.45,
        },
        {
          // Ускорение к концу: крупинка не уезжает, а тает.
          transform: `translate3d(${dx}px, ${dy}px, 0) scale(1.04)`,
          opacity: 0,
          offset: 1,
        },
      ],
      { duration: options.duration, easing: 'cubic-bezier(0.35, 0, 0.35, 1)', fill: 'forwards' },
    )
  })

  return Promise.all(animations.map((a) => a.finished))
    .catch(() => {
      /* анимацию прервали — важно только убрать холсты */
    })
    .then(() => {
      host.remove()
    })
}

/** Палитра крупинок уходящей темы. */
export function dustColorsOf(theme: 'light' | 'dark'): string[] {
  const styles = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback

  return theme === 'light'
    ? [read('--foreground', '#0f2038'), read('--muted-foreground', '#64748b'), '#94a3b8', '#cbd5e1']
    : [read('--foreground', '#f4f7fb'), read('--muted-foreground', '#93a4bb'), '#64748b', '#334155']
}
