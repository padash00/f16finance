/**
 * Каталог ниш точки и каркас регламентов под каждую.
 *
 * Ниша — свойство ТОЧКИ (companies.industry), а не организации: в одной
 * компании могут одновременно работать компьютерный клуб, PS-клуб и магазин,
 * и правила у них разные. Тариф (packages.vertical) к этому отношения не имеет —
 * он про то, за что заплачено, а не про то, чем точка занимается.
 *
 * Каркас (topics) — это не текст, а перечень тем, которые обязаны быть закрыты.
 * По нему страница «Настройка базы знаний» показывает дыры, а ИИ понимает, о чём
 * писать. Один topic = одна статья (knowledge_articles.topic_key).
 */

export type IndustryCode = 'club' | 'ps_club' | 'shop' | 'food' | 'service' | 'other'

/** Источник фактов из БД, из которого тему можно собрать без участия человека. */
export type TopicFactSource = 'catalog' | 'salary_rules' | 'checklists'

export type KnowledgeTopic = {
  key: string
  label: string
  /** Что должно быть в статье — идёт в промпт ИИ и в подсказку владельцу. */
  hint: string
  /** Если задан — тему можно собрать из данных системы, без интервью. */
  factSource?: TopicFactSource
  severity?: 'info' | 'normal' | 'warning' | 'critical'
}

export type InterviewQuestion = {
  key: string
  question: string
  hint?: string
  /** Темы, для которых ответ служит сырьём. */
  topics: string[]
}

export type Industry = {
  code: IndustryCode
  label: string
  description: string
  topics: KnowledgeTopic[]
  interview: InterviewQuestion[]
}

// ─── Общие темы: одинаковы для любой ниши ──────────────────────────────────
// Живут общесетевыми (company_id = null, industry = null) — пишутся один раз
// на всю организацию и попадают в экзамен любой точки.

export const COMMON_TOPICS: KnowledgeTopic[] = [
  {
    key: 'shift_handover',
    label: 'Приём и сдача смены',
    hint: 'Что проверяется при приёме, что фиксируется, на кого переходит ответственность, если проблему не записали.',
    severity: 'warning',
  },
  {
    key: 'cash_discipline',
    label: 'Касса и деньги',
    hint: 'Старт кассы, куда что пробивается, что делать при расхождении, кому сообщать о недостаче.',
    severity: 'critical',
  },
  {
    key: 'shift_pay_rules',
    label: 'Оплата смены, штрафы и премии',
    hint: 'Сколько платят за смену, за что бонус, за что штраф, когда выплата.',
    factSource: 'salary_rules',
    severity: 'normal',
  },
  {
    key: 'shift_checklists',
    label: 'Чек-листы смены',
    hint: 'Что проверять в начале, в течение и в конце смены.',
    factSource: 'checklists',
    severity: 'normal',
  },
  {
    key: 'conflict_basics',
    label: 'Конфликтные ситуации',
    hint: 'Порядок действий при недовольном клиенте: что говорить, чего не делать, когда звать руководителя, что фиксировать.',
    severity: 'warning',
  },
  {
    key: 'communication_tone',
    label: 'Как разговаривать с клиентом',
    hint: 'Приветствие, обращение, тон, запретные фразы, как отказывать, как извиняться.',
    severity: 'normal',
  },
  {
    key: 'confidentiality',
    label: 'Конфиденциальность и доступы',
    hint: 'Что нельзя передавать наружу: доступы, отчёты, суммы кассы, данные клиентов.',
    severity: 'critical',
  },
  {
    key: 'safety',
    label: 'Техника безопасности',
    hint: 'Чего нельзя делать самому, что считается опасным, кому и когда звонить.',
    severity: 'warning',
  },
]

