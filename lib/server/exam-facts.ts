/**
 * Вопросы по данным точки: цены, тарифы, железо, товары, склад.
 *
 * Регламент отвечает на вопрос «как правильно», но клиент у стойки спрашивает
 * другое: сколько стоит час в PRO, какая тут герцовка, почём кола. Это знание
 * живёт не в тексте, а в самой системе — и меняется без переписывания правил.
 *
 * Поэтому вопросы здесь НЕ пишет модель. Правильный ответ берётся из базы, а
 * неверные варианты — реальные значения соседних объектов той же точки: другие
 * тарифы, другие цены, другие зоны. Модель переврала бы цифру, а такой вопрос
 * не может быть неверным по построению и обновляется сам после смены цены.
 */

export type FactQuestion = {
  topic: FactTopic
  q: string
  choices: string[]
  correct: number
  /** Откуда факт — показывается владельцу под вопросом. */
  source: string
}

export type FactTopic = 'catalog' | 'tariffs' | 'hardware' | 'stations' | 'warehouse'

export const FACT_TOPICS: Array<{ id: FactTopic; label: string; hint: string }> = [
  { id: 'tariffs', label: 'Тарифы зала', hint: 'Цены, длительность, ночные окна' },
  { id: 'hardware', label: 'Техника зон', hint: 'Процессор, видеокарта, монитор, герцовка' },
  { id: 'stations', label: 'Станции и игры', hint: 'Какая станция в какой зоне, что установлено' },
  { id: 'catalog', label: 'Товары и цены', hint: 'Ходовые позиции витрины' },
  { id: 'warehouse', label: 'Склад и заявки', hint: 'Статусы заявок и порядок работы' },
]

type SupabaseLike = {
  from: (table: string) => any
}

/** Перемешать так, чтобы верный ответ не оказывался всегда первым. */
function shuffleWithCorrect(correctValue: string, wrong: string[]): { choices: string[]; correct: number } {
  const unique = Array.from(new Set(wrong.filter((value) => value && value !== correctValue))).slice(0, 3)
  const all = [correctValue, ...unique]
  for (let i = all.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[all[i], all[j]] = [all[j], all[i]]
  }
  return { choices: all, correct: all.indexOf(correctValue) }
}

const money = (value: number) => `${Math.round(Number(value) || 0).toLocaleString('ru-RU')} ₸`

/** Вопрос собирается, только если нашлось хотя бы два неверных варианта. */
function build(
  topic: FactTopic,
  q: string,
  correctValue: string,
  wrong: string[],
  source: string,
): FactQuestion | null {
  const { choices, correct } = shuffleWithCorrect(correctValue, wrong)
  if (choices.length < 3) return null
  return { topic, q, choices, correct, source }
}

/** Тарифы: цена и длительность — то, что оператор называет клиенту вслух. */
export async function tariffFacts(supabase: SupabaseLike, companyId: string): Promise<FactQuestion[]> {
  const { data } = await supabase
    .from('arena_tariffs')
    .select('id, name, price, duration_minutes, zone_id, is_active, window_start_time, window_end_time')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .limit(50)

  const tariffs = (data || []) as any[]
  if (tariffs.length < 3) return []

  const prices = tariffs.map((row) => money(row.price))
  const questions: FactQuestion[] = []

  for (const tariff of tariffs) {
    const name = String(tariff.name || '').trim()
    if (!name) continue

    const priceQuestion = build(
      'tariffs',
      `Сколько стоит тариф «${name}»?`,
      money(tariff.price),
      prices,
      'Тарифы точки',
    )
    if (priceQuestion) questions.push(priceQuestion)

    const minutes = Number(tariff.duration_minutes || 0)
    if (minutes > 0) {
      const others = tariffs
        .filter((row) => Number(row.duration_minutes) !== minutes)
        .map((row) => `${Number(row.duration_minutes)} мин`)
      const durationQuestion = build(
        'tariffs',
        `Сколько времени даёт тариф «${name}»?`,
        `${minutes} мин`,
        others,
        'Тарифы точки',
      )
      if (durationQuestion) questions.push(durationQuestion)
    }

    if (tariff.window_start_time && tariff.window_end_time) {
      const others = tariffs
        .filter((row) => row.window_start_time && row.window_start_time !== tariff.window_start_time)
        .map((row) => `с ${String(row.window_start_time).slice(0, 5)} до ${String(row.window_end_time).slice(0, 5)}`)
      const windowQuestion = build(
        'tariffs',
        `В какое время действует тариф «${name}»?`,
        `с ${String(tariff.window_start_time).slice(0, 5)} до ${String(tariff.window_end_time).slice(0, 5)}`,
        others,
        'Тарифы точки',
      )
      if (windowQuestion) questions.push(windowQuestion)
    }
  }

  return questions
}

