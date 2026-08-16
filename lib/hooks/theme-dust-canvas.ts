'use client'

/**
 * Распад страницы в пыль.
 *
 * Устроено так же, как в известной реализации «щелчка»: страница
 * растеризуется, и каждая крупинка берёт цвет РЕАЛЬНОГО пикселя под собой.
 * Без этого рассыпается абстрактная пыль, а нужно, чтобы рассыпалась сама
 * страница — разница видна сразу.
 *
 * Производительность решается двумя приёмами.
 *
 * Первый: снимок делается в половинном разрешении. Крупинка всё равно 3–4
 * пикселя, разглядывать в ней нечего, а растеризация ускоряется вчетверо.
 *
 * Второй: крупинки не двигаются по отдельности в JS. Они разложены по
 * нескольким десяткам холстов, и каждый холст целиком уносит CSS-анимация.
 * Пятьдесят тысяч частиц покадрово не нарисовать, а тридцать слоёв браузер
 * тянет на композиторе.
 *
 * Порядок слоёв задаёт фронт: чем дальше крупинка от кнопки, тем позже
 * оторвётся. Именно это и читается как распад, а не как общее растворение.
 */

export type DustOptions = {
  /** Откуда начинается распад — центр кнопки. */
  origin: { x: number; y: number }
  /** Сколько длится всё целиком, мс. */
  duration: number
  /** Запасные цвета, если снимок сделать не удалось. */
  fallbackColors: string[]
  /** Экран закрыт копией страницы — можно менять тему под ней. */
  onCovered?: () => void
}

/** Слоёв распада. Больше — плавнее фронт и больше элементов в DOM. */
const LAYERS = 26

/** Сторона крупинки в пикселях экрана. */
const GRAIN = 4

/** Во сколько раз уменьшается снимок. Половина — незаметно и вчетверо быстрее. */
const CAPTURE_SCALE = 0.5

/**
 * Снимок видимой части страницы.
 *
 * Чужие картинки (аватары, логотипы с другого домена) растеризацию рушат,
 * поэтому весь вызов обёрнут и при неудаче возвращает null: анимация должна
 * деградировать, а не ломать переключение темы.
 */
async function capture(width: number, height: number): Promise<ImageData | null> {
  try {
    const { toCanvas } = await import('html-to-image')
    const canvas = await toCanvas(document.body, {
      width,
      height,
      pixelRatio: CAPTURE_SCALE,
      // Внешние ресурсы пропускаем: один недоступный логотип не должен
      // отменять весь эффект.
      skipFonts: true,
      filter: (node) => !(node instanceof HTMLElement && node.dataset.dustIgnore === 'true'),
    })
    const context = canvas.getContext('2d')
    if (!context) return null
    return context.getImageData(0, 0, canvas.width, canvas.height)
  } catch {
    return null
  }
}

type Layer = {
  canvas: HTMLCanvasElement
  /** Доля общей длительности, на которой слой начинает уноситься. */
  delay: number
  dx: number
  dy: number
}

/**
 * Раскладывает пиксели по слоям.
 *
 * Номер слоя = расстояние до кнопки плюс разброс. Разброс обязателен: без него
 * граница между слоями видна как ровная дуга, и вместо осыпания получается
 * расходящаяся волна.
 */
