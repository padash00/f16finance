'use client'

/**
 * Частицы распада темы.
 *
 * Почему холст, а не CSS. Маской можно сделать скол — область просто перестаёт
 * существовать. Но в кино видно сами крупинки: они отрываются, летят и гаснут.
 * Маска этого не даёт никогда, сколько её ни настраивай.
 *
 * Пиксели страницы нам недоступны: View Transitions отдают снимок, но не его
 * содержимое, а растеризовать всю админку на каждое переключение — это
 * полсекунды тормозов и риск сломаться на чужих картинках. Поэтому крупинки
 * берут не цвет пикселя под собой, а цвет темы: тёмные на светлой, светлые на
 * тёмной. Глаз читает это как ту же самую пыль.
 *
 * Фронт идёт от угла, где кнопка: клетка отрывается тем позже, чем дальше она
 * от него. Именно это и создаёт ощущение постепенного распада, а не общего
 * растворения.
 */

export type DustOptions = {
  /** Откуда начинается распад — центр кнопки. */
  origin: { x: number; y: number }
  /** Сколько длится всё целиком, мс. */
  duration: number
  /** Цвет крупинок: берётся у темы, которая рассыпается. */
  colors: string[]
}

type Particle = {
  x: number
  y: number
  size: number
  /** Доля общей длительности, на которой крупинка отрывается. */
  delay: number
  /** Сколько живёт после отрыва, в долях длительности. */
  life: number
  vx: number
  vy: number
  rotation: number
  color: string
}

/** Шаг сетки. Мельче — красивее и тяжелее; 18px держит ~3000 крупинок на FullHD. */
const CELL = 18

/** Доля клеток, которые вообще становятся крупинками. */
const DENSITY = 0.55

/**
 * Раскладывает экран на крупинки.
 *
 * Задержка считается от расстояния до угла, а не от координаты: иначе фронт
 * идёт ровной линией и выглядит как шторка, а не как осыпание.
 */
function buildParticles(width: number, height: number, options: DustOptions): Particle[] {
  const particles: Particle[] = []
  const maxDistance = Math.hypot(width, height)

  for (let x = 0; x < width; x += CELL) {
    for (let y = 0; y < height; y += CELL) {
      if (Math.random() > DENSITY) continue

      const distance = Math.hypot(x - options.origin.x, y - options.origin.y)
      // Разброс по задержке ломает ровный край фронта: без него видно линию.
      const jitter = (Math.random() - 0.5) * 0.12
      const delay = Math.min(0.72, Math.max(0, (distance / maxDistance) * 0.62 + jitter))

      // Направление разлёта — прочь от угла, куда указывает фронт, плюс
      // подъём: пыль не падает, её уносит.
      const angle = Math.atan2(y - options.origin.y, x - options.origin.x)
      const speed = 26 + Math.random() * 46

      particles.push({
        x,
        y,
        size: CELL * (0.45 + Math.random() * 0.5),
        delay,
        life: 0.28 + Math.random() * 0.22,
        vx: Math.cos(angle) * speed * 0.35 + (Math.random() - 0.5) * 14,
        vy: Math.sin(angle) * speed * 0.2 - (34 + Math.random() * 40),
        rotation: (Math.random() - 0.5) * 1.4,
        color: options.colors[Math.floor(Math.random() * options.colors.length)] || '#94a3b8',
      })
    }
  }

  return particles
}

/**
 * Запускает распад и возвращает обещание, которое исполняется по окончании.
 *
 * Холст живёт только на время анимации: постоянный элемент поверх портала
 * ловил бы клики и мешал бы, даже прозрачный.
 */
export function runThemeDust(options: DustOptions): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve()

  const width = window.innerWidth
  const height = window.innerHeight

  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(width * Math.min(2, window.devicePixelRatio || 1))
  canvas.height = Math.floor(height * Math.min(2, window.devicePixelRatio || 1))
  canvas.style.cssText = [
    'position:fixed',
    'inset:0',
    'width:100%',
    'height:100%',
    'pointer-events:none',
    // Выше снимков перехода: крупинки должны лететь над страницей.
    'z-index:2147483000',
  ].join(';')

  const context = canvas.getContext('2d')
  if (!context) return Promise.resolve()

  const scale = canvas.width / width
  context.scale(scale, scale)

  const particles = buildParticles(width, height, options)
  document.body.appendChild(canvas)

  return new Promise<void>((resolve) => {
    const started = performance.now()

    const frame = (now: number) => {
      const progress = (now - started) / options.duration
      context.clearRect(0, 0, width, height)

      if (progress >= 1) {
        canvas.remove()
        resolve()
        return
      }

      for (const p of particles) {
        const own = (progress - p.delay) / p.life
        // Ещё не оторвалась или уже погасла.
        if (own <= 0 || own >= 1) continue

        // Ускорение к концу: сначала крупинка отходит нехотя, потом её уносит.
        const eased = own * own
        const alpha = 1 - own

        context.save()
        context.globalAlpha = alpha * 0.85
        context.fillStyle = p.color
        context.translate(p.x + p.vx * eased, p.y + p.vy * eased)
        context.rotate(p.rotation * own)
        context.fillRect(-p.size / 2, -p.size / 2, p.size, p.size)
        context.restore()
      }

      requestAnimationFrame(frame)
    }

    requestAnimationFrame(frame)
  })
}

/** Палитра крупинок текущей темы: цвет текста и приглушённый. */
export function dustColorsOf(theme: 'light' | 'dark'): string[] {
  const styles = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback

  return theme === 'light'
    ? [read('--foreground', '#0f2038'), read('--muted-foreground', '#64748b'), '#94a3b8', '#cbd5e1']
    : [read('--foreground', '#f4f7fb'), read('--muted-foreground', '#93a4bb'), '#64748b', '#334155']
}
