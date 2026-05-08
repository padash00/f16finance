/**
 * Единый форматтер событий аудита.
 * Работает на сервере (Telegram-нотификации) и в браузере (страница /logs).
 * Принимает запись из audit_log и возвращает человеческий текст.
 */

export type FormattedEvent = {
  /** Иконка-эмодзи в начале */
  icon: string
  /** Главная строка: что и кто сделал */
  title: string
  /** Дополнительные детали через · */
  details: string[]
  /** Уровень важности (для подсветки в UI и фильтра в TG) */
  severity: 'info' | 'normal' | 'important' | 'critical'
  /** Категория (для фильтра/группировки) */
  category: 'finance' | 'inventory' | 'shifts' | 'staff' | 'system' | 'security' | 'navigation' | 'other'
}

const EMPTY_PAYLOAD: Record<string, unknown> = {}

function num(v: unknown): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

function money(v: unknown): string | null {
  const n = num(v)
  if (!n) return null
  return `${Math.round(n).toLocaleString('ru-RU')} ₸`
}

function moneyOrZero(v: unknown): string {
  return `${Math.round(num(v)).toLocaleString('ru-RU')} ₸`
}

function str(v: unknown): string {
  if (v == null) return ''
  return String(v).trim()
}

function shortDate(v: unknown): string | null {
  if (!v) return null
  try {
    const s = String(v)
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      return new Date(s + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
    }
    return new Date(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
  } catch {
    return String(v)
  }
}

const PAGE_LABELS: Record<string, string> = {
  '/': 'Главная',
  '/dashboard': 'Дашборд',
  '/income': 'Доходы',
  '/expenses': 'Расходы',
  '/reports': 'Отчёты',
  '/profitability': 'Рентабельность',
  '/settings': 'Настройки',
  '/logs': 'Журнал событий',
  '/operators': 'Операторы',
  '/staff': 'Сотрудники',
  '/kaspi-terminal': 'безналичный терминал',
  '/salary': 'Зарплата',
  '/tasks': 'Задачи',
  '/weekly-report': 'Еженедельный отчёт',
  '/store/receipts': 'Приёмки склада',
  '/store/postings': 'Оприходование',
  '/store/warehouse': 'Склад',
  '/store/movements': 'Движения склада',
  '/store/requests': 'Заявки склада',
  '/store/writeoffs': 'Списания',
  '/store/revisions': 'Ревизии',
  '/store/showcase': 'Витрина',
  '/store/catalog': 'Каталог товаров',
  '/point-debts': 'Долги точки',
  '/shifts': 'Смены',
  '/shifts/reports': 'Отчёты смен',
  '/customers': 'Клиенты',
  '/discounts': 'Скидки и промокоды',
  '/categories': 'Категории',
  '/cashflow': 'Движение денег',
  '/forecast': 'Прогноз',
  '/analytics': 'Аналитика',
  '/operator-analytics': 'Аналитика операторов',
}

function pageLabel(path: string): string {
  const cleanPath = path.split('?')[0]
  if (PAGE_LABELS[cleanPath]) return PAGE_LABELS[cleanPath]
  // /shifts/reports/abc-123 → /shifts/reports/...
  const parts = cleanPath.split('/').filter(Boolean)
  if (parts.length >= 2) {
    const prefix = `/${parts[0]}/${parts[1]}`
    if (PAGE_LABELS[prefix]) return `${PAGE_LABELS[prefix]} (детали)`
  }
  if (parts.length >= 1) {
    const prefix = `/${parts[0]}`
    if (PAGE_LABELS[prefix]) return PAGE_LABELS[prefix]
  }
  return cleanPath
}

type Input = {
  entityType: string
  action: string
  payload: Record<string, unknown> | null
  actorLabel: string
}

/**
 * Главная функция: возвращает форматированное событие.
 */
export function formatAuditEvent(input: Input): FormattedEvent {
  const { entityType, action, actorLabel } = input
  const p = input.payload || EMPTY_PAYLOAD
  const et = entityType.toLowerCase()
  const act = action.toLowerCase()
  const next = (p.next as Record<string, unknown>) || EMPTY_PAYLOAD
  const prev = (p.previous as Record<string, unknown>) || EMPTY_PAYLOAD
  const who = actorLabel || 'Кто-то'

  const companyName = str(p.company_name) || str(next.company_name) || str(prev.company_name)
  const pointInfo = companyName ? `точка: ${companyName}` : null

  // ─── Аутентификация ───────────────────────────────────────────────────────
  if (et === 'auth-session') {
    if (act.endsWith('-login') || act === 'login') {
      return {
        icon: '🔓',
        title: `${who} вошёл в систему`,
        details: [],
        severity: 'info',
        category: 'security',
      }
    }
    if (act === 'logout') {
      return {
        icon: '🔒',
        title: `${who} вышел из системы`,
        details: [],
        severity: 'info',
        category: 'security',
      }
    }
  }

  if (et === 'auth-attempt') {
    const email = str(p.email) || who
    if (act === 'failed' || act === 'error') {
      return {
        icon: '⚠️',
        title: `Неудачная попытка входа: ${email}`,
        details: [str(p.ip) ? `IP: ${str(p.ip)}` : ''].filter(Boolean),
        severity: 'important',
        category: 'security',
      }
    }
    return {
      icon: '🔓',
      title: `${email} вошёл в систему`,
      details: [str(p.ip) ? `IP: ${str(p.ip)}` : ''].filter(Boolean),
      severity: 'info',
      category: 'security',
    }
  }

  if (et === 'page-view') {
    const path = str(p.pathname) || str(p.path) || str(p.page)
    return {
      icon: '🧭',
      title: `${who} открыл страницу: ${pageLabel(path)}`,
      details: [path],
      severity: 'info',
      category: 'navigation',
    }
  }

  // ─── Доходы и расходы ─────────────────────────────────────────────────────
  if (et === 'income') {
    const src = act === 'update' ? next : p
    const total = num(src.cash_amount) + num(src.kaspi_amount) + num(src.online_amount) + num(src.card_amount)
    const date = shortDate(src.date)
    const breakdown = [
      money(src.cash_amount) ? `нал ${money(src.cash_amount)}` : '',
      money(src.kaspi_amount) ? `Безналичный ${money(src.kaspi_amount)}` : '',
      money(src.online_amount) ? `Online ${money(src.online_amount)}` : '',
      money(src.card_amount) ? `карта ${money(src.card_amount)}` : '',
    ].filter(Boolean)

    if (act === 'create') {
      return {
        icon: '💰',
        title: `${who} добавил доход ${moneyOrZero(total)}${date ? ` за ${date}` : ''}`,
        details: [...breakdown, pointInfo].filter(Boolean) as string[],
        severity: 'normal',
        category: 'finance',
      }
    }
    if (act === 'create-batch') {
      return {
        icon: '💰',
        title: `${who} добавил пачку доходов: ${num(p.count)} записей`,
        details: [pointInfo].filter(Boolean) as string[],
        severity: 'important',
        category: 'finance',
      }
    }
    if (act === 'update') {
      const oldTotal = num(prev.cash_amount) + num(prev.kaspi_amount) + num(prev.online_amount) + num(prev.card_amount)
      const change = oldTotal !== total ? `${moneyOrZero(oldTotal)} → ${moneyOrZero(total)}` : null
      return {
        icon: '✏️',
        title: `${who} изменил доход${date ? ` за ${date}` : ''}${change ? ` (${change})` : ''}`,
        details: [...breakdown, pointInfo].filter(Boolean) as string[],
        severity: 'important',
        category: 'finance',
      }
    }
    if (act === 'update-online') {
      return {
        icon: '✏️',
        title: `${who} обновил Online: ${money(p.previous) || '—'} → ${money(p.next) || '0 ₸'}${date ? ` за ${date}` : ''}`,
        details: [pointInfo].filter(Boolean) as string[],
        severity: 'normal',
        category: 'finance',
      }
    }
    if (act === 'delete') {
      return {
        icon: '🗑',
        title: `${who} удалил доход${date ? ` за ${date}` : ''}`,
        details: [pointInfo].filter(Boolean) as string[],
        severity: 'important',
        category: 'finance',
      }
    }
  }

  if (et === 'expense') {
    const src = act === 'update' ? next : p
    const total = num(src.cash_amount) + num(src.kaspi_amount)
    const cat = str(src.category)
    const date = shortDate(src.date)
    const catLabel = cat ? `«${cat}»` : ''

    if (act === 'create') {
      return {
        icon: '💸',
        title: `${who} добавил расход ${catLabel} -${moneyOrZero(total)}${date ? ` за ${date}` : ''}`,
        details: [
          money(src.cash_amount) ? `нал ${money(src.cash_amount)}` : '',
          money(src.kaspi_amount) ? `Безналичный ${money(src.kaspi_amount)}` : '',
          str(src.comment) ? `комментарий: ${str(src.comment)}` : '',
          pointInfo,
        ].filter(Boolean) as string[],
        severity: 'normal',
        category: 'finance',
      }
    }
    if (act === 'update') {
      return {
        icon: '✏️',
        title: `${who} изменил расход ${catLabel}${date ? ` за ${date}` : ''}`,
        details: [moneyOrZero(total), pointInfo].filter(Boolean) as string[],
        severity: 'important',
        category: 'finance',
      }
    }
    if (act === 'delete') {
      return {
        icon: '🗑',
        title: `${who} удалил расход ${catLabel}${date ? ` за ${date}` : ''}`,
        details: [pointInfo].filter(Boolean) as string[],
        severity: 'important',
        category: 'finance',
      }
    }
  }

  if (et === 'expense_category') {
    const name = str(p.name) || str(next.name) || str(prev.name)
    if (act === 'create') return finance(`📁 ${who} создал категорию расходов «${name}»`, [pointInfo], 'normal')
    if (act === 'update') return finance(`✏️ ${who} изменил категорию «${name}»`, [pointInfo], 'normal')
    if (act === 'delete') return finance(`🗑 ${who} удалил категорию «${name}»`, [pointInfo], 'important')
  }

  // ─── Зарплата ────────────────────────────────────────────────────────────
  if (et === 'operator-salary-adjustment') {
    const operatorName = str(p.operator_name) || str(next.operator_name) || 'оператору'
    const amount = num(p.amount ?? next.amount)
    const reason = str(p.reason ?? next.reason)
    const sign = amount >= 0 ? '+' : ''
    if (act === 'create') {
      return {
        icon: amount >= 0 ? '🎁' : '⚠️',
        title: `${who} ${amount >= 0 ? 'начислил' : 'удержал'} ${operatorName}: ${sign}${moneyOrZero(amount)}`,
        details: [reason ? `причина: ${reason}` : '', pointInfo].filter(Boolean) as string[],
        severity: 'normal',
        category: 'staff',
      }
    }
    if (act === 'delete') {
      return {
        icon: '🗑',
        title: `${who} удалил корректировку зарплаты ${operatorName}`,
        details: [pointInfo].filter(Boolean) as string[],
        severity: 'important',
        category: 'staff',
      }
    }
  }

  if (et === 'staff-payment' || et === 'salary_payment') {
    const total = num(p.total_amount ?? p.amount)
    const recipient = str(p.staff_name) || str(p.operator_name) || 'сотруднику'
    if (act === 'create') {
      return {
        icon: '💵',
        title: `${who} выплатил зарплату ${recipient}: ${moneyOrZero(total)}`,
        details: [
          money(p.cash_amount) ? `нал ${money(p.cash_amount)}` : '',
          money(p.kaspi_amount) ? `Безналичный ${money(p.kaspi_amount)}` : '',
          str(p.comment) ? `комментарий: ${str(p.comment)}` : '',
          pointInfo,
        ].filter(Boolean) as string[],
        severity: 'important',
        category: 'staff',
      }
    }
    if (act === 'delete') {
      return {
        icon: '🗑',
        title: `${who} удалил выплату зарплаты ${recipient}`,
        details: [moneyOrZero(total), pointInfo].filter(Boolean) as string[],
        severity: 'important',
        category: 'staff',
      }
    }
  }

  if (et === 'operator-salary-rule' || et === 'operator-salary-rule-version' || et === 'operator-salary-seniority-tier') {
    const subj = et === 'operator-salary-seniority-tier' ? 'правило стажа' : 'правило начисления зарплаты'
    if (act === 'create') return staff(`📐 ${who} создал ${subj}`, [pointInfo], 'normal')
    if (act === 'update') return staff(`✏️ ${who} изменил ${subj}`, [pointInfo], 'important')
    if (act === 'delete') return staff(`🗑 ${who} удалил ${subj}`, [pointInfo], 'important')
  }

  if (et === 'operator-salary-week' || et === 'operator-salary-week-payment') {
    const op = str(p.operator_name) || ''
    if (act === 'create') return staff(`📅 ${who} зафиксировал недельную зарплату${op ? ` для ${op}` : ''}`, [pointInfo], 'normal')
    if (act === 'update') return staff(`✏️ ${who} изменил недельную зарплату${op ? ` ${op}` : ''}`, [pointInfo], 'normal')
    if (act === 'delete') return staff(`🗑 ${who} удалил недельную зарплату${op ? ` ${op}` : ''}`, [pointInfo], 'important')
  }

  // ─── Сотрудники, операторы, компании ──────────────────────────────────────
  if (et === 'company') {
    const name = str(p.name) || str(next.name) || str(prev.name)
    if (act === 'create') return system(`🏢 ${who} создал точку «${name}»`, [], 'important')
    if (act === 'update') return system(`✏️ ${who} изменил точку «${name}»`, [], 'normal')
    if (act === 'delete') return system(`🗑 ${who} удалил точку «${name}»`, [], 'critical')
  }

  if (et === 'staff') {
    const name = str(p.full_name) || str(p.name) || str(next.full_name) || str(next.name)
    if (act === 'create') return staff(`👤 ${who} добавил сотрудника «${name}»`, [pointInfo], 'important')
    if (act === 'update') return staff(`✏️ ${who} изменил сотрудника «${name}»`, [pointInfo], 'normal')
    if (act === 'delete') return staff(`🗑 ${who} удалил сотрудника «${name}»`, [pointInfo], 'important')
  }

  if (et === 'staff-account') {
    const name = str(p.full_name) || str(p.email)
    if (act === 'create') return staff(`🔑 ${who} создал учётку сотрудника «${name}»`, [], 'important')
    if (act === 'update') return staff(`✏️ ${who} изменил доступ «${name}»`, [], 'important')
    if (act === 'delete') return staff(`🚫 ${who} отключил учётку «${name}»`, [], 'important')
  }

  if (et === 'staff-adjustment') {
    const name = str(p.staff_name) || 'сотруднику'
    const amount = num(p.amount)
    const sign = amount >= 0 ? '+' : ''
    if (act === 'create') return staff(`${amount >= 0 ? '🎁' : '⚠️'} ${who} ${amount >= 0 ? 'начислил' : 'удержал'} ${name}: ${sign}${moneyOrZero(amount)}`, [str(p.reason) ? `причина: ${str(p.reason)}` : '', pointInfo].filter(Boolean) as string[], 'normal')
    if (act === 'delete') return staff(`🗑 ${who} удалил корректировку ${name}`, [pointInfo].filter(Boolean) as string[], 'important')
  }

  if (et === 'operator') {
    const name = str(p.name) || str(next.name) || str(prev.name)
    if (act === 'create') return staff(`👤 ${who} добавил оператора${name ? ` «${name}»` : ''}`, [pointInfo], 'normal')
    if (act === 'update') return staff(`✏️ ${who} изменил оператора${name ? ` «${name}»` : ''}`, [pointInfo], 'normal')
    if (act === 'delete') return staff(`🗑 ${who} удалил оператора${name ? ` «${name}»` : ''}`, [pointInfo], 'important')
  }

  if (et === 'operator-auth') {
    const name = str(p.operator_name) || str(p.code)
    if (act === 'create') return staff(`🔑 ${who} создал учётку оператора${name ? ` «${name}»` : ''}`, [], 'important')
    if (act === 'update') return staff(`✏️ ${who} изменил учётку оператора${name ? ` «${name}»` : ''}`, [], 'normal')
    if (act === 'delete') return staff(`🚫 ${who} отключил учётку оператора${name ? ` «${name}»` : ''}`, [], 'important')
  }

  if (et === 'operator-company-assignment') {
    const op = str(p.operator_name)
    const co = str(p.company_name)
    return staff(`🔁 ${who} ${act === 'delete' ? 'снял' : 'назначил'} оператора${op ? ` «${op}»` : ''}${co ? ` на «${co}»` : ''}`, [], 'normal')
  }

  if (et === 'operator-career') {
    return staff(`📈 ${who} обновил карьеру оператора`, [pointInfo].filter(Boolean) as string[], 'normal')
  }

  // ─── Смены ────────────────────────────────────────────────────────────────
  if (et === 'shift' || et === 'point_shift') {
    const date = shortDate(p.date)
    if (act === 'create') return shifts(`🌅 ${who} создал смену${date ? ` за ${date}` : ''}`, [pointInfo].filter(Boolean) as string[], 'normal')
    if (act === 'open') return shifts(`▶️ ${who} открыл смену${date ? ` за ${date}` : ''}`, [pointInfo].filter(Boolean) as string[], 'normal')
    if (act === 'close' || act === 'finish') {
      const revenue = num(p.cash_total ?? p.revenue ?? p.total_revenue)
      return shifts(`🌙 ${who} закрыл смену${date ? ` за ${date}` : ''}: выручка ${moneyOrZero(revenue)}`, [
        money(p.cash_total) ? `нал ${money(p.cash_total)}` : '',
        money(p.kaspi_total) ? `Безналичный ${money(p.kaspi_total)}` : '',
        pointInfo,
      ].filter(Boolean) as string[], 'important')
    }
    if (act === 'force-close') return shifts(`⚠️ ${who} принудительно закрыл смену${date ? ` за ${date}` : ''}`, [pointInfo].filter(Boolean) as string[], 'important')
    if (act === 'update') return shifts(`✏️ ${who} изменил смену${date ? ` за ${date}` : ''}`, [pointInfo].filter(Boolean) as string[], 'normal')
    if (act === 'delete') return shifts(`🗑 ${who} удалил смену${date ? ` за ${date}` : ''}`, [pointInfo].filter(Boolean) as string[], 'important')
    if (act === 'purge') return shifts(`💥 ${who} полностью очистил данные смены${date ? ` за ${date}` : ''}`, [pointInfo].filter(Boolean) as string[], 'critical')
  }

  if (et === 'point-shift-report') {
    if (act === 'create' || act === 'submit') return shifts(`📤 ${who} отправил отчёт смены`, [pointInfo].filter(Boolean) as string[], 'normal')
    if (act === 'update') return shifts(`✏️ ${who} изменил отчёт смены`, [pointInfo].filter(Boolean) as string[], 'normal')
  }

  if (et === 'shift-change-request') {
    if (act === 'create') return shifts(`🔁 ${who} запросил замену смены`, [pointInfo].filter(Boolean) as string[], 'normal')
    if (act === 'approve') return shifts(`✅ ${who} одобрил замену смены`, [pointInfo].filter(Boolean) as string[], 'normal')
    if (act === 'reject') return shifts(`❌ ${who} отклонил замену смены`, [pointInfo].filter(Boolean) as string[], 'normal')
  }

  if (et === 'shift-publication' || et === 'shift-week-response') {
    if (act === 'create') return shifts(`📋 ${who} опубликовал график смен`, [pointInfo].filter(Boolean) as string[], 'normal')
    if (act === 'update') return shifts(`✏️ ${who} изменил график смен`, [pointInfo].filter(Boolean) as string[], 'normal')
  }

  // ─── Склад ────────────────────────────────────────────────────────────────
  if (et === 'inventory-receipt') {
    const supplier = str(p.supplier_name)
    const total = num(p.total_amount)
    const itemsCount = num(p.items_count)
    if (act === 'create') {
      return inventory(`📥 ${who} создал приёмку${supplier ? ` от «${supplier}»` : ''}: ${itemsCount} позиций${total ? `, ${moneyOrZero(total)}` : ''}`, [pointInfo].filter(Boolean) as string[], 'important')
    }
    if (act === 'update') return inventory(`✏️ ${who} изменил приёмку${supplier ? ` «${supplier}»` : ''}`, [pointInfo].filter(Boolean) as string[], 'normal')
    if (act === 'cancel') return inventory(`↩️ ${who} отменил приёмку${supplier ? ` «${supplier}»` : ''}`, [pointInfo].filter(Boolean) as string[], 'important')
    if (act === 'post') return inventory(`✅ ${who} провёл приёмку${supplier ? ` «${supplier}»` : ''}`, [pointInfo].filter(Boolean) as string[], 'important')
    if (act === 'delete') return inventory(`🗑 ${who} удалил приёмку${supplier ? ` «${supplier}»` : ''}`, [pointInfo].filter(Boolean) as string[], 'important')
  }

  if (et === 'inventory-receipt-draft') {
    if (act === 'create') return inventory(`📝 ${who} начал черновик приёмки`, [pointInfo].filter(Boolean) as string[], 'info')
    if (act === 'update') return inventory(`✏️ ${who} обновил черновик приёмки`, [pointInfo].filter(Boolean) as string[], 'info')
    if (act === 'delete') return inventory(`🗑 ${who} удалил черновик приёмки`, [pointInfo].filter(Boolean) as string[], 'info')
  }

  if (et === 'inventory-request' || et === 'point-inventory-request') {
    const itemsCount = num(p.items_count)
    const requestedCount = num(p.requested_count)
    if (act === 'create') return inventory(`📨 ${who} создал заявку склад → витрина: ${itemsCount || requestedCount} позиций`, [pointInfo].filter(Boolean) as string[], 'normal')
    if (act === 'decide' || act === 'approve') return inventory(`✅ ${who} одобрил заявку: ${itemsCount} позиций`, [pointInfo].filter(Boolean) as string[], 'normal')
    if (act === 'bulk-approve-full') return inventory(`✅ ${who} одобрил пакет заявок (всех позиций): ${itemsCount}`, [pointInfo].filter(Boolean) as string[], 'normal')
    if (act === 'bulk-approve-partial') return inventory(`⚠️ ${who} одобрил пакет заявок частично: ${itemsCount} позиций`, [pointInfo].filter(Boolean) as string[], 'normal')
    if (act === 'reject') return inventory(`❌ ${who} отклонил заявку`, [pointInfo].filter(Boolean) as string[], 'normal')
    if (act === 'cancel') return inventory(`↩️ ${who} отменил заявку`, [pointInfo].filter(Boolean) as string[], 'normal')
    if (act === 'undecide') return inventory(`↩️ ${who} отменил решение по заявке`, [pointInfo].filter(Boolean) as string[], 'important')
    if (act === 'delete') return inventory(`🗑 ${who} удалил заявку`, [pointInfo].filter(Boolean) as string[], 'important')
  }

  if (et === 'inventory-item' || et === 'inventory-catalog') {
    const name = str(p.name) || str(next.name)
    if (act === 'create') return inventory(`📦 ${who} добавил товар «${name}»`, [pointInfo].filter(Boolean) as string[], 'normal')
    if (act === 'update') return inventory(`✏️ ${who} изменил товар «${name}»`, [pointInfo].filter(Boolean) as string[], 'normal')
    if (act === 'delete') return inventory(`🗑 ${who} удалил товар «${name}»`, [pointInfo].filter(Boolean) as string[], 'important')
    if (act === 'import') return inventory(`📤 ${who} импортировал каталог: ${num(p.count)} позиций`, [pointInfo].filter(Boolean) as string[], 'important')
  }

  if (et === 'inventory-category') {
    const name = str(p.name)
    if (act === 'create') return inventory(`🏷 ${who} создал категорию товаров «${name}»`, [], 'normal')
    if (act === 'update') return inventory(`✏️ ${who} изменил категорию «${name}»`, [], 'normal')
    if (act === 'delete') return inventory(`🗑 ${who} удалил категорию «${name}»`, [], 'normal')
  }

  if (et === 'inventory-stocktake') {
    const total = num(p.total_amount)
    if (act === 'create') return inventory(`📋 ${who} создал ревизию${total ? `: ${moneyOrZero(total)}` : ''}`, [pointInfo].filter(Boolean) as string[], 'important')
    if (act === 'update') return inventory(`✏️ ${who} изменил ревизию`, [pointInfo].filter(Boolean) as string[], 'normal')
    if (act === 'commit' || act === 'approve') return inventory(`✅ ${who} утвердил ревизию`, [pointInfo].filter(Boolean) as string[], 'important')
    if (act === 'cancel') return inventory(`↩️ ${who} отменил ревизию`, [pointInfo].filter(Boolean) as string[], 'important')
    if (act === 'delete') return inventory(`🗑 ${who} удалил ревизию`, [pointInfo].filter(Boolean) as string[], 'important')
  }

  if (et === 'inventory-writeoff') {
    const reason = str(p.reason)
    const total = num(p.total_amount)
    if (act === 'create') return inventory(`📤 ${who} списал товар${total ? ` на ${moneyOrZero(total)}` : ''}${reason ? ` (${reason})` : ''}`, [pointInfo].filter(Boolean) as string[], 'important')
    if (act === 'delete') return inventory(`🗑 ${who} удалил списание`, [pointInfo].filter(Boolean) as string[], 'important')
  }

  if (et === 'inventory-supplier') {
    const name = str(p.name)
    if (act === 'create') return inventory(`🚚 ${who} добавил поставщика «${name}»`, [], 'normal')
    if (act === 'update') return inventory(`✏️ ${who} изменил поставщика «${name}»`, [], 'normal')
    if (act === 'delete') return inventory(`🗑 ${who} удалил поставщика «${name}»`, [], 'normal')
  }

  if (et === 'inventory-warehouse-stock' || et === 'inventory-warehouse-alloc' || et === 'inventory-point-limit') {
    if (act === 'update') return inventory(`✏️ ${who} обновил остаток на складе`, [pointInfo].filter(Boolean) as string[], 'normal')
    if (act === 'create') return inventory(`📦 ${who} создал запись остатка`, [pointInfo].filter(Boolean) as string[], 'normal')
  }

  if (et === 'inventory-consumable-issue' || et === 'inventory-consumption-norm') {
    if (act === 'create') return inventory(`📦 ${who} выдал расходник`, [pointInfo].filter(Boolean) as string[], 'normal')
    if (act === 'update') return inventory(`✏️ ${who} изменил норму расхода`, [pointInfo].filter(Boolean) as string[], 'normal')
  }

  // ─── Долги ────────────────────────────────────────────────────────────────
  if (et === 'debt' || et === 'point-debt' || et === 'point-debt-item') {
    const total = num(p.amount ?? p.total_amount)
    if (act === 'create') return finance(`📒 ${who} зафиксировал долг${total ? ` ${moneyOrZero(total)}` : ''}`, [pointInfo].filter(Boolean) as string[], 'important')
    if (act === 'update') return finance(`✏️ ${who} изменил долг`, [pointInfo].filter(Boolean) as string[], 'normal')
    if (act === 'pay' || act === 'close') return finance(`✅ ${who} закрыл долг${total ? ` ${moneyOrZero(total)}` : ''}`, [pointInfo].filter(Boolean) as string[], 'important')
    if (act === 'delete') return finance(`🗑 ${who} удалил долг`, [pointInfo].filter(Boolean) as string[], 'important')
  }

  if (et === 'supplier_debt' || et === 'supplier_debt_batch') {
    const total = num(p.amount ?? p.total_amount)
    if (act === 'create') return finance(`📒 ${who} добавил долг поставщику${total ? ` ${moneyOrZero(total)}` : ''}`, [pointInfo].filter(Boolean) as string[], 'normal')
    if (act === 'pay') return finance(`✅ ${who} оплатил долг поставщику${total ? ` ${moneyOrZero(total)}` : ''}`, [pointInfo].filter(Boolean) as string[], 'important')
    if (act === 'delete') return finance(`🗑 ${who} удалил долг поставщику`, [pointInfo].filter(Boolean) as string[], 'normal')
  }

  // ─── Продажи на точке ─────────────────────────────────────────────────────
  if (et === 'point-sale') {
    const total = num(p.total_amount)
    if (act === 'create') return finance(`🧾 ${who} оформил продажу: ${moneyOrZero(total)}`, [pointInfo].filter(Boolean) as string[], 'normal')
    if (act === 'cancel') return finance(`↩️ ${who} отменил продажу`, [pointInfo].filter(Boolean) as string[], 'important')
    if (act === 'refund') return finance(`💸 ${who} вернул продажу`, [pointInfo].filter(Boolean) as string[], 'important')
  }

  if (et === 'point-return') {
    const total = num(p.total_amount)
    if (act === 'create') return finance(`💸 ${who} оформил возврат: ${moneyOrZero(total)}`, [pointInfo].filter(Boolean) as string[], 'important')
  }

  if (et === 'point-product') {
    if (act === 'create') return inventory(`📦 ${who} добавил товар точки`, [pointInfo].filter(Boolean) as string[], 'normal')
    if (act === 'update') return inventory(`✏️ ${who} изменил товар точки`, [pointInfo].filter(Boolean) as string[], 'normal')
    if (act === 'delete') return inventory(`🗑 ${who} удалил товар точки`, [pointInfo].filter(Boolean) as string[], 'normal')
  }

  if (et === 'point-project' || et === 'point-rule') {
    if (act === 'create') return system(`📋 ${who} создал правило точки`, [pointInfo].filter(Boolean) as string[], 'normal')
    if (act === 'update') return system(`✏️ ${who} изменил правило точки`, [pointInfo].filter(Boolean) as string[], 'normal')
    if (act === 'delete') return system(`🗑 ${who} удалил правило точки`, [pointInfo].filter(Boolean) as string[], 'normal')
  }

  if (et === 'point-device') {
    if (act === 'create') return system(`📱 ${who} зарегистрировал устройство${str(p.name) ? ` «${str(p.name)}»` : ''}`, [pointInfo].filter(Boolean) as string[], 'important')
    if (act === 'update') return system(`✏️ ${who} изменил устройство`, [pointInfo].filter(Boolean) as string[], 'normal')
    if (act === 'delete') return system(`🗑 ${who} удалил устройство`, [pointInfo].filter(Boolean) as string[], 'important')
    if (act === 'reset-token') return system(`🔄 ${who} сбросил токен устройства`, [pointInfo].filter(Boolean) as string[], 'important')
  }

  if (et === 'point-login') {
    return system(`🔓 ${who} вошёл на точке через POS`, [pointInfo].filter(Boolean) as string[], 'info')
  }

  // ─── Клиенты, скидки, задачи ──────────────────────────────────────────────
  if (et === 'task' || et === 'task-comment') {
    const title = str(p.title) || ''
    if (act === 'create') return system(`✅ ${who} создал задачу${title ? ` «${title}»` : ''}`, [], 'normal')
    if (act === 'update') return system(`✏️ ${who} изменил задачу${title ? ` «${title}»` : ''}`, [], 'normal')
    if (act === 'complete') return system(`✅ ${who} завершил задачу${title ? ` «${title}»` : ''}`, [], 'normal')
    if (act === 'delete') return system(`🗑 ${who} удалил задачу${title ? ` «${title}»` : ''}`, [], 'normal')
  }

  if (et === 'incident') {
    if (act === 'create') return system(`⚠️ ${who} зарегистрировал инцидент`, [pointInfo].filter(Boolean) as string[], 'important')
    if (act === 'update') return system(`✏️ ${who} обновил инцидент`, [pointInfo].filter(Boolean) as string[], 'normal')
    if (act === 'close') return system(`✅ ${who} закрыл инцидент`, [pointInfo].filter(Boolean) as string[], 'normal')
  }

  if (et === 'checklist-item' || et === 'checklist-template' || et === 'checklist_run') {
    if (act === 'create') return system(`📋 ${who} создал чек-лист`, [pointInfo].filter(Boolean) as string[], 'normal')
    if (act === 'update') return system(`✏️ ${who} изменил чек-лист`, [pointInfo].filter(Boolean) as string[], 'normal')
    if (act === 'complete') return system(`✅ ${who} прошёл чек-лист`, [pointInfo].filter(Boolean) as string[], 'normal')
  }

  // ─── База знаний ──────────────────────────────────────────────────────────
  if (et === 'knowledge-article' || et === 'knowledge-category' || et === 'knowledge-center') {
    const title = str(p.title) || str(p.name)
    if (act === 'create') return system(`📚 ${who} добавил в базу знаний${title ? ` «${title}»` : ''}`, [], 'normal')
    if (act === 'update') return system(`✏️ ${who} обновил статью${title ? ` «${title}»` : ''}`, [], 'normal')
    if (act === 'delete') return system(`🗑 ${who} удалил статью${title ? ` «${title}»` : ''}`, [], 'normal')
  }

  if (et === 'knowledge_quiz_attempt') {
    return system(`🎓 ${who} прошёл тест в базе знаний`, [], 'normal')
  }

  // ─── Финансовые модули ────────────────────────────────────────────────────
  if (et === 'profitability-input') {
    const month = str(p.month).slice(0, 7)
    if (act === 'upsert' || act === 'create' || act === 'update') return finance(`📊 ${who} обновил данные ОПиУ за ${month}`, [pointInfo].filter(Boolean) as string[], 'normal')
  }

  if (et === 'kaspi_terminal') {
    const total = num(p.amount)
    if (act === 'create') return finance(`💳 ${who} добавил оборот безналичный терминала: ${moneyOrZero(total)}`, [pointInfo].filter(Boolean) as string[], 'normal')
    if (act === 'update') return finance(`✏️ ${who} изменил оборот безналичный терминала`, [pointInfo].filter(Boolean) as string[], 'normal')
    if (act === 'delete') return finance(`🗑 ${who} удалил запись безналичный терминала`, [pointInfo].filter(Boolean) as string[], 'normal')
  }

  if (et === 'expense_vendor_whitelist' || et === 'expense_wizard') {
    if (act === 'create') return finance(`📋 ${who} добавил вендора в белый список`, [], 'normal')
    if (act === 'update') return finance(`✏️ ${who} обновил вендора`, [], 'normal')
    if (act === 'delete') return finance(`🗑 ${who} удалил вендора`, [], 'normal')
  }

  // ─── Системные ────────────────────────────────────────────────────────────
  if (et === 'system-error') {
    const area = str(p.area)
    const message = str(p.message).slice(0, 120)
    return {
      icon: '🔥',
      title: `Ошибка системы${area ? ` [${area}]` : ''}: ${message}`,
      details: [str(p.scope) ? `сторона: ${str(p.scope)}` : ''].filter(Boolean),
      severity: 'critical',
      category: 'system',
    }
  }

  if (et === 'ai-usage') {
    const endpoint = str(p.endpoint)
    const status = str(p.status)
    return {
      icon: status === 'error' ? '🔥' : '✨',
      title: `${who} использовал ИИ${endpoint ? ` (${endpoint})` : ''}${status === 'error' ? ' — ошибка' : ''}`,
      details: [
        str(p.provider) ? `сервис: ${str(p.provider)}` : '',
        str(p.model) ? `модель: ${str(p.model)}` : '',
        num(p.total_tokens) ? `токенов: ${num(p.total_tokens).toLocaleString('ru-RU')}` : '',
      ].filter(Boolean),
      severity: status === 'error' ? 'important' : 'info',
      category: 'system',
    }
  }

  if (et === 'auth-user') {
    const email = str(p.email) || str(next.email)
    if (act === 'create') return system(`🔑 ${who} создал учётную запись «${email}»`, [], 'important')
    if (act === 'update') return system(`✏️ ${who} обновил учётную запись «${email}»`, [], 'important')
    if (act === 'delete') return system(`🗑 ${who} удалил учётную запись «${email}»`, [], 'critical')
    if (act === 'password-change') return system(`🔐 ${who} сменил пароль${email ? ` для «${email}»` : ''}`, [], 'important')
    if (act === 'role-change') {
      const oldRole = str(prev.role)
      const newRole = str(next.role)
      return system(`👑 ${who} изменил роль${email ? ` «${email}»` : ''}: ${oldRole || '?'} → ${newRole || '?'}`, [], 'critical')
    }
  }

  // ─── Экспорт (новые события + старые алиасы) ─────────────────────────────
  if (et === 'data-export' || et === 'income-export' || et === 'expense-export') {
    const fmt = (str(p.format) || 'xlsx').toUpperCase()
    const subject = str(p.subject) || (et === 'income-export' ? 'доходы' : et === 'expense-export' ? 'расходы' : 'данные')
    const count = num(p.count)
    const period = str(p.period)
    return {
      icon: '📤',
      title: `${who} выгрузил ${subject} в ${fmt}${count ? ` (${count} строк)` : ''}`,
      details: [period ? `период: ${period}` : '', pointInfo].filter(Boolean) as string[],
      severity: 'normal',
      category: 'system',
    }
  }

  if (et === 'operator-chat') {
    if (act === 'message') return system(`💬 ${who} написал в чат`, [pointInfo].filter(Boolean) as string[], 'info')
    return system(`💬 ${who} использовал чат оператора`, [pointInfo].filter(Boolean) as string[], 'info')
  }

  // ─── Fallback ─────────────────────────────────────────────────────────────
  return {
    icon: '📋',
    title: `${who} — ${humanEntityLabel(et)}${act ? ` (${humanActionLabel(act)})` : ''}`,
    details: [pointInfo].filter(Boolean) as string[],
    severity: 'info',
    category: 'other',
  }
}

// Хелперы для категорий событий ───────────────────────────────────────────────
function finance(title: string, details: (string | null | false)[], severity: FormattedEvent['severity']): FormattedEvent {
  return { icon: title.split(' ')[0], title: title.split(' ').slice(1).join(' '), details: details.filter(Boolean) as string[], severity, category: 'finance' }
}
function staff(title: string, details: (string | null | false)[], severity: FormattedEvent['severity']): FormattedEvent {
  return { icon: title.split(' ')[0], title: title.split(' ').slice(1).join(' '), details: details.filter(Boolean) as string[], severity, category: 'staff' }
}
function inventory(title: string, details: (string | null | false)[], severity: FormattedEvent['severity']): FormattedEvent {
  return { icon: title.split(' ')[0], title: title.split(' ').slice(1).join(' '), details: details.filter(Boolean) as string[], severity, category: 'inventory' }
}
function shifts(title: string, details: (string | null | false)[], severity: FormattedEvent['severity']): FormattedEvent {
  return { icon: title.split(' ')[0], title: title.split(' ').slice(1).join(' '), details: details.filter(Boolean) as string[], severity, category: 'shifts' }
}
function system(title: string, details: (string | null | false)[], severity: FormattedEvent['severity']): FormattedEvent {
  return { icon: title.split(' ')[0], title: title.split(' ').slice(1).join(' '), details: details.filter(Boolean) as string[], severity, category: 'system' }
}

const ENTITY_FALLBACK: Record<string, string> = {
  income: 'доход',
  expense: 'расход',
  shift: 'смена',
  staff: 'сотрудник',
  operator: 'оператор',
  company: 'точка',
  task: 'задача',
  'inventory-receipt': 'приёмка',
  'inventory-request': 'заявка склада',
  'inventory-item': 'товар',
  'inventory-stocktake': 'ревизия',
  'inventory-writeoff': 'списание',
  'inventory-supplier': 'поставщик',
  'point-sale': 'продажа',
  'point-return': 'возврат',
  'point-debt': 'долг точки',
  'supplier_debt': 'долг поставщику',
  'staff-payment': 'выплата зарплаты',
  'kaspi_terminal': 'оборот Безналичный',
  'profitability-input': 'ОПиУ',
  'system-error': 'ошибка системы',
  'page-view': 'просмотр страницы',
}

function humanEntityLabel(et: string): string {
  return ENTITY_FALLBACK[et] || et
}

const ACTION_FALLBACK: Record<string, string> = {
  create: 'создание',
  update: 'изменение',
  delete: 'удаление',
  upsert: 'сохранение',
  approve: 'одобрение',
  reject: 'отклонение',
  cancel: 'отмена',
  open: 'открытие',
  close: 'закрытие',
  finish: 'завершение',
  pay: 'оплата',
  refund: 'возврат',
  visit: 'посещение',
  login: 'вход',
  logout: 'выход',
  failed: 'ошибка',
  error: 'ошибка',
  complete: 'выполнено',
  submit: 'отправка',
  import: 'импорт',
  export: 'экспорт',
}

function humanActionLabel(act: string): string {
  return ACTION_FALLBACK[act] || act
}
