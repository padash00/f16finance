'use client'

/**
 * Распад страницы в пыль.
 *
 * Идея та же, что в известной реализации «щелчка»: страница растеризуется, и
 * каждая крупинка берёт цвет РЕАЛЬНОГО пикселя под собой. Иначе рассыпается
 * абстрактная пыль поверх страницы, а нужно, чтобы рассыпалась сама страница.
 *
 * Дальше три решения, без которых это вешает браузер. Каждое появилось после
 * того, как предыдущая версия именно вешала.
 *
 * ПАМЯТЬ. Холсты живут в разрешении СНИМКА, а не экрана, и растягиваются
 * стилями. Два десятка холстов 1920×1080 при DPR 2 — это под гигабайт
 * видеопамяти и гарантированный фриз. В разрешении снимка те же холсты
 * занимают около тридцати мегабайт.
 *
 * ГЛАВНЫЙ ПОТОК. Крупинки не рисуются вызовами fillRect: их больше сотни
 * тысяч, и это полсекунды заморозки. Один проход раскладывает пиксели по
 * типизированным массивам, и каждый холст получает готовый putImageData.
 *
 * ОЖИДАНИЕ. Тема не ждёт анимацию никогда. Растеризация тяжёлой админки
 * занимает секунды, и если переключение ждёт снимок — человек нажимает кнопку
 * и три секунды смотрит в неизменившийся экран. Поэтому распад играет только
 * на ГОТОВОМ снимке: он делается заранее, в простое и по наведению на кнопку.
 * Снимка нет — тема переключается мгновенно и без эффекта. Это не деградация,
 * а приоритет: работающая кнопка важнее анимации.
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
 * Волны задают фронт: чем дальше крупинка от кнопки, тем позже трогается её
 * волна. Потоки задают разлёт: внутри волны крупинки раскиданы случайно, и
 * каждый поток летит по-своему. Без потоков волна уезжает единым пластом —
 * видно, что картинку двигают, а не рассыпают.
 */
const WAVES = 9
const STREAMS = 3

/** Сторона крупинки в пикселях СНИМКА. При масштабе 0.4 это ~5 px экрана. */
const GRAIN = 2

/**
 * Во сколько раз уменьшается снимок.
 *
 * 0.4 — компромисс: крупинка всё равно несколько пикселей, разглядывать в ней
 * нечего, а растеризация и память падают более чем вшестеро.
 */
const CAPTURE_SCALE = 0.35

/** Сколько снимок считается свежим. Дольше — покажем устаревшую страницу. */
const CAPTURE_TTL_MS = 8000

type Capture = { data: ImageData; width: number; height: number; takenAt: number }

let cached: Capture | null = null
let pending: Promise<Capture | null> | null = null

/**
 * Снимок видимой части страницы.
 *
 * Чужие картинки и шрифты растеризацию рушат, поэтому вызов обёрнут: при
 * неудаче вернётся null, и распад пойдёт на запасных цветах. Анимация обязана
 * деградировать, а не ломать переключение темы.
 */
async function capture(): Promise<Capture | null> {
  try {
    const { toCanvas } = await import('html-to-image')
    const width = window.innerWidth
    const height = window.innerHeight

    const canvas = await toCanvas(document.body, {
      width,
      height,
      pixelRatio: CAPTURE_SCALE,
      skipFonts: true,
      cacheBust: false,
      // Свои холсты в снимок не попадают: иначе прошлая пыль окажется в новой.
      filter: (node) => !(node instanceof HTMLElement && node.dataset.dustIgnore === 'true'),
    })

    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null

    return {
      data: context.getImageData(0, 0, canvas.width, canvas.height),
      width: canvas.width,
      height: canvas.height,
      takenAt: performance.now(),
    }
  } catch {
    return null
  }
}

/**
 * Готовит снимок заранее.
 *
 * Зовётся по наведению на кнопку темы. Нажмут — распад начнётся мгновенно;
 * пройдут мимо — снимок просто устареет.
 */
