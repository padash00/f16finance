// Деньги по операторам за период: оборот, смены, удержания, чистый итог.
//
// Считалось это в браузере: страница аналитики ходила в Supabase напрямую за
// доходами, корректировками и долгами и складывала их на месте. Из-за этого
// цифр не было в приложении (у сервера их просто не спрашивали), фильтр по
// организации жил в браузере, а право «Аналитика операторов» на эти данные не
// проверялось вовсе — их отдавала база, а не роут.
//
// Здесь чистая функция: на входе строки, на выходе готовые числа. Одна правда
// на сайт и на телефон.

export type AnalyticsIncome = {
  date: string
  company_id: string
  shift?: string | null
  operator_id?: string | null
  cash_amount?: number | string | null
  kaspi_amount?: number | string | null
  online_amount?: number | string | null
  card_amount?: number | string | null
}

export type AnalyticsAdjustment = {
  operator_id: string
  kind: string
  amount?: number | string | null
}

export type AnalyticsDebt = {
  operator_id: string
  amount?: number | string | null
}

export type OperatorMoneyRow = {
  operator_id: string
  /** Сколько денег прошло через его смены. */
  turnover: number
  cash: number
  kaspi: number
  online: number
  card: number
  /** Отдельных смен — дата плюс тип смены плюс точка. */
  shifts: number
  /** Календарных дней с выручкой. */
  days: number
  /** Средняя смена: главный вопрос к оператору, а не общий оборот. */
  avg_per_shift: number
  /** Доля в обороте всех операторов за период. */
  share: number
  /** Долги, начисленные системой (недостачи, списания). */
  auto_debts: number
  /** Ручные удержания: штрафы. */
  manual_minus: number
  /** Ручные начисления: премии. */
  manual_plus: number
  advances: number
  /** Что премии и удержания сделали с его расчётом. Аванс сюда не входит: он
   *  не наказание и не награда, а выданные вперёд свои же деньги. */
  net_effect: number
}

export type OperatorMoneyTotals = {
  turnover: number
  unattributed_turnover: number
  auto_debts: number
  manual_minus: number
  manual_plus: number
  advances: number
}

function money(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export function buildOperatorMoney(args: {
  incomes: AnalyticsIncome[]
  adjustments: AnalyticsAdjustment[]
  debts: AnalyticsDebt[]
  /** Операторы, которых показываем. Прочие идут в «не распределено». */
  operatorIds: string[]
}): { rows: OperatorMoneyRow[]; totals: OperatorMoneyTotals } {
  const allowed = new Set(args.operatorIds)
  const rows = new Map<string, OperatorMoneyRow>()
  const days = new Map<string, Set<string>>()
  const shifts = new Map<string, Set<string>>()

  const totals: OperatorMoneyTotals = {
    turnover: 0,
    unattributed_turnover: 0,
    auto_debts: 0,
    manual_minus: 0,
    manual_plus: 0,
    advances: 0,
  }

  const ensure = (id: string): OperatorMoneyRow | null => {
    if (!allowed.has(id)) return null
    let row = rows.get(id)
    if (!row) {
      row = {
        operator_id: id,
        turnover: 0,
        cash: 0,
        kaspi: 0,
        online: 0,
        card: 0,
        shifts: 0,
        days: 0,
        avg_per_shift: 0,
        share: 0,
        auto_debts: 0,
        manual_minus: 0,
        manual_plus: 0,
        advances: 0,
        net_effect: 0,
      }
      rows.set(id, row)
      days.set(id, new Set())
      shifts.set(id, new Set())
    }
    return row
  }

  for (const income of args.incomes) {
    const cash = money(income.cash_amount)
    const kaspi = money(income.kaspi_amount)
    const online = money(income.online_amount)
    const card = money(income.card_amount)
    const total = cash + kaspi + online + card
    if (total <= 0) continue

    const row = income.operator_id ? ensure(String(income.operator_id)) : null
    if (!row) {
      // Смена без оператора — не ошибка: так бывает у виртуальных доходов и у
      // уволенных. Но и приписывать её кому-то нельзя.
      totals.unattributed_turnover += total
      continue
    }

    row.turnover += total
    row.cash += cash
    row.kaspi += kaspi
    row.online += online
    row.card += card
    totals.turnover += total

    days.get(row.operator_id)!.add(String(income.date))
    shifts
      .get(row.operator_id)!
      .add(`${income.date}|${income.shift || 'na'}|${income.company_id}`)
  }

  for (const debt of args.debts) {
    // Сумму проверяем до создания строки: иначе нулевая запись заводит
    // оператора в список, и он висит там с прочерками во всех столбцах.
    const amount = money(debt.amount)
    if (amount <= 0) continue
    const row = ensure(String(debt.operator_id))
    if (!row) continue
    row.auto_debts += amount
    totals.auto_debts += amount
  }

  for (const adjustment of args.adjustments) {
    const amount = money(adjustment.amount)
    if (amount <= 0) continue
    const row = ensure(String(adjustment.operator_id))
    if (!row) continue

    if (adjustment.kind === 'bonus') {
      row.manual_plus += amount
      totals.manual_plus += amount
    } else if (adjustment.kind === 'advance') {
      row.advances += amount
      totals.advances += amount
    } else {
      row.manual_minus += amount
      totals.manual_minus += amount
    }
  }

  const result = [...rows.values()].map((row) => {
    row.days = days.get(row.operator_id)?.size || 0
    row.shifts = shifts.get(row.operator_id)?.size || 0
    row.avg_per_shift = row.shifts > 0 ? row.turnover / row.shifts : 0
    row.share = totals.turnover > 0 ? row.turnover / totals.turnover : 0
    row.net_effect = row.manual_plus - row.manual_minus - row.auto_debts
    return row
  })

  result.sort((a, b) => b.turnover - a.turnover)
  return { rows: result, totals }
}