/** Железо зон: то, что спрашивает клиент перед посадкой. */
export async function hardwareFacts(supabase: SupabaseLike, companyId: string): Promise<FactQuestion[]> {
  const { data } = await supabase
    .from('arena_zones')
    .select('id, name, cpu, gpu, ram, monitor, refresh_hz, peripherals, extension_hourly_price, is_active')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .limit(20)

  const zones = (data || []) as any[]
  if (zones.length === 0) return []

  const questions: FactQuestion[] = []
  const fields: Array<{ key: string; label: string; ask: (zone: string) => string }> = [
    { key: 'gpu', label: 'видеокарта', ask: (zone) => `Какая видеокарта стоит в зоне «${zone}»?` },
    { key: 'cpu', label: 'процессор', ask: (zone) => `Какой процессор в зоне «${zone}»?` },
    { key: 'monitor', label: 'монитор', ask: (zone) => `Какой монитор в зоне «${zone}»?` },
    { key: 'ram', label: 'память', ask: (zone) => `Сколько оперативной памяти в зоне «${zone}»?` },
  ]

  for (const zone of zones) {
    const zoneName = String(zone.name || '').trim()
    if (!zoneName) continue

    for (const field of fields) {
      const value = String(zone[field.key] || '').trim()
      if (!value) continue
      const others = zones
        .filter((row) => String(row.id) !== String(zone.id))
        .map((row) => String(row[field.key] || '').trim())
        .filter(Boolean)
      const question = build('hardware', field.ask(zoneName), value, others, `Характеристики зоны «${zoneName}»`)
      if (question) questions.push(question)
    }

    const hz = Number(zone.refresh_hz || 0)
    if (hz > 0) {
      const others = zones
        .map((row) => Number(row.refresh_hz || 0))
        .filter((value) => value > 0 && value !== hz)
        .map((value) => `${value} Гц`)
      // Стандартный ряд герцовок: без него у клуба с одинаковыми мониторами
      // не набралось бы вариантов и вопрос бы не собрался.
      const fallback = [60, 75, 144, 165, 240].filter((value) => value !== hz).map((value) => `${value} Гц`)
      const question = build(
        'hardware',
        `Какая частота мониторов в зоне «${zoneName}»?`,
        `${hz} Гц`,
        [...others, ...fallback],
        `Характеристики зоны «${zoneName}»`,
      )
      if (question) questions.push(question)
    }

    const extension = Number(zone.extension_hourly_price || 0)
    if (extension > 0) {
      const others = zones
        .map((row) => Number(row.extension_hourly_price || 0))
        .filter((value) => value > 0 && value !== extension)
        .map(money)
      const question = build(
        'hardware',
        `Сколько стоит час продления в зоне «${zoneName}»?`,
        money(extension),
        others,
        `Зона «${zoneName}»`,
      )
      if (question) questions.push(question)
    }
  }

  return questions
}

/** Станции: где что стоит и что на них установлено. */
export async function stationFacts(supabase: SupabaseLike, companyId: string): Promise<FactQuestion[]> {
  const { data: zonesData } = await supabase
    .from('arena_zones')
    .select('id, name, is_active')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .limit(20)
  const zones = (zonesData || []) as any[]
  if (zones.length < 2) return []
  const zoneNameById = new Map(zones.map((row) => [String(row.id), String(row.name || '')]))

  const { data: stationsData } = await supabase
    .from('arena_stations')
    .select('id, name, zone_id, is_active')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .limit(200)
  const stations = ((stationsData || []) as any[]).filter((row) => row.zone_id)
  if (stations.length === 0) return []

  const questions: FactQuestion[] = []
  const zoneNames = zones.map((row) => String(row.name || '')).filter(Boolean)

  // Спрашиваем не про каждую станцию из семидесяти, а про выборку.
  const sample = [...stations].sort(() => Math.random() - 0.5).slice(0, 12)
  for (const station of sample) {
    const zoneName = zoneNameById.get(String(station.zone_id))
    if (!zoneName) continue
    const question = build(
      'stations',
      `В какой зоне находится место «${String(station.name)}»?`,
      zoneName,
      zoneNames.filter((name) => name !== zoneName),
      'Карта зала',
    )
    if (question) questions.push(question)
  }

  return questions
}