const INDUSTRIES: Industry[] = [
  {
    code: 'club',
    label: 'Компьютерный клуб',
    description: 'Почасовая аренда ПК, зоны, бронь, турниры',
    topics: [
      {
        key: 'club_tariffs',
        label: 'Тарифы, зоны и прайм',
        hint: 'Сколько стоит час по зонам, когда прайм, какие пакеты и ночные тарифы.',
        factSource: 'catalog',
        severity: 'normal',
      },
      { key: 'club_booking', label: 'Бронь мест', hint: 'Как принимается бронь, на сколько держится, что при опоздании.' },
      {
        key: 'club_pc_failure',
        label: 'Поломка ПК у клиента',
        hint: 'Порядок действий: диагностика, пересадка, компенсация времени, фиксация номера ПК.',
        severity: 'warning',
      },
      { key: 'club_deposit', label: 'Депозит и возврат остатка', hint: 'Как пополняется счёт, возвращается ли остаток, что с истёкшими часами.' },
      {
        key: 'club_noise_alcohol',
        label: 'Шум, алкоголь, поведение в зале',
        hint: 'Что запрещено, сколько предупреждений, когда выгонять и как это делать.',
        severity: 'warning',
      },
      {
        key: 'club_minors',
        label: 'Несовершеннолетние и ночь',
        hint: 'До скольки можно находиться, что проверять, что делать при отказе показать документ.',
        severity: 'critical',
      },
      { key: 'club_food_orders', label: 'Бар и заказы в зал', hint: 'Как принимается заказ, как пробивается, что при отказе от заказа.' },
    ],
    interview: [
      { key: 'zones', question: 'Какие зоны есть в клубе и сколько стоит час в каждой?', hint: 'Например: Standard 700, PRO 1000, VIP 1500', topics: ['club_tariffs'] },
      { key: 'prime', question: 'Когда прайм-время и как меняется цена?', topics: ['club_tariffs'] },
      { key: 'booking', question: 'Как у вас бронируют места и сколько держите бронь?', topics: ['club_booking'] },
      { key: 'pc_failure', question: 'Что оператор должен сделать, если у клиента завис или сломался ПК?', topics: ['club_pc_failure'] },
      { key: 'deposit', question: 'Как работает депозит: возвращаете ли остаток, сгорают ли часы?', topics: ['club_deposit'] },
      { key: 'behaviour', question: 'Что категорически запрещено в зале и что делает оператор при нарушении?', topics: ['club_noise_alcohol'] },
      { key: 'minors', question: 'Правила для несовершеннолетних: до скольки, что проверяете?', topics: ['club_minors'] },
      { key: 'conflict', question: 'Опишите последний конфликт с клиентом и как правильно было бы его решить', topics: ['conflict_basics'] },
      { key: 'tone', question: 'Как оператор должен встречать и провожать клиента? Какие фразы недопустимы?', topics: ['communication_tone'] },
      { key: 'handover', question: 'Что проверяется при приёме смены?', topics: ['shift_handover'] },
      { key: 'cash', question: 'Как устроена касса: старт, куда пробиваются оплаты, что при расхождении?', topics: ['cash_discipline'] },
    ],
  },
  {
    code: 'ps_club',
    label: 'PS / консольный клуб',
    description: 'Приставки, комнаты, почасовая игра',
    topics: [
      {
        key: 'ps_tariffs',
        label: 'Тарифы на приставки и комнаты',
        hint: 'Сколько стоит час на приставку/комнату, сколько джойстиков включено, доплата за игрока.',
        factSource: 'catalog',
        severity: 'normal',
      },
      { key: 'ps_queue', label: 'Очередь и запись', hint: 'Как ведётся очередь, как записывают, что при опоздании.' },
      { key: 'ps_extension', label: 'Продление времени', hint: 'За сколько минут предупреждать, как продлевают, что если следующие уже ждут.' },
      {
        key: 'ps_equipment',
        label: 'Джойстики, диски, оборудование',
        hint: 'Выдача и приём, проверка на повреждения, что делать при поломке и кто платит.',
        severity: 'warning',
      },
      { key: 'ps_disputes', label: 'Споры «кто следующий»', hint: 'Как оператор разрешает спор об очереди, на что опирается.', severity: 'warning' },
      { key: 'ps_kids', label: 'Дети и возрастные рейтинги', hint: 'С какого возраста без родителей, какие игры не запускать детям.', severity: 'critical' },
    ],
    interview: [
      { key: 'tariffs', question: 'Сколько стоит час игры и что входит в цену (сколько джойстиков, доплата за игрока)?', topics: ['ps_tariffs'] },
      { key: 'queue', question: 'Как ведётся очередь и запись на приставки?', topics: ['ps_queue'] },
      { key: 'extension', question: 'Как продлевают время и что делать, если следующие уже ждут?', topics: ['ps_extension'] },
      { key: 'equipment', question: 'Порядок выдачи джойстиков и дисков. Кто платит за поломку?', topics: ['ps_equipment'] },
      { key: 'disputes', question: 'Как оператор решает спор «мы были следующие»?', topics: ['ps_disputes'] },
      { key: 'kids', question: 'С какого возраста пускаете без родителей и какие игры не запускаете детям?', topics: ['ps_kids'] },
      { key: 'conflict', question: 'Опишите типичный конфликт и как правильно его гасить', topics: ['conflict_basics'] },
      { key: 'tone', question: 'Как оператор должен общаться с гостями? Какие фразы недопустимы?', topics: ['communication_tone'] },
      { key: 'handover', question: 'Что проверяется при приёме смены?', topics: ['shift_handover'] },
      { key: 'cash', question: 'Как устроена касса: старт, оплаты, что при расхождении?', topics: ['cash_discipline'] },
    ],
  },
  {
    code: 'shop',
    label: 'Магазин',
    description: 'Розница: товар, полка, касса, возвраты',
    topics: [
      {
        key: 'shop_assortment',
        label: 'Ассортимент и цены',
        hint: 'Ключевые товары и цены, чем отличаются похожие позиции, что спрашивают чаще всего.',
        factSource: 'catalog',
        severity: 'normal',
      },
      {
        key: 'shop_expiry',
        label: 'Сроки годности и ротация',
        hint: 'Как проверять сроки, правило выкладки (ближний срок вперёд), за сколько дней снимать с полки.',
        severity: 'critical',
      },
      { key: 'shop_delivery', label: 'Приём поставки', hint: 'Что сверять с накладной, что делать при недостаче, бое, неверной цене.', severity: 'warning' },
      { key: 'shop_returns', label: 'Возврат и обмен', hint: 'В каких случаях меняем, что требуем, что делать при отказе, когда звать руководителя.', severity: 'warning' },
      { key: 'shop_damaged', label: 'Брак и повреждённая упаковка', hint: 'Вздутая упаковка, потёкшее, битое: куда убирать, как списывать, что говорить клиенту.', severity: 'critical' },
      { key: 'shop_price_tags', label: 'Ценники и переоценка', hint: 'Кто меняет ценники, что делать если цена на полке ниже кассовой.', severity: 'warning' },
      { key: 'shop_advice', label: 'Помощь в выборе и допродажа', hint: 'Как предложить товар, что говорить на «что посоветуете», чего не обещать.' },
    ],
    interview: [
      { key: 'assortment', question: 'Какие товары ключевые и что чаще всего спрашивают клиенты?', topics: ['shop_assortment', 'shop_advice'] },
      { key: 'expiry', question: 'Как у вас контролируются сроки годности и за сколько дней товар снимается с полки?', topics: ['shop_expiry'] },
      { key: 'delivery', question: 'Порядок приёма поставки: что сверяется, что при недостаче или бое?', topics: ['shop_delivery'] },
      { key: 'returns', question: 'В каких случаях делаете возврат или обмен и что требуете от клиента?', topics: ['shop_returns'] },
      { key: 'damaged', question: 'Что делать с повреждённым или вздутым товаром?', topics: ['shop_damaged'] },
      { key: 'price_tags', question: 'Кто отвечает за ценники и что делать, если цена на полке ниже кассовой?', topics: ['shop_price_tags'] },
      { key: 'conflict', question: 'Опишите типичный конфликт с покупателем и как правильно его решить', topics: ['conflict_basics'] },
      { key: 'tone', question: 'Как продавец должен встречать покупателя? Какие фразы недопустимы?', topics: ['communication_tone'] },
      { key: 'handover', question: 'Что проверяется при приёме смены?', topics: ['shift_handover'] },
      { key: 'cash', question: 'Как устроена касса: старт, оплаты, что при расхождении?', topics: ['cash_discipline'] },
    ],
  },
  {
    code: 'food',
    label: 'Общепит',
    description: 'Кухня, заказы, доставка, санитария',
    topics: [
      {
        key: 'food_menu',
        label: 'Меню и цены',
        hint: 'Позиции, цены, состав, чем отличаются похожие блюда, что в стоп-листе чаще всего.',
        factSource: 'catalog',
        severity: 'normal',
      },
      { key: 'food_safety', label: 'Санитария и хранение', hint: 'Температуры, сроки, мытьё рук, что делать с просроченным сырьём.', severity: 'critical' },
      { key: 'food_order_accuracy', label: 'Приём заказа', hint: 'Как принимать и повторять заказ, как уточнять состав, что при ошибке в заказе.', severity: 'warning' },
      { key: 'food_allergens', label: 'Аллергены и состав', hint: 'Что отвечать на вопрос о составе, чего нельзя обещать, когда звать руководителя.', severity: 'critical' },
      { key: 'food_complaints', label: 'Жалобы на еду', hint: 'Что делать, если клиенту не понравилось или нашли посторонний предмет.', severity: 'critical' },
      { key: 'food_delivery', label: 'Доставка и самовывоз', hint: 'Порядок выдачи, упаковка, что при опоздании курьера, что при отказе.' },
      { key: 'food_kitchen_handover', label: 'Пересменка на кухне', hint: 'Что передаётся: заготовки, остатки, чистота, что фиксируется.' },
    ],
    interview: [
      { key: 'menu', question: 'Что в меню и сколько стоит? Что берут чаще всего?', topics: ['food_menu'] },
      { key: 'sanitation', question: 'Правила хранения и санитарии: температуры, сроки, что делать с просрочкой?', topics: ['food_safety'] },
      { key: 'order', question: 'Как правильно принять заказ и что делать, если ошиблись?', topics: ['food_order_accuracy'] },
      { key: 'allergens', question: 'Что отвечать на вопросы о составе и аллергенах?', topics: ['food_allergens'] },
      { key: 'complaints', question: 'Клиент жалуется на еду — порядок действий?', topics: ['food_complaints'] },
      { key: 'delivery', question: 'Как устроена доставка и самовывоз?', topics: ['food_delivery'] },
      { key: 'kitchen', question: 'Что передаётся при пересменке на кухне?', topics: ['food_kitchen_handover'] },
      { key: 'tone', question: 'Как сотрудник должен общаться с гостем? Какие фразы недопустимы?', topics: ['communication_tone'] },
      { key: 'cash', question: 'Как устроена касса: старт, оплаты, что при расхождении?', topics: ['cash_discipline'] },
    ],
  },
  {
    code: 'service',
    label: 'Услуги',
    description: 'Приём заказов, работы, гарантия',
    topics: [
      { key: 'service_intake', label: 'Приём заказа в работу', hint: 'Что записывается, что проверяется при приёме, что выдаётся клиенту.' , severity: 'warning' },
      {
        key: 'service_pricing',
        label: 'Прайс на работы',
        hint: 'Сколько стоят основные работы, от чего зависит цена, что нельзя обещать.',
        factSource: 'catalog',
      },
      { key: 'service_updates', label: 'Информирование клиента', hint: 'Когда и как сообщать о ходе работ, что говорить при задержке.' },
      { key: 'service_warranty', label: 'Гарантия и претензии', hint: 'Что покрывается, что нет, порядок при повторном обращении.', severity: 'warning' },
    ],
    interview: [
      { key: 'intake', question: 'Как принимается заказ в работу и что фиксируется?', topics: ['service_intake'] },
      { key: 'pricing', question: 'Сколько стоят основные работы и от чего зависит цена?', topics: ['service_pricing'] },
      { key: 'updates', question: 'Как и когда сообщаете клиенту о ходе работ?', topics: ['service_updates'] },
      { key: 'warranty', question: 'Что покрывает гарантия и как действовать при претензии?', topics: ['service_warranty'] },
      { key: 'conflict', question: 'Типичный конфликт с клиентом и как его правильно решить?', topics: ['conflict_basics'] },
      { key: 'tone', question: 'Как сотрудник должен общаться с клиентом? Какие фразы недопустимы?', topics: ['communication_tone'] },
      { key: 'cash', question: 'Как устроена касса: старт, оплаты, что при расхождении?', topics: ['cash_discipline'] },
    ],
  },
  {
    code: 'other',
    label: 'Другое',
    description: 'Только общие правила без отраслевых тем',
    topics: [],
    interview: [
      { key: 'conflict', question: 'Типичный конфликт с клиентом и как его правильно решить?', topics: ['conflict_basics'] },
      { key: 'tone', question: 'Как сотрудник должен общаться с клиентом? Какие фразы недопустимы?', topics: ['communication_tone'] },
      { key: 'handover', question: 'Что проверяется при приёме смены?', topics: ['shift_handover'] },
      { key: 'cash', question: 'Как устроена касса: старт, оплаты, что при расхождении?', topics: ['cash_discipline'] },
    ],
  },
]

