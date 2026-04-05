export type RuntimeShift = 'day' | 'night'

export function resolveRuntimeShift(date = new Date()): { date: string; shift: RuntimeShift; afterMidnightNight: boolean } {
  const local = new Date(date)
  const hour = local.getHours()

  if (hour >= 8 && hour < 20) {
    return {
      date: local.toISOString().slice(0, 10),
      shift: 'day',
      afterMidnightNight: false,
    }
  }

  if (hour >= 20) {
    return {
      date: local.toISOString().slice(0, 10),
      shift: 'night',
      afterMidnightNight: false,
    }
  }

  const previous = new Date(local)
  previous.setDate(previous.getDate() - 1)
  return {
    date: previous.toISOString().slice(0, 10),
    shift: 'night',
    afterMidnightNight: true,
  }
}
