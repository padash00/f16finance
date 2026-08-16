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

/**
 * Слои устроены двумя измерениями, и это главное решение здесь.
 *
 * Волны задают ФРОНТ: чем дальше крупинка от кнопки, тем позже её волна
 * трогается. Потоки задают РАЗЛЁТ: внутри одной волны крупинки случайно
 * раскиданы по нескольким потокам, и каждый летит по-своему.
 *
 * Без потоков волна улетает единым пластом — видно, что это сдвигают
 * картинку, а не рассыпают. Разложить пиксели по потокам случайно стоит
 * ничего, а выглядит как облако.
 */
const WAVES = 12
const STREAMS = 4

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
  rotate: number
  scale: number
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
  const contexts: (CanvasRenderingContext2D | null)[] = []

  for (let wave = 0; wave < WAVES; wave++) {
    for (let stream = 0; stream < STREAMS; stream++) {
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
      contexts.push(context)
      if (context) context.scale(dpr, dpr)

      // Разлёт вверх и вправо — как в оригинале. Направление не зависит от
      // того, где кнопка: от неё идёт фронт, а не ветер.
      const spread = (stream - (STREAMS - 1) / 2) / STREAMS
      layers.push({
        canvas,
        delay: (wave / WAVES) * 0.62,
        dx: 34 + wave * 2.2 + spread * 46 + Math.random() * 18,
        dy: -(46 + wave * 2.6) + spread * 26 - Math.random() * 22,
        rotate: spread * 5 + (Math.random() - 0.5) * 3,
        scale: 1.02 + Math.random() * 0.05,
      })
    }
  }

  if (layers.length === 0) return []

  for (let x = 0; x < width; x += GRAIN) {
    for (let y = 0; y < height; y += GRAIN) {
      const distance = Math.hypot(x - options.origin.x, y - options.origin.y)
      // Разброс по волне рвёт ровную дугу фронта: без него видно границу.
      const jitter = (Math.random() - 0.5) * 0.2
      const position = Math.min(0.999, Math.max(0, distance / maxDistance + jitter))
      const wave = Math.min(WAVES - 1, Math.floor(position * WAVES))
      // Поток — случайно: соседние крупинки должны улетать по-разному.
      const stream = Math.floor(Math.random() * STREAMS)

      let color: string
      if (image) {
        // Снимок уменьшен, поэтому координаты пересчитываются.
        const sx = Math.floor(x * CAPTURE_SCALE)
        const sy = Math.floor(y * CAPTURE_SCALE)
        const offset = (sy * image.width + sx) * 4
        // Прозрачные места страницы крупинками не становятся.
        if (image.data[offset + 3] < 8) continue
        color = `rgb(${image.data[offset]},${image.data[offset + 1]},${image.data[offset + 2]})`
      } else {
        color = options.fallbackColors[(wave + stream) % options.fallbackColors.length]
      }

      const context = contexts[wave * STREAMS + stream]
      if (!context) continue
      context.fillStyle = color
      // Смещение на пиксель-другой: ровная сетка читается как решётка.
      context.fillRect(x + (Math.random() - 0.5) * 2, y + (Math.random() - 0.5) * 2, GRAIN, GRAIN)
    }
  }

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
        { transform: 'none', opacity: 1, filter: 'blur(0px)', offset: 0 },
        { transform: 'none', opacity: 1, filter: 'blur(0px)', offset: layer.delay },
        {
          // Середина пути: крупинки уже оторвались, но ещё различимы.
          transform: `translate3d(${layer.dx * 0.32}px, ${layer.dy * 0.32}px, 0) rotate(${layer.rotate * 0.35}deg) scale(${1 + (layer.scale - 1) * 0.4})`,
          opacity: 0.72,
          filter: 'blur(0.6px)',
          offset: layer.delay + (1 - layer.delay) * 0.45,
        },
        {
          // Ускорение и лёгкая усадка к концу — крупинка не уезжает, а тает.
          transform: `translate3d(${layer.dx}px, ${layer.dy}px, 0) rotate(${layer.rotate}deg) scale(${layer.scale})`,
          opacity: 0,
          filter: 'blur(3px)',
          offset: 1,
        },
      ],
      {
        duration: options.duration,
        // Медленно отходит, потом уносит — так в оригинале и так это читается
        // как распад, а не как отъезд.
        easing: 'cubic-bezier(0.35, 0, 0.35, 1)',
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