export const INDUSTRY_CODES = INDUSTRIES.map((i) => i.code)

export function getIndustry(code: string | null | undefined): Industry | null {
  if (!code) return null
  return INDUSTRIES.find((item) => item.code === code) || null
}

export function listIndustries(): Array<Pick<Industry, 'code' | 'label' | 'description'>> {
  return INDUSTRIES.map(({ code, label, description }) => ({ code, label, description }))
}

/** Полный каркас точки: общие темы + отраслевые. */
export function getTopicsForIndustry(code: string | null | undefined): KnowledgeTopic[] {
  const industry = getIndustry(code)
  return [...COMMON_TOPICS, ...(industry?.topics || [])]
}

export function getInterviewForIndustry(code: string | null | undefined): InterviewQuestion[] {
  return getIndustry(code)?.interview || getIndustry('other')!.interview
}

export function findTopic(code: string | null | undefined, topicKey: string): KnowledgeTopic | null {
  return getTopicsForIndustry(code).find((topic) => topic.key === topicKey) || null
}

/**
 * План интервью под конкретную точку: спрашиваем ТОЛЬКО про незакрытые темы.
 *
 * Два правила, без которых раздел никогда не заполнится до конца:
 *   1. Тема, у которой уже есть статья, из интервью выпадает — иначе владелец
 *      второй раз отвечает на то, что уже написано, а генерация всё равно
 *      пропустит дубль.
 *   2. Для темы, под которую в каталоге нет заготовленного вопроса, вопрос
 *      собирается из её же подсказки. Иначе такую дыру закрыть интервью
 *      физически невозможно, и прогресс навсегда застрянет ниже 100%.
 */
export function buildInterviewPlan(
  code: string | null | undefined,
  coveredTopicKeys: readonly string[],
): InterviewQuestion[] {
  const covered = new Set(coveredTopicKeys)
  const topics = getTopicsForIndustry(code)
  const uncovered = topics.filter((topic) => !covered.has(topic.key))
  if (uncovered.length === 0) return []

  const uncoveredKeys = new Set(uncovered.map((topic) => topic.key))
  const plan: InterviewQuestion[] = []
  const addressed = new Set<string>()

  for (const question of getInterviewForIndustry(code)) {
    const relevant = question.topics.filter((key) => uncoveredKeys.has(key))
    if (relevant.length === 0) continue
    plan.push({ ...question, topics: relevant })
    for (const key of relevant) addressed.add(key)
  }

  for (const topic of uncovered) {
    if (addressed.has(topic.key)) continue
    plan.push({
      key: `topic:${topic.key}`,
      question: `${topic.label} — как это устроено у вас?`,
      hint: topic.hint,
      topics: [topic.key],
    })
  }

  return plan
}