function buildLayers(
  image: ImageData | null,
  width: number,
  height: number,
  options: DustOptions,
): Layer[] {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const maxDistance = Math.hypot(width, height)

  const layers: Layer[] = []
  const contexts: CanvasRenderingContext2D[] = []

  for (let i = 0; i < LAYERS; i++) {
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(width * dpr)
    canvas.height = Math.floor(height * dpr)
    canvas.style.cssText = [
      'position:fixed',
      'inset:0',
      'width:100%',
      'height:100%',
      'pointer-events:none',
      'will-change:transform,opacity,filter',
    ].join(';')

    const context = canvas.getContext('2d')
    if (!context) continue
    context.scale(dpr, dpr)
    contexts.push(context)

    // Разлёт прочь от кнопки и вверх: пыль не падает, её уносит.
    const angle = Math.atan2(height / 2 - options.origin.y, width / 2 - options.origin.x)
    layers.push({
      canvas,
      delay: 0,
      dx: Math.cos(angle) * (30 + i * 3) + 40,
      dy: Math.sin(angle) * (14 + i * 1.5) - (60 + i * 4),
    })
  }

  if (layers.length === 0) return []

  for (let x = 0; x < width; x += GRAIN) {
    for (let y = 0; y < height; y += GRAIN) {
      const distance = Math.hypot(x - options.origin.x, y - options.origin.y)
      const jitter = (Math.random() - 0.5) * 0.22
      const position = Math.min(0.999, Math.max(0, distance / maxDistance + jitter))
      const index = Math.min(layers.length - 1, Math.floor(position * layers.length))

      let color: string
      if (image) {
        // Снимок уменьшен, поэтому координаты пересчитываются.
        const sx = Math.floor(x * CAPTURE_SCALE)
        const sy = Math.floor(y * CAPTURE_SCALE)
        const offset = (sy * image.width + sx) * 4
        const alpha = image.data[offset + 3]
        // Прозрачные места страницы крупинками не становятся.
        if (alpha < 8) continue
        color = `rgb(${image.data[offset]},${image.data[offset + 1]},${image.data[offset + 2]})`
      } else {
        color = options.fallbackColors[index % options.fallbackColors.length]
      }

      const context = contexts[index]
      context.fillStyle = color
      context.fillRect(x, y, GRAIN, GRAIN)
    }
  }

  // Задержка по порядку слоя: первый — у кнопки, последний — в дальнем углу.
  layers.forEach((layer, i) => {
    layer.delay = (i / layers.length) * 0.55
  })

  return layers
}

/**
 * Запускает распад и возвращает обещание, которое исполняется по окончании.
 *
 * Холсты живут только на время анимации: постоянные элементы поверх портала
 * ловили бы клики и мешали бы, даже прозрачные.
 */
export async function runThemeDust(options: DustOptions): Promise<void> {
  if (typeof document === 'undefined') return

  const width = window.innerWidth
  const height = window.innerHeight

  const image = await capture(width, height)
  const layers = buildLayers(image, width, height, options)
  if (layers.length === 0) return

  const host = document.createElement('div')
  host.dataset.dustIgnore = 'true'
  host.style.cssText = [
    'position:fixed',
    'inset:0',
    'pointer-events:none',
    // Выше снимков перехода: крупинки летят над страницей.
    'z-index:2147483000',
  ].join(';')

  for (const layer of layers) host.appendChild(layer.canvas)
  document.body.appendChild(host)

  // Слои вместе содержат каждый пиксель страницы, поэтому экран сейчас
  // выглядит ровно как до нажатия. Момент подменить тему.
  options.onCovered?.()

  const animations = layers.map((layer) =>
    layer.canvas.animate(
      [
        { transform: 'translate3d(0,0,0) scale(1)', opacity: 1, filter: 'blur(0px)', offset: 0 },
        { transform: 'translate3d(0,0,0) scale(1)', opacity: 1, filter: 'blur(0px)', offset: layer.delay },
        {
          // Усадка и ускорение к концу — крупинка не просто уезжает, а тает.
          transform: `translate3d(${layer.dx}px, ${layer.dy}px, 0) scale(1.04)`,
          opacity: 0,
          filter: 'blur(3px)',
          offset: 1,
        },
      ],
      {
        duration: options.duration,
        easing: 'cubic-bezier(0.3, 0, 0.5, 1)',
        fill: 'forwards',
      },
    ),
  )

  try {
    await Promise.all(animations.map((a) => a.finished))
  } catch {
    /* анимацию прервали — важно только убрать холсты */
  } finally {
    host.remove()
  }
}

/** Запасная палитра, если снимок сделать не удалось. */
export function dustColorsOf(theme: 'light' | 'dark'): string[] {
  const styles = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback

  return theme === 'light'
    ? [read('--foreground', '#0f2038'), read('--muted-foreground', '#64748b'), '#94a3b8', '#cbd5e1']
    : [read('--foreground', '#f4f7fb'), read('--muted-foreground', '#93a4bb'), '#64748b', '#334155']
}
