// ─── Каталог именованных аддонов (единый источник правды) ───────────────────
//
// Аддон = продаваемая единица = набор страниц под одним кодом фичи `addon.<name>`.
// Здесь и ТОЛЬКО здесь описано: какой аддон существует, что в него входит (pages),
// какие feature-коды он выдаёт орг (grants) и цена.
//
// Как это работает:
//  1. `getAddonForPath(path)` → код аддона для страницы (питает getPathFeature в
//     sections.tsx → меню + proxy режут страницу, если у орг нет кода).
//  2. `requireAddon(access, 'addon.hr')` (lib/server/entitlements.ts) — гейт в data-API
//     страниц аддона (иначе аддон обходится прямым вызовом API).
//  3. Сид таблицы `addons` из этого каталога (/platform → супер-админ включает орг).
//
// ВАЖНО: существующие коды `shop.catalog` (Магазин, уже энфорсится в 44 роутах) и
// `ai.cfo` СОХРАНЯЮТСЯ — аддоны, которые их включают, перечисляют их в `grants`.

export type AddonBilling = 'flat' | 'per_operator' | 'per_station' | 'per_company' | 'flag'

export type AddonDef = {
  /** Код аддона (он же попадает в organization_addons.addon_code и в набор фич орг). */
  code: string
  name: string
  description: string
  /** Путь-префиксы страниц аддона. Точное совпадение или `<path>/...`. */
  pages: string[]
  /** Все feature-коды, которые аддон выдаёт орг (обычно [code], плюс легаси-коды). */
  grants: string[]
  price_kzt: number
  billing?: AddonBilling
}

export const ADDON_CATALOG: AddonDef[] = [
  {
    code: 'shop.catalog',
    name: 'Магазин / Склад',
    description: 'Склад, витрина, движения, каталог, техкарты, заявки, план закупа, поставщики.',
    pages: ['/store', '/inventory'],
    grants: ['shop.catalog'],
    price_kzt: 0,
    billing: 'flat',
  },
  {
    code: 'addon.webpos',
    name: 'Web POS (веб-касса)',
    description: 'Веб-касса оператора для планшета/браузера.',
    pages: ['/pos'],
    grants: ['addon.webpos'],
    price_kzt: 0,
    billing: 'flat',
  },
  {
    code: 'addon.arena',
    name: 'Арена / Игровой клуб',
    description: 'Станции, зоны, тарифы, игровые сессии, зал.',
    pages: ['/stations'],
    grants: ['addon.arena'],
    price_kzt: 0,
    billing: 'flat',
  },
  {
    code: 'addon.ai',
    name: 'AI & Аналитика',
    description: 'AI-копилот, AI-Финдиректор, Бизнес-аналитика, AI-разбор, прогноз.',
    // /ai-cfo сохраняет свой код ai.cfo (см. grants) — здесь остальные AI-страницы.
    pages: ['/analysis', '/forecast', '/business-intelligence', '/expense-analysis', '/team-analysis'],
    grants: ['addon.ai', 'ai.cfo'],
    price_kzt: 0,
    billing: 'flat',
  },
  {
    code: 'addon.hr',
    name: 'HR',
    description: 'Сотрудники, должности, оргструктура, карьера, кадры, дни рождения.',
    pages: ['/hr', '/staff', '/structure', '/operators', '/birthdays'],
    grants: ['addon.hr'],
    price_kzt: 0,
    billing: 'flat',
  },
  {
    code: 'addon.salary',
    name: 'Зарплата',
    description: 'Начисление, правила зарплаты, долги сотрудников, внутренние переводы.',
    pages: ['/salary', '/point-debts'],
    grants: ['addon.salary'],
    price_kzt: 0,
    billing: 'flat',
  },
  {
    code: 'addon.telegram',
    name: 'Telegram-отчёты',
    description: 'Авто-отчёты смен и дня в Telegram.',
    pages: ['/telegram'],
    grants: ['addon.telegram'],
    price_kzt: 0,
    billing: 'flat',
  },
  // Лояльность (клиенты/скидки/карты) живёт внутри модуля «Магазин» (/store/clients)
  // и отдельной страницы верхнего уровня не имеет → входит в addon shop.catalog.
  // Если понадобится продавать отдельно — вынесем страницу и заведём код.
  {
    code: 'addon.sales_kpi',
    name: 'Эффективность продавцов',
    description:
      'Разделяет провал потока и провал продавца: ожидание по сезону и смене, метрики допродаж, балл кассира.',
    pages: ['/sales-kpi'],
    grants: ['addon.sales_kpi'],
    price_kzt: 0,
    billing: 'flat',
  },
  {
    code: 'addon.branding',
    name: 'White-label / брендинг',
    description: 'Свой логотип, бренд и поддомен клиента.',
    pages: [],
    grants: ['addon.branding'],
    price_kzt: 0,
    billing: 'flag',
  },
]

const BY_CODE = new Map(ADDON_CATALOG.map((a) => [a.code, a]))

export function getAddonByCode(code: string): AddonDef | undefined {
  return BY_CODE.get(code)
}

/** Код аддона (фичи), которому принадлежит страница. null = страница не в аддоне. */
export function getAddonForPath(pathname: string): string | null {
  const clean = pathname.split('?')[0]
  for (const addon of ADDON_CATALOG) {
    for (const p of addon.pages) {
      if (clean === p || clean.startsWith(p + '/')) return addon.code
    }
  }
  return null
}

/** Все feature-коды, которые выдаёт набор включённых аддонов (для резолвера). */
export function grantsForAddonCodes(codes: string[]): string[] {
  const out = new Set<string>()
  for (const c of codes) {
    const a = BY_CODE.get(c)
    if (a) for (const g of a.grants) out.add(g)
    else out.add(c) // неизвестный код — пропускаем как есть (обратная совместимость)
  }
  return [...out]
}
