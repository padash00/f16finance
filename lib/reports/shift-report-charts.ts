/**
 * Графики для отчёта: SVG без единой библиотеки.
 *
 * Рисуются вручную по трём причинам. Первая — SVG одинаково ложится и в PDF, и
 * в картинку для Excel. Вторая — график обязан говорить то же, что таблица, а
 * чужая библиотека норовит сгладить, дорисовать или подписать по-своему.
 * Третья — здесь чистые функции, их видно в тестах.
 *
 * Правило: чего нет в данных, того нет и на графике. Пропуск рисуется
 * разрывом, а не нулём — иначе день без продаж выглядел бы как провал.
 */

const W = 900
const H = 300
const PAD = { top: 28, right: 20, bottom: 42, left: 74 }

const INK = '#0f2038'
const MUTED = '#94a3b8'
const GRID = '#e2e8f0'
const GREEN = '#16a34a'
const BLUE = '#3b82f6'
const AMBER = '#f59e0b'

const esc = (s: string) =>
  String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string)

const nf = (v: number) => Math.round(v).toLocaleString('ru-RU')

function frame(title: string, subtitle: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter, 'Segoe UI', system-ui, sans-serif">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <text x="${PAD.left}" y="18" font-size="13" font-weight="700" fill="${INK}">${esc(title)}</text>
  <text x="${W - PAD.right}" y="18" font-size="10" fill="${MUTED}" text-anchor="end">${esc(subtitle)}</text>
  ${body}
</svg>`
}

function axes(maxValue: number, labels: string[]): { body: string; y: (v: number) => number; x: (i: number) => number } {
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const top = maxValue > 0 ? maxValue * 1.1 : 1

  const y = (v: number) => PAD.top + plotH - (v / top) * plotH
  const x = (i: number) =>
    labels.length <= 1 ? PAD.left + plotW / 2 : PAD.left + (i / (labels.length - 1)) * plotW

  const lines = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const value = top * f
      return `<line x1="${PAD.left}" y1="${y(value)}" x2="${W - PAD.right}" y2="${y(value)}" stroke="${GRID}" stroke-width="1"/>
      <text x="${PAD.left - 8}" y="${y(value) + 3}" font-size="9" fill="${MUTED}" text-anchor="end">${nf(value)}</text>`
    })
    .join('')

  // Подписей по оси столько, сколько влезает: 30 дат подряд сливаются в кашу.
  const step = Math.max(1, Math.ceil(labels.length / 12))
  const ticks = labels
    .map((label, i) =>
      i % step === 0
        ? `<text x="${x(i)}" y="${H - PAD.bottom + 16}" font-size="9" fill="${MUTED}" text-anchor="middle">${esc(label)}</text>`
        : '',
    )
    .join('')

  return { body: lines + ticks, y, x }
}

function legend(items: { label: string; color: string }[]): string {
  let offset = PAD.left
  return items
    .map((item) => {
      const block = `<rect x="${offset}" y="${H - 16}" width="10" height="10" rx="2" fill="${item.color}"/>
      <text x="${offset + 15}" y="${H - 7}" font-size="10" fill="${INK}">${esc(item.label)}</text>`
      offset += 22 + item.label.length * 6
      return block
    })
    .join('')
}

/** Ломаная с разрывами там, где данных нет. */
function polyline(values: (number | null)[], x: (i: number) => number, y: (v: number) => number, color: string, dashed = false): string {
  const segments: string[] = []
  let current: string[] = []

  values.forEach((v, i) => {
    if (v == null) {
      if (current.length > 1) segments.push(current.join(' '))
      current = []
      return
    }
    current.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`)
  })
  if (current.length > 1) segments.push(current.join(' '))

  return segments
    .map(
      (points) =>
        `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${
          dashed ? ' stroke-dasharray="5 4"' : ''
        }/>`,
    )
    .join('')
}

export type SeriesPoint = { label: string; actual: number | null; expected: number | null }

