// Расчёт начисленной зарплаты административных сотрудников за период.
// Учитывает историю окладов (staff_salary_periods) и даты прихода/увольнения.

export type StaffMeta = {
  id: string
  created_at: string | null
  dismissed_at: string | null
}

export type StaffSalaryPeriod = {
  staff_id: string
  effective_from: string
  monthly_salary: number | string
}

export type StaffAccrualBreakdown = {
  staff_id: string
  amount: number
  segments: Array<{
    from: string
    to: string
    days: number
    monthly_salary: number
  }>
}

export type StaffAccrualResult = {
  perStaff: StaffAccrualBreakdown[]
  total: number
}

function isoToUtcDays(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return Number.NaN
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
}

function utcDaysToIso(days: number): string {
  const date = new Date(days * 86_400_000)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

function daysInMonth(monthStart: string): number {
  const [y, m] = monthStart.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function calculateStaffAccrualForMonth(args: {
  staff: StaffMeta[]
  periods: StaffSalaryPeriod[]
  monthStart: string
  monthEnd: string
}): StaffAccrualResult {
  const { staff, periods, monthStart, monthEnd } = args
  const monthStartDays = isoToUtcDays(monthStart)
  const monthEndDays = isoToUtcDays(monthEnd)
  if (!Number.isFinite(monthStartDays) || !Number.isFinite(monthEndDays) || monthStartDays > monthEndDays) {
    return { perStaff: [], total: 0 }
  }

  const dim = daysInMonth(monthStart)
  if (!dim) return { perStaff: [], total: 0 }

  const periodsByStaff = new Map<string, StaffSalaryPeriod[]>()
  for (const period of periods) {
    const list = periodsByStaff.get(period.staff_id) || []
    list.push(period)
    periodsByStaff.set(period.staff_id, list)
  }
  for (const list of periodsByStaff.values()) {
    list.sort((a, b) => (a.effective_from < b.effective_from ? -1 : a.effective_from > b.effective_from ? 1 : 0))
  }

  const perStaff: StaffAccrualBreakdown[] = []
  let total = 0

  for (const person of staff) {
    const myPeriods = periodsByStaff.get(person.id) || []
    if (myPeriods.length === 0) continue

    const createdDays = person.created_at ? isoToUtcDays(person.created_at.slice(0, 10)) : monthStartDays
    let workStart = Math.max(monthStartDays, Number.isFinite(createdDays) ? createdDays : monthStartDays)
    let workEnd = monthEndDays
    if (person.dismissed_at) {
      const dismissDays = isoToUtcDays(person.dismissed_at.slice(0, 10))
      if (Number.isFinite(dismissDays)) {
        // День увольнения — последний рабочий, оплачивается. После — нет.
        workEnd = Math.min(workEnd, dismissDays)
      }
    }
    if (workStart > workEnd) continue

    const segments: StaffAccrualBreakdown['segments'] = []
    let amount = 0

    for (let i = 0; i < myPeriods.length; i++) {
      const period = myPeriods[i]
      const pStart = isoToUtcDays(period.effective_from)
      if (!Number.isFinite(pStart)) continue
      const pEnd = i + 1 < myPeriods.length
        ? isoToUtcDays(myPeriods[i + 1].effective_from) - 1
        : Number.POSITIVE_INFINITY
      const ovStart = Math.max(pStart, workStart)
      const ovEnd = Math.min(pEnd, workEnd)
      if (ovStart > ovEnd) continue

      const days = ovEnd - ovStart + 1
      const salary = Number(period.monthly_salary) || 0
      const segmentAmount = (days * salary) / dim
      amount += segmentAmount
      segments.push({
        from: utcDaysToIso(ovStart),
        to: utcDaysToIso(ovEnd),
        days,
        monthly_salary: salary,
      })
    }

    if (amount > 0) {
      const rounded = Math.round(amount)
      perStaff.push({ staff_id: person.id, amount: rounded, segments })
      total += rounded
    }
  }

  return { perStaff, total }
}