export function prewarmThemeDust(): void {
  if (typeof document === 'undefined') return
  if (pending) return
  if (cached && performance.now() - cached.takenAt < CAPTURE_TTL_MS) return

  pending = capture()
  void pending
    .then((result) => {
      cached = result
    })
    .finally(() => {
      pending = null
    })
}

/**
 * Снимок устарел: страницу прокрутили или изменили размер окна.
 *
 * Показывать пыль от чужого кадра нельзя — она не совпадёт с тем, что человек
 * видит, и это выглядит как сбой, а не как эффект.
 */
export function invalidateThemeDust(): void {
  cached = null
}

/** Есть ли готовый свежий снимок. */
export function isThemeDustReady(): boolean {
  return Boolean(cached && performance.now() - cached.takenAt < CAPTURE_TTL_MS)
}

type Layer = {
  canvas: HTMLCanvasElement
  image: ImageData
  /** Доля общей длительности, на которой слой трогается. */
  delay: number
  dx: number
  dy: number
  rotate: number
  scale: number
}

/** Запасной цвет крупинки в виде трёх компонент. */
function parseColor(value: string): [number, number, number] {
  const text = value.trim()
  if (text.startsWith('#')) {
    const full =
      text.length === 4 ? `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}` : text
    return [
      parseInt(full.slice(1, 3), 16) || 0,
      parseInt(full.slice(3, 5), 16) || 0,
      parseInt(full.slice(5, 7), 16) || 0,
    ]
  }
  const nums = text.match(/\d+/g)
  return nums ? [Number(nums[0]) || 0, Number(nums[1]) || 0, Number(nums[2]) || 0] : [148, 163, 184]
}

/**
 * Раскладывает пиксели снимка по слоям.
 *
 * Один проход по блокам, запись сразу в типизированные массивы. Это и есть
 * разница между «мгновенно» и «браузер завис».
 */
function buildLayers(shot: Capture | null, options: DustOptions): Layer[] {
  const width = shot?.width ?? Math.floor(window.innerWidth * CAPTURE_SCALE)
  const height = shot?.height ?? Math.floor(window.innerHeight * CAPTURE_SCALE)
  if (width < 2 || height < 2) return []

  // Координаты кнопки — в системе снимка.
  const originX = options.origin.x * (width / window.innerWidth)
  const originY = options.origin.y * (height / window.innerHeight)
  const maxDistance = Math.hypot(width, height)

  const total = WAVES * STREAMS
  const buffers: Uint8ClampedArray[] = []
  for (let i = 0; i < total; i++) buffers.push(new Uint8ClampedArray(width * height * 4))

  const fallback = options.fallbackColors.map(parseColor)
  const source = shot?.data.data

  for (let y = 0; y < height; y += GRAIN) {
    for (let x = 0; x < width; x += GRAIN) {
      const distance = Math.hypot(x - originX, y - originY)
      // Разброс рвёт ровную дугу фронта: без него видна граница волны.
      const position = Math.min(
        0.999,
        Math.max(0, distance / maxDistance + (Math.random() - 0.5) * 0.2),
      )
      const wave = Math.min(WAVES - 1, (position * WAVES) | 0)
      // Поток случайный: соседние крупинки должны улетать по-разному.
      const stream = (Math.random() * STREAMS) | 0
      const buffer = buffers[wave * STREAMS + stream]

      let r = 148
      let g = 163
      let b = 184
      let a = 255

      if (source) {
        const offset = (y * width + x) * 4
        a = source[offset + 3]
        // Прозрачные места страницы крупинками не становятся.
        if (a < 8) continue
        r = source[offset]
        g = source[offset + 1]
        b = source[offset + 2]
      } else {
        const color = fallback[(wave + stream) % fallback.length]
        if (color) {
          r = color[0]
          g = color[1]
          b = color[2]
        }
      }

      // Блок одним цветом: так он читается как частица, а не как кусок
      // изображения.
      for (let dy = 0; dy < GRAIN && y + dy < height; dy++) {
        let offset = ((y + dy) * width + x) * 4
        for (let dx = 0; dx < GRAIN && x + dx < width; dx++) {
          buffer[offset] = r
          buffer[offset + 1] = g
          buffer[offset + 2] = b
          buffer[offset + 3] = a
          offset += 4
        }
      }
    }
  }

  const layers: Layer[] = []
  for (let wave = 0; wave < WAVES; wave++) {
    for (let stream = 0; stream < STREAMS; stream++) {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.style.cssText = [
        'position:fixed',
        'inset:0',
        'width:100%',
        'height:100%',
        'pointer-events:none',
        'will-change:transform,opacity',
      ].join(';')

      // Разлёт вверх и вправо, как в оригинале: от кнопки идёт фронт, а не
      // ветер.
      const spread = (stream - (STREAMS - 1) / 2) / STREAMS
      layers.push({
        canvas,
        image: new ImageData(buffers[wave * STREAMS + stream], width, height),
        delay: (wave / WAVES) * 0.6,
        dx: 30 + wave * 2.4 + spread * 44,
        dy: -(42 + wave * 3) + spread * 22,
        rotate: spread * 4,
        scale: 1.03,
      })
    }
  }

  return layers
}

