type DbErrorLike = {
  code?: string | null
  message?: string | null
  details?: string | null
  hint?: string | null
}

const CONSTRAINT_MESSAGES: Record<string, string> = {
  inventory_suppliers_name_uidx: 'Поставщик с таким названием уже существует.',
  inventory_suppliers_org_bin_iin_uidx: 'Поставщик с таким БИН/ИИН уже существует в этой организации.',
}

/**
 * Технические коды ошибок из SQL-функций инвентаря → человеческие русские сообщения.
 * SQL функции кидают `RAISE EXCEPTION 'inventory-receipt-not-found'` и т.п.;
 * этот словарь переводит для оператора/кассира.
 *
 * Для кодов с динамическими параметрами (вроде `point-sale-showcase-insufficient: товар (showcase: 0, requested: 1)`)
 * матчинг идёт по префиксу.
 */
const INVENTORY_ERROR_PREFIXES: Array<{ prefix: string; message: string | ((rest: string) => string) }> = [
  // Нехватка на витрине — самое частое сообщение для кассы
  {
    prefix: 'point-sale-showcase-insufficient',
    message: (rest) => {
      const m = rest.match(/^:\s*(.+?)\s*\(showcase:\s*([\d.]+),\s*requested:\s*([\d.]+)\)/)
      if (m) return `На витрине недостаточно «${m[1]}»: есть ${m[2]}, нужно ${m[3]}. Сделайте заявку склад → витрина.`
      return 'На витрине недостаточно товара. Сделайте заявку склад → витрина.'
    },
  },
  {
    prefix: 'pos-sale-showcase-insufficient',
    message: (rest) => {
      const m = rest.match(/^:\s*(.+?)\s*\(showcase:\s*([\d.]+),\s*requested:\s*([\d.]+)\)/)
      if (m) return `На витрине недостаточно «${m[1]}»: есть ${m[2]}, нужно ${m[3]}. Сначала пополните витрину со склада.`
      return 'На витрине недостаточно товара. Сначала пополните витрину со склада.'
    },
  },
  {
    prefix: 'point-sale-catalog-insufficient',
    message: (rest) => {
      const m = rest.match(/^:\s*(.+?)\s*\(catalog:\s*([\d.]+),\s*requested:\s*([\d.]+)\)/)
      if (m) return `Недостаточно «${m[1]}» на точке: есть ${m[2]}, нужно ${m[3]}.`
      return 'Недостаточно товара на точке.'
    },
  },
  // Локации
  { prefix: 'inventory-sale-location-not-found', message: 'Витрина точки не настроена. Откройте админку → раздел точки → включите магазин.' },
  { prefix: 'inventory-sale-catalog-location-missing', message: 'Витрина точки не настроена. Откройте админку → раздел точки → включите магазин.' },
  { prefix: 'point-sale-showcase-location-missing', message: 'Витрина точки не настроена. Откройте админку → раздел точки → включите магазин.' },
  { prefix: 'pos-sale-showcase-location-missing', message: 'Витрина точки не настроена. Откройте админку → раздел точки → включите магазин.' },
  { prefix: 'point-sale-catalog-location-missing', message: 'Каталог точки не настроен.' },
  { prefix: 'point-return-showcase-location-missing', message: 'Витрина для этой точки не настроена.' },
  // Склад: общая нехватка
  { prefix: 'inventory-insufficient-stock', message: 'Недостаточно товара на складе.' },
  { prefix: 'inventory-balance-row-not-found', message: 'Остаток не найден.' },
  { prefix: 'inventory-catalog-total-location-missing', message: 'Каталог точки не настроен.' },
  // Приёмка
  { prefix: 'inventory-receipt-items-required', message: 'Добавьте хотя бы одну позицию в приёмку.' },
  { prefix: 'inventory-receipt-invoice-required', message: 'Загрузите файл накладной — без документа приёмка запрещена.' },
  { prefix: 'inventory-receipt-location-not-found', message: 'Локация приёмки не найдена.' },
  { prefix: 'inventory-receipt-line-invalid', message: 'Неверная строка в приёмке (товар или количество не указаны).' },
  { prefix: 'inventory-receipt-not-found', message: 'Приёмка не найдена.' },
  { prefix: 'inventory-receipt-already-cancelled', message: 'Приёмка уже отменена.' },
  { prefix: 'inventory-receipt-cancel-insufficient-stock', message: 'Нельзя отменить: товар уже выдан/продан. Сначала верните его на ту же локацию.' },
  { prefix: 'inventory-receipt-cancel-insufficient-catalog', message: 'Нельзя отменить: товар уже разошёлся по точке.' },
  // Списание
  { prefix: 'inventory-writeoff-items-required', message: 'Добавьте хотя бы одну позицию для списания.' },
  { prefix: 'inventory-writeoff-reason-required', message: 'Укажите причину списания.' },
  { prefix: 'inventory-writeoff-location-not-found', message: 'Локация для списания не найдена.' },
  { prefix: 'inventory-writeoff-line-invalid', message: 'Неверная строка в списании.' },
  { prefix: 'inventory-writeoff-location-type-not-allowed', message: 'Списание можно проводить только со склада или с витрины.' },
  // Ревизия
  { prefix: 'inventory-stocktake-items-required', message: 'Добавьте хотя бы одну позицию в ревизию.' },
  { prefix: 'inventory-stocktake-line-invalid', message: 'Неверная строка в ревизии.' },
  { prefix: 'inventory-stocktake-location-not-found', message: 'Локация ревизии не найдена.' },
  { prefix: 'inventory-stocktake-location-type-not-allowed', message: 'Ревизию можно делать только склада или витрины.' },
  // Заявки
  { prefix: 'inventory-request-not-found', message: 'Заявка не найдена.' },
  { prefix: 'inventory-request-already-decided', message: 'Заявка уже обработана — повторное решение запрещено.' },
  { prefix: 'inventory-request-decision-items-required', message: 'Передайте список позиций для решения по заявке.' },
  { prefix: 'inventory-request-decision-line-missing', message: 'Не для всех позиций заявки указано решение.' },
  { prefix: 'inventory-request-approved-qty-invalid', message: 'Одобренное количество не может быть отрицательным.' },
  { prefix: 'inventory-request-approved-qty-exceeds-requested', message: 'Одобренное количество больше запрошенного.' },
  { prefix: 'inventory-request-not-undecidable', message: 'Эту заявку нельзя откатить — она в неподходящем статусе.' },
  { prefix: 'inventory-request-already-received', message: 'Заявка уже получена точкой — откат запрещён.' },
  { prefix: 'inventory-request-line-invalid', message: 'Неверная строка в заявке.' },
  { prefix: 'inventory-request-items-required', message: 'Заявка не содержит позиций.' },
  // Товары
  { prefix: 'inventory-item-not-found', message: 'Товар не найден.' },
  // Жёсткие правила движений (триггер v2)
  { prefix: 'inventory-movement-validation-sale-from-must-be-showcase', message: 'Продажа должна списываться только с витрины.' },
  { prefix: 'inventory-movement-validation-return-to-must-be-showcase', message: 'Возврат должен зачисляться только на витрину.' },
  { prefix: 'inventory-movement-validation-transfer-w2s', message: 'Перемещение «склад → витрина» — только из склада на витрину.' },
  { prefix: 'inventory-movement-validation-transfer-s2w', message: 'Перемещение «витрина → склад» — только из витрины на склад.' },
  { prefix: 'inventory-movement-validation-reservation-must-be-warehouse', message: 'Резерв создаётся только на складе.' },
  { prefix: 'inventory-movement-validation-reservation-release-must-be-warehouse', message: 'Снятие резерва возможно только на складе.' },
  { prefix: 'inventory-movement-validation-receipt-to-must-be-warehouse-or-showcase', message: 'Приёмка возможна только на склад или витрину.' },
  { prefix: 'inventory-movement-validation-writeoff-from-must-be-warehouse-or-showcase', message: 'Списание возможно только со склада или с витрины.' },
  { prefix: 'inventory-reserved-negative', message: 'Резерв не может быть отрицательным.' },
  { prefix: 'inventory-reservation-exceeds-stock', message: 'Резерв превышает фактический остаток на складе.' },
  { prefix: 'inventory-request-not-receivable', message: 'Заявка в неподходящем статусе для получения.' },
  // POS общие
  { prefix: 'point-sale-items-required', message: 'Добавьте хотя бы одну позицию в чек.' },
  { prefix: 'point-sale-shift-invalid', message: 'Смена должна быть «день» или «ночь».' },
  { prefix: 'point-sale-payment-method-invalid', message: 'Неверный способ оплаты.' },
  { prefix: 'point-sale-payment-invalid', message: 'Сумма оплаты не может быть отрицательной.' },
  { prefix: 'point-sale-kaspi-split-mismatch', message: 'Сумма Безналичный (до/после полуночи) не совпадает с общей суммой Безналичный.' },
  { prefix: 'point-sale-line-invalid', message: 'Неверная строка чека.' },
  { prefix: 'point-sale-unit-price-invalid', message: 'Цена товара не может быть отрицательной.' },
  { prefix: 'point-sale-payment-total-mismatch', message: 'Сумма оплаты не совпадает с суммой чека.' },
  { prefix: 'pos-sale-items-required', message: 'Добавьте хотя бы одну позицию в чек.' },
  { prefix: 'pos-sale-shift-invalid', message: 'Смена должна быть «день» или «ночь».' },
  { prefix: 'pos-sale-payment-method-invalid', message: 'Неверный способ оплаты.' },
  { prefix: 'pos-sale-payment-invalid', message: 'Сумма оплаты не может быть отрицательной.' },
  { prefix: 'pos-sale-kaspi-split-mismatch', message: 'Сумма Безналичный (до/после полуночи) не совпадает с общей суммой Безналичный.' },
  { prefix: 'pos-sale-line-invalid', message: 'Неверная строка чека.' },
  { prefix: 'pos-sale-unit-price-invalid', message: 'Цена товара не может быть отрицательной.' },
  { prefix: 'pos-sale-discount-invalid', message: 'Неверная сумма скидки.' },
  { prefix: 'pos-sale-payment-total-mismatch', message: 'Сумма оплаты не совпадает с суммой чека.' },
  { prefix: 'pos-customer-not-found', message: 'Клиент не найден.' },
  { prefix: 'pos-loyalty-insufficient-points', message: 'Недостаточно бонусных баллов у клиента.' },
  // Возвраты
  { prefix: 'point-return-items-required', message: 'Добавьте хотя бы одну позицию для возврата.' },
  { prefix: 'point-return-sale-required', message: 'Не указана продажа для возврата.' },
  { prefix: 'point-return-sale-not-found', message: 'Продажа для возврата не найдена.' },
  { prefix: 'point-return-shift-invalid', message: 'Смена должна быть «день» или «ночь».' },
  { prefix: 'point-return-payment-method-invalid', message: 'Неверный способ оплаты возврата.' },
  { prefix: 'point-return-payment-method-mismatch', message: 'Способ оплаты возврата должен совпадать со способом оплаты продажи.' },
  { prefix: 'point-return-payment-invalid', message: 'Сумма возврата не может быть отрицательной.' },
  { prefix: 'point-return-kaspi-split-mismatch', message: 'Сумма Безналичный (до/после полуночи) не совпадает с общей суммой Безналичный.' },
  { prefix: 'point-return-line-invalid', message: 'Неверная строка возврата.' },
  { prefix: 'point-return-unit-price-invalid', message: 'Цена товара не может быть отрицательной.' },
  { prefix: 'point-return-item-not-in-sale', message: 'Этого товара не было в указанной продаже.' },
  { prefix: 'point-return-exceeds-sold-qty', message: 'Возвращаемое количество больше проданного.' },
  { prefix: 'point-return-payment-total-mismatch', message: 'Сумма возврата не совпадает с суммой строк.' },
]

