// Зарплата административного сотрудника за половину месяца.
//
// Админ-сотрудник получает не по сменам, а оклад двумя выплатами: до 15-го и
// после. Поэтому его карточка считается не по неделе, как у оператора, а по
// «слоту»: половина оклада плюс бонусы минус долги, штрафы и авансы, взятые
// после прошлой выплаты.
//
// Логика жила внутри страницы /salary и была недоступна ни приложению, ни
// API. Из-за этого в телефоне зарплаты админ-сотрудников не было вообще —
// приложение спрашивало /api/admin/salary, а там админы отфильтрованы
// (is_admin_staff = false). Считать те же деньги вторым способом в Swift
// значило бы завести вторую правду: web показывал бы одно, телефон другое.

export type StaffSlot = 'first' | 'second'
export type SlotRange = { from: string; to: string }

export type SlotStaffMember = {
  id: string
  full_name: string
  short_name?: string | null
  role?: string | null
  monthly_salary: number
  source_type?: 'staff' | 'operator' | string
  is_active?: boolean
  dismissed_at?: string | null
  dismissal_date?: string | null
}

export type SlotAdjustment = {
  id: string
  staff_id: string
  kind: 'debt' | 'fine' | 'bonus' | 'advance' | string
  amount: number
  date: string
  comment?: string | null
  status?: string | null
  created_at?: string | null
}

export type SlotPayment = {
  id: string
  staff_id: string
  pay_date: string
  slot?: string | null
  amount: number
  created_at?: string | null
}

/** Границы половины месяца: 1–15 и 16–конец. */
export function getSalarySlotRange(payDate: string, slot: StaffSlot): SlotRange | null {
  const [yearRaw, monthRaw] = String(payDate || '').split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null
  const mm = String(month).padStart(2, '0')
  if (slot === 'first') return { from: `${year}-${mm}-01`, to: `${year}-${mm}-15` }
  const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { from: `${year}-${mm}-16`, to: `${year}-${mm}-${String(endDay).padStart(2, '0')}` }
}

/**
 * Период корректировок для выплаты: от начала слота до дня выплаты.
 *
 * Отсечка именно по дню выплаты, а не по концу слота: штраф, выписанный
 * послезавтра, не должен уменьшать сегодняшнюю сумму в руках.
 */
export function getStaffPaymentAdjustmentPeriod(payDate: string, slot: StaffSlot): SlotRange | null {
  const slotRange = getSalarySlotRange(payDate, slot)
  if (!slotRange) return null
  const payDateValue = String(payDate || '')
  const cutoff = /^\d{4}-\d{2}-\d{2}$/.test(payDateValue) ? payDateValue : slotRange.to
  return { from: slotRange.from, to: cutoff }
}

/** В какую половину месяца попадает дата. */
export function slotForDate(isoDate: string): StaffSlot {
  const day = Number(String(isoDate || '').slice(8, 10))
  return Number.isFinite(day) && day <= 15 ? 'first' : 'second'
}

/**
 * Корректировки, которые ещё не закрыты выплатой.
 *
 * Всё, что было до последней выплаты, уже удержано или выдано — показывать это
 * снова значит вычесть один штраф дважды.
 */
export function filterStaffAdjustmentsForSlot<A extends SlotAdjustment, P extends SlotPayment>(
  adjs: A[],
  staffId: string,
  payments: P[],
  period?: SlotRange | null,
): A[] {
  const periodEnd = period?.to || '9999-12-31'
  const lastPayment =
    payments
      .filter((p) => p.staff_id === staffId && String(p.pay_date || '') <= periodEnd)
      .sort((a, b) => {
        const byDate = String(b.pay_date || '').localeCompare(String(a.pay_date || ''))
        if (byDate !== 0) return byDate
        return String(b.created_at || '').localeCompare(String(a.created_at || ''))
      })[0] || null

  return adjs.filter((a) => {
    if (a.staff_id !== staffId || a.status !== 'active') return false
    if (!period) return true
    if (a.date > periodEnd) return false
    if (!lastPayment) return true
    const lastPayDate = String(lastPayment.pay_date || '')
    if (a.date < lastPayDate) return false
    if (a.date > lastPayDate) return true
    if (a.created_at && lastPayment.created_at) {
      return String(a.created_at) > String(lastPayment.created_at)
    }
    if (a.created_at && !lastPayment.created_at) return true
    if (!a.created_at && lastPayment.created_at) return false
    return true
  })
}

function isoToDays(iso: string): number {
  const [y, m, d] = String(iso || '').split('-').map(Number)
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return Number.NaN
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
}

function daysInMonthOf(iso: string): number {
  const [y, m] = String(iso || '').split('-').map(Number)
  if (!Number.isFinite(y) || !Number.isFinite(m)) return 30
  return new Date(Date.UTC(y, m, 0)).getUTCDate() || 30
}

/**
 * Оклад, начисленный за эту половину месяца.
 *
 * Работающему — половина оклада, как и было. Уволенному — только за дни до
 * увольнения включительно: иначе человек, ушедший второго числа, каждый месяц
 * висел бы в ведомости с полным пол-окладом, и владелец либо переплатил бы,
 * либо перестал верить цифре. День увольнения оплачивается — так же считает
 * `calculateStaffAccrualForMonth` для налогов.
 */