/** Товары: ходовые позиции витрины и их цены. */
export async function catalogFacts(supabase: SupabaseLike, companyId: string, limit = 25): Promise<FactQuestion[]> {
  // Топ по продажам за 60 дней: оператор обязан знать то, что берут каждый день,
  // а не позицию, проданную дважды за год.
  const since = new Date(Date.now() - 60 * 24 * 3600_000).toISOString().slice(0, 10)
  const { data: salesRows } = await supabase
    .from('point_sales')
    .select('id')
    .eq('company_id', companyId)
    .gte('sale_date', since)
    .limit(2000)

  const saleIds = ((salesRows || []) as any[]).map((row) => String(row.id))
  const soldCount = new Map<string, number>()
  if (saleIds.length > 0) {
    const { data: itemRows } = await supabase
      .from('point_sale_items')
      .select('item_id, quantity')
      .in('sale_id', saleIds.slice(0, 1000))
      .limit(5000)
    for (const row of (itemRows || []) as any[]) {
      const key = String(row.item_id || '')
      if (!key) continue
      soldCount.set(key, (soldCount.get(key) || 0) + Number(row.quantity || 0))
    }
  }

  const { data: itemsData } = await supabase
    .from('inventory_items')
    .select('id, name, sale_price, unit, company_id, is_active')
    .eq('company_id', companyId)
    .limit(500)

  const items = ((itemsData || []) as any[])
    .filter((row) => row.is_active !== false)
    .filter((row) => Number(row.sale_price || 0) > 0)

  if (items.length < 3) return []

  const ranked = [...items].sort(
    (left, right) => (soldCount.get(String(right.id)) || 0) - (soldCount.get(String(left.id)) || 0),
  )
  const top = ranked.slice(0, limit)
  const prices = items.map((row) => money(row.sale_price))

  const questions: FactQuestion[] = []
  for (const item of top) {
    const name = String(item.name || '').trim()
    if (!name) continue
    const question = build(
      'catalog',
      `Сколько стоит «${name}»?`,
      money(item.sale_price),
      prices,
      'Каталог точки',
    )
    if (question) questions.push(question)
  }

  return questions
}

/** Складские процессы: статусы заявок — их путают чаще всего. */
export function warehouseFacts(): FactQuestion[] {
  const statuses: Array<{ status: string; meaning: string }> = [
    { status: 'Новая', meaning: 'Заявка создана и ждёт решения менеджера' },
    { status: 'Одобрена частично', meaning: 'Выдадут только часть позиций, остаток нужно уточнить' },
    { status: 'Выдана', meaning: 'Товар передан на точку, нужно проверить и подтвердить получение' },
    { status: 'Получена', meaning: 'Оператор подтвердил получение товара' },
    { status: 'Отклонена', meaning: 'В заявке отказано, причина в комментарии менеджера' },
    { status: 'Спор', meaning: 'Выданное и полученное разошлись, разбирается с менеджером' },
  ]

  const questions: FactQuestion[] = []
  for (const item of statuses) {
    const question = build(
      'warehouse',
      `Что означает статус заявки «${item.status}»?`,
      item.meaning,
      statuses.filter((row) => row.status !== item.status).map((row) => row.meaning),
      'Работа со складом',
    )
    if (question) questions.push(question)
  }
  return questions
}

/** Все факты по выбранным темам. Порядок случайный, дубли по вопросу убраны. */
export async function collectFactQuestions(params: {
  supabase: SupabaseLike
  companyIds: string[]
  topics: FactTopic[]
}): Promise<FactQuestion[]> {
  const wanted = new Set(params.topics)
  const collected: FactQuestion[] = []

  for (const companyId of params.companyIds) {
    if (wanted.has('tariffs')) collected.push(...(await tariffFacts(params.supabase, companyId)))
    if (wanted.has('hardware')) collected.push(...(await hardwareFacts(params.supabase, companyId)))
    if (wanted.has('stations')) collected.push(...(await stationFacts(params.supabase, companyId)))
    if (wanted.has('catalog')) collected.push(...(await catalogFacts(params.supabase, companyId)))
  }
  if (wanted.has('warehouse')) collected.push(...warehouseFacts())

  const seen = new Set<string>()
  return collected
    .filter((question) => {
      const key = question.q.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort(() => Math.random() - 0.5)
}