function humanizeInventoryError(message: string): string | null {
  // SQL-исключения иногда префиксованы 'pgrst' / 'P0001:' и т.п.; берём содержательную часть.
  // Также RPC-ошибки имеют форму `EXCEPTION-CODE: details`.
  const cleaned = message.trim()
  for (const item of INVENTORY_ERROR_PREFIXES) {
    if (cleaned.startsWith(item.prefix)) {
      const rest = cleaned.slice(item.prefix.length)
      return typeof item.message === 'function' ? item.message(rest) : item.message
    }
    // Также проверим, есть ли в сообщении этот префикс (если ошибка обёрнута)
    if (cleaned.includes(item.prefix)) {
      const idx = cleaned.indexOf(item.prefix)
      const rest = cleaned.slice(idx + item.prefix.length)
      return typeof item.message === 'function' ? item.message(rest) : item.message
    }
  }
  return null
}

export function humanizeDbError(error: unknown, fallback: string): string {
  const err = (error || {}) as DbErrorLike
  const code = String(err.code || '')
  const message = String(err.message || '')
  const details = String(err.details || '')
  const raw = `${message} ${details}`.toLowerCase()

  // Сначала пытаемся распознать наш inventory-код
  const inventoryMessage = humanizeInventoryError(message) || humanizeInventoryError(details)
  if (inventoryMessage) return inventoryMessage

  const constraintMatch = `${message} ${details}`.match(/constraint\s+"([^"]+)"/i)
  const constraint = constraintMatch?.[1] || ''
  if (constraint && CONSTRAINT_MESSAGES[constraint]) {
    return CONSTRAINT_MESSAGES[constraint]
  }

  if (code === '23505' || raw.includes('duplicate key value') || raw.includes('unique constraint')) {
    return 'Такая запись уже существует. Проверьте дубликаты и попробуйте снова.'
  }

  if (code === '23503' || raw.includes('foreign key constraint')) {
    return 'Нельзя выполнить действие: есть связанные записи в системе.'
  }

  if (code === '23514' || raw.includes('check constraint')) {
    return 'Данные не прошли проверку формата. Проверьте поля и повторите.'
  }

  if (code === '23502' || raw.includes('not-null constraint') || raw.includes('null value in column')) {
    // Пытаемся вытащить имя колонки из "null value in column \"X\""
    const colMatch = `${message} ${details}`.match(/column "([^"]+)"/i)
    const col = colMatch?.[1] || ''
    if (col) {
      return `В таблице есть устаревшая обязательная колонка «${col}», которой нет в форме. Сообщите админу — нужна миграция, чтобы её сделать необязательной.`
    }
    return 'Одно из обязательных полей не заполнено. Проверьте форму и попробуйте снова.'
  }

  if (code === '22P02' || raw.includes('invalid input syntax')) {
    return 'Неверный формат данных в одном из полей.'
  }

  if (code === '42501' || raw.includes('permission denied') || raw.includes('row-level security')) {
    return 'Недостаточно прав для выполнения этого действия.'
  }

  if (code === '42703' || raw.includes('column') && raw.includes('does not exist')) {
    return 'В базе нет нужной колонки — скорее всего не применена последняя миграция. Сообщите админу.'
  }

  if (code === '42P01' || raw.includes('relation') && raw.includes('does not exist')) {
    return 'В базе нет нужной таблицы — миграция не применена.'
  }

  return fallback
}