export function slotAccrualBase(s: SlotStaffMember, period?: SlotRange | null): number {
  const salary = Number(s.monthly_salary || 0)
  const half = Math.round(salary / 2)
  const dismissed = String(s.dismissal_date || s.dismissed_at || '').slice(0, 10)
  if (!dismissed || !period) return half

  const dismissedDays = isoToDays(dismissed)
  const fromDays = isoToDays(period.from)
  const toDays = isoToDays(period.to)
  if (!Number.isFinite(dismissedDays) || !Number.isFinite(fromDays) || !Number.isFinite(toDays)) return half
  // Ушёл до начала половины — начислять не за что, но долги и бонусы остаются.
  if (dismissedDays < fromDays) return 0
  if (dismissedDays >= toDays) return half

  const worked = dismissedDays - fromDays + 1
  return Math.round((salary * worked) / daysInMonthOf(period.from))
}

export type StaffSlotCalc = {
  half: number
  bonuses: number
  debts: number
  fines: number
  advances: number
  toPay: number
}

export function calcStaffToPay(
  s: SlotStaffMember,
  adjs: SlotAdjustment[],
  payments: SlotPayment[],
  period?: SlotRange | null,
): StaffSlotCalc {
  const active = filterStaffAdjustmentsForSlot(adjs, s.id, payments, period)
  const half = slotAccrualBase(s, period)
  const sumOf = (kind: string) =>
    active.filter((a) => a.kind === kind).reduce((sum, a) => sum + Number(a.amount || 0), 0)
  const bonuses = sumOf('bonus')
  const debts = sumOf('debt')
  const fines = sumOf('fine')
  const advances = sumOf('advance')
  return { half, bonuses, debts, fines, advances, toPay: half + bonuses - debts - fines - advances }
}

export type StaffSalaryRow = StaffSlotCalc & {
  id: string
  name: string
  short_name: string | null
  role: string | null
  monthly_salary: number
  source_type: string
  is_active: boolean
  dismissal_date: string | null
  /** Выплачено за текущий календарный месяц — обе половины вместе. */
  paid_this_month: number
  /** Обе выплаты месяца уже проведены: до следующего месяца платить нечем. */
  month_closed: boolean
  /** Строка самого просителя: сотрудник смотрит зарплату прежде всего свою. */
  is_me: boolean
}

export type StaffSalarySummary = {
  today: string
  slot: StaffSlot
  period: SlotRange | null
  rows: StaffSalaryRow[]
  totals: { toPay: number; paidThisMonth: number; people: number }
}

/**
 * Сводка по всем админ-сотрудникам на сегодняшнюю половину месяца.
 *
 * Уволенных не выбрасываем: с ними чаще всего и остаётся незакрытый расчёт,
 * ради которого в зарплату и заходят.
 */
export function buildStaffSalarySummary(args: {
  staff: SlotStaffMember[]
  adjustments: SlotAdjustment[]
  payments: SlotPayment[]
  today: string
  meStaffId?: string | null
}): StaffSalarySummary {
  const { staff, adjustments, payments, today } = args
  const meStaffId = args.meStaffId ? String(args.meStaffId) : null
  const slot = slotForDate(today)
  const period = getSalarySlotRange(today, slot)
  const monthPrefix = String(today).slice(0, 7)

  const rows: StaffSalaryRow[] = staff.map((s) => {
    const calc = calcStaffToPay(s, adjustments, payments, period)
    const monthPayments = payments.filter(
      (p) => p.staff_id === s.id && String(p.pay_date || '').slice(0, 7) === monthPrefix,
    )
    const paidThisMonth = monthPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0)
    const hasFirst = monthPayments.some((p) => p.slot === 'first')
    const hasSecond = monthPayments.some((p) => p.slot === 'second')
    return {
      ...calc,
      id: String(s.id),
      name: s.full_name,
      short_name: s.short_name || null,
      role: s.role || null,
      monthly_salary: Number(s.monthly_salary || 0),
      source_type: String(s.source_type || 'staff'),
      is_active: s.is_active !== false,
      dismissal_date: (s.dismissal_date || s.dismissed_at || null)?.slice(0, 10) || null,
      paid_this_month: paidThisMonth,
      month_closed: hasFirst && hasSecond,
      is_me: meStaffId ? String(s.id) === meStaffId : false,
    }
  })

  // Работающие сверху, уволенные внизу: их держат в списке ради незакрытого
  // расчёта, но ежедневный вопрос — про тех, кто в штате.
  const ordered = [...rows.filter((r) => r.is_active), ...rows.filter((r) => !r.is_active)]

  return {
    today,
    slot,
    period,
    rows: ordered,
    totals: {
      toPay: ordered.reduce((sum, r) => sum + r.toPay, 0),
      paidThisMonth: ordered.reduce((sum, r) => sum + r.paid_this_month, 0),
      people: ordered.length,
    },
  }
}