/** Факт против нормы: сплошная — было, пунктир — обычно бывает. */
export function lineChartSvg(args: {
  title: string
  subtitle: string
  points: SeriesPoint[]
  actualLabel: string
  expectedLabel: string
}): string {
  const { points } = args
  if (points.length === 0) {
    return frame(args.title, args.subtitle, `<text x="${W / 2}" y="${H / 2}" font-size="12" fill="${MUTED}" text-anchor="middle">Данных за период нет</text>`)
  }

  const all = points.flatMap((p) => [p.actual, p.expected]).filter((v): v is number => v != null)
  const max = all.length ? Math.max(...all) : 0
  const { body, x, y } = axes(max, points.map((p) => p.label))

  return frame(
    args.title,
    args.subtitle,
    body +
      polyline(points.map((p) => p.expected), x, y, MUTED, true) +
      polyline(points.map((p) => p.actual), x, y, GREEN) +
      points
        .map((p, i) =>
          p.actual == null
            ? ''
            : `<circle cx="${x(i).toFixed(1)}" cy="${y(p.actual).toFixed(1)}" r="2.5" fill="${GREEN}"/>`,
        )
        .join('') +
      legend([
        { label: args.actualLabel, color: GREEN },
        { label: args.expectedLabel, color: MUTED },
      ]),
  )
}

export type BarPoint = { label: string; value: number; tone?: 'good' | 'warn' | 'mut' }

/** Столбики: сравнение продавцов или вердиктов. */
export function barChartSvg(args: { title: string; subtitle: string; bars: BarPoint[]; unit?: string }): string {
  const { bars } = args
  if (bars.length === 0) {
    return frame(args.title, args.subtitle, `<text x="${W / 2}" y="${H / 2}" font-size="12" fill="${MUTED}" text-anchor="middle">Данных за период нет</text>`)
  }

  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const max = Math.max(...bars.map((b) => b.value), 0)
  const top = max > 0 ? max * 1.15 : 1
  const slot = plotW / bars.length
  const width = Math.min(64, slot * 0.6)

  const grid = [0, 0.5, 1]
    .map((f) => {
      const value = top * f
      const yy = PAD.top + plotH - (value / top) * plotH
      return `<line x1="${PAD.left}" y1="${yy}" x2="${W - PAD.right}" y2="${yy}" stroke="${GRID}" stroke-width="1"/>
      <text x="${PAD.left - 8}" y="${yy + 3}" font-size="9" fill="${MUTED}" text-anchor="end">${nf(value)}</text>`
    })
    .join('')

  const columns = bars
    .map((b, i) => {
      const height = Math.max(1, (b.value / top) * plotH)
      const cx = PAD.left + slot * i + slot / 2
      const color = b.tone === 'good' ? GREEN : b.tone === 'warn' ? AMBER : BLUE
      return `<rect x="${(cx - width / 2).toFixed(1)}" y="${(PAD.top + plotH - height).toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" rx="3" fill="${color}"/>
      <text x="${cx.toFixed(1)}" y="${(PAD.top + plotH - height - 5).toFixed(1)}" font-size="10" font-weight="600" fill="${INK}" text-anchor="middle">${nf(b.value)}${args.unit || ''}</text>
      <text x="${cx.toFixed(1)}" y="${H - PAD.bottom + 16}" font-size="9" fill="${MUTED}" text-anchor="middle">${esc(b.label)}</text>`
    })
    .join('')

  return frame(args.title, args.subtitle, grid + columns)
}

/**
 * Страница-обёртка для снятия картинок.
 *
 * Все графики кладутся на один лист друг под другом, чтобы снять их одним
 * запуском браузера, а не поднимать его на каждый.
 */
export function chartsPageHtml(charts: string[]): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<style>*{margin:0;padding:0}body{background:#fff}.c{width:${W}px;height:${H}px}</style>
</head><body>${charts.map((svg) => `<div class="c">${svg}</div>`).join('')}</body></html>`
}

export const CHART_SIZE = { width: W, height: H }
