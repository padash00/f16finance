/**
 * Знак Orda Point для веба: четыре сегмента и точка в центре.
 *
 * Смысл знака — «все процессы сходятся в одну точку»: четыре внешних дуги
 * приходят с разных сторон и собираются вокруг центра.
 *
 * Это перенос `OrdaPointSymbol` из приложения (`apple/OrdaUI/Sources/OrdaUI/
 * Brand/OrdaPointSymbol.swift`), и числа здесь те же самые. Держать их в двух
 * местах приходится — SwiftUI и SVG не поделишь, — но расходиться они не
 * должны: знак на сайте и в телефоне это один знак, а не два похожих. Меняете
 * здесь — меняйте и там.
 */

/** Геометрия в долях от стороны — знак масштабируется целиком. */
const RING_RADIUS = 0.4
const RING_WIDTH = 0.17
const POINT_RADIUS = 0.1
/**
 * Просвет между сегментами. Геометрический шире видимого: закруглённые концы
 * выступают примерно на половину толщины кольца с каждой стороны. Со слишком
 * широким знак распадается на четыре запятые вместо кольца с прорезями.
 */
const GAP_DEGREES = 37

/** Мята и глубокая мята — те же, что в `Theme.brandMint` / `brandDeep`. */
const BRAND_MINT = '#20C997'
const BRAND_DEEP = '#0F7F6E'

/**
 * Четыре сегмента по диагоналям: просветы приходятся на 12, 3, 6 и 9 часов —
 * так знак читается как прицел, а не как разорванное кольцо.
 */
const ARC_CENTERS = [315, 45, 135, 225]

/** Точка на окружности. Угол — как в SwiftUI: 0 вправо, по часовой. */
function pointOnCircle(angleDegrees: number, radius: number) {
  const radians = (angleDegrees * Math.PI) / 180
  return {
    x: 0.5 + Math.cos(radians) * radius,
    y: 0.5 + Math.sin(radians) * radius,
  }
}

function arcPath(centerDegrees: number, spanDegrees: number) {
  const start = pointOnCircle(centerDegrees - spanDegrees / 2, RING_RADIUS)
  const end = pointOnCircle(centerDegrees + spanDegrees / 2, RING_RADIUS)
  const largeArc = spanDegrees > 180 ? 1 : 0
  return `M ${start.x} ${start.y} A ${RING_RADIUS} ${RING_RADIUS} 0 ${largeArc} 1 ${end.x} ${end.y}`
}

export function OrdaPointSymbol({
  size = 56,
  className,
  title = 'Orda Point',
  tone = 'brand',
}: {
  size?: number
  className?: string
  /** Пустая строка — знак декоративный, читалка его пропустит. */
  title?: string
  /**
   * `brand` — фирменный градиент. `mono` — одним цветом по `currentColor`,
   * для мест, где знак стоит на цветной подложке или рядом с текстом. То же
   * разделение, что у `Palette` в приложении.
   */
  tone?: 'brand' | 'mono'
}) {
  const span = 90 - GAP_DEGREES
  const mono = tone === 'mono'

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1 1"
      className={className}
      role={title ? 'img' : 'presentation'}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        {/* Верхние сегменты светлее нижних: знак получает объём, оставаясь
            плоским — так он одинаков на светлом и на тёмном. */}
        <linearGradient id="orda-arc-light" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={BRAND_MINT} />
          <stop offset="1" stopColor={BRAND_MINT} stopOpacity="0.86" />
        </linearGradient>
        <linearGradient id="orda-arc-deep" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={BRAND_MINT} stopOpacity="0.92" />
          <stop offset="1" stopColor={BRAND_DEEP} />
        </linearGradient>
        <linearGradient id="orda-point" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={BRAND_MINT} />
          <stop offset="1" stopColor={BRAND_DEEP} />
        </linearGradient>
      </defs>

      {ARC_CENTERS.map((center, index) => (
        <path
          key={center}
          d={arcPath(center, span)}
          fill="none"
          stroke={mono ? 'currentColor' : index < 2 ? 'url(#orda-arc-light)' : 'url(#orda-arc-deep)'}
          strokeWidth={RING_WIDTH}
          strokeLinecap="round"
        />
      ))}

      <circle cx="0.5" cy="0.5" r={POINT_RADIUS} fill={mono ? 'currentColor' : 'url(#orda-point)'} />
    </svg>
  )
}

/**
 * Знак с названием.
 *
 * Расстояние между ними — не на глаз: `min(max(размер × 0.12, 12), 20)`, то же
 * правило, что у `OrdaPointLockup.spacing(for:)` в приложении. Без общего
 * правила знак и надпись разъезжаются каждый по-своему на каждом экране.
 */
export function OrdaPointLockup({
  size = 56,
  className,
  subtitle,
}: {
  size?: number
  className?: string
  subtitle?: string
}) {
  const gap = Math.min(Math.max(size * 0.12, 12), 20)

  return (
    <div className={className} style={{ display: 'flex', alignItems: 'center', gap }}>
      <OrdaPointSymbol size={size} title="" />
      <div>
        <div style={{ fontSize: size * 0.42, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
          Orda Point
        </div>
        {subtitle ? (
          <div style={{ fontSize: size * 0.22, opacity: 0.7, marginTop: 2 }}>{subtitle}</div>
        ) : null}
      </div>
    </div>
  )
}