/**
 * Запускает распад на уже готовом снимке.
 *
 * Синхронно до вызова `onCovered`: между нажатием и подменой темы не должно
 * быть ни одного ожидания. Возвращает false, если снимка нет — тогда тема
 * просто переключается без эффекта.
 */
export function runThemeDust(options: DustOptions): boolean {
  if (typeof document === 'undefined') return false

  const shot = cached && performance.now() - cached.takenAt < CAPTURE_TTL_MS ? cached : null
  if (!shot) return false

  // Снимок одноразовый: после переключения темы он устарел.
  cached = null

  const layers = buildLayers(shot, options)
  if (layers.length === 0) return false

  const host = document.createElement('div')
  host.dataset.dustIgnore = 'true'
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000'

  for (const layer of layers) {
    const context = layer.canvas.getContext('2d')
    context?.putImageData(layer.image, 0, 0)
    host.appendChild(layer.canvas)
  }
  document.body.appendChild(host)

  // Слои вместе содержат каждый пиксель страницы, поэтому экран сейчас
  // выглядит ровно как до нажатия. Момент подменить тему.
  options.onCovered?.()

  const animations = layers.map((layer) =>
    layer.canvas.animate(
      [
        { transform: 'none', opacity: 1, offset: 0 },
        { transform: 'none', opacity: 1, offset: layer.delay },
        {
          transform: `translate3d(${layer.dx * 0.3}px, ${layer.dy * 0.3}px, 0) rotate(${layer.rotate * 0.3}deg)`,
          opacity: 0.75,
          offset: layer.delay + (1 - layer.delay) * 0.45,
        },
        {
          // Ускорение и лёгкая усадка к концу: крупинка не уезжает, а тает.
          transform: `translate3d(${layer.dx}px, ${layer.dy}px, 0) rotate(${layer.rotate}deg) scale(${layer.scale})`,
          opacity: 0,
          offset: 1,
        },
      ],
      {
        duration: options.duration,
        easing: 'cubic-bezier(0.35, 0, 0.35, 1)',
        fill: 'forwards',
      },
    ),
  )

  Promise.all(animations.map((a) => a.finished))
    .catch(() => {
      /* анимацию прервали — важно только убрать холсты */
    })
    .finally(() => {
      host.remove()
      // Следующий распад пойдёт уже по новой теме.
      prewarmThemeDust()
    })

  return true
}

/** Запасная палитра, если снимок сделать не удалось. */
export function dustColorsOf(theme: 'light' | 'dark'): string[] {
  const styles = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback

  return theme === 'light'
    ? [read('--foreground', '#0f2038'), read('--muted-foreground', '#64748b'), '#94a3b8', '#cbd5e1']
    : [read('--foreground', '#f4f7fb'), read('--muted-foreground', '#93a4bb'), '#64748b', '#334155']
}
