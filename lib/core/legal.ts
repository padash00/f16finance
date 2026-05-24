// Единый источник правды для юридических документов и связанной бизнес-логики.
// Менять только синхронно с публикацией новой редакции документов.

export const LEGAL_VERSION = '2026-05-24'
export const LEGAL_EFFECTIVE_DATE = '2026-05-24'
export const LEGAL_LAST_UPDATED = '2026-05-24'

export const TRIAL_DAYS = 14

export function getTrialEndsAt(from: Date = new Date()): Date {
  const result = new Date(from)
  result.setUTCDate(result.getUTCDate() + TRIAL_DAYS)
  return result
}

export const LEGAL_HISTORY: { date: string; note: string }[] = [
  {
    date: '2026-05-24',
    note: 'Обновление реквизитов до ТОО «Turanix», фиксация пробного периода 14 дней, добавлены /terms, /sla, /cookies.',
  },
  {
    date: '2026-05-06',
    note: 'Первая публикация оферты и политики конфиденциальности OrdaOps.',
  },
]

export const LEGAL_ENTITY = {
  shortName: 'ТОО «Turanix»',
  fullName: 'Товарищество с ограниченной ответственностью «Turanix»',
  bin: '260540022744',
  address:
    'Республика Казахстан, Восточно-Казахстанская область, г. Усть-Каменогорск, пр. Илияса Есенберлина, дом 20, кв. 272, индекс 070000',
  city: 'Усть-Каменогорск',
  country: 'Республика Казахстан',
  emailInfo: 'info@turanix.kz',
  emailSupport: 'support@turanix.kz',
  phone: '+7 701 107 02 60',
  bank: 'АО «Kaspi Bank»',
  iik: 'KZ02722S000053834515',
  bik: 'CASPKZKA',
  kbe: '17',
} as const

export const PRODUCT_NAME = 'OrdaOps'
export const PRODUCT_SITE = 'ordaops.kz'
