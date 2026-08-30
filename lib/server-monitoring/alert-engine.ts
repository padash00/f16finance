import type { AlertSeverity, MonitorObservation } from '@/lib/server-monitoring/protocol'

export type AlertTransition = 'none' | 'open' | 'escalate' | 'deescalate' | 'recover'

export type AlertDecision = {
  rawState: AlertSeverity
  nextState: AlertSeverity
  nextNormalStreak: number
  transition: AlertTransition
}

export function classifyObservation(observation: MonitorObservation): AlertSeverity {
  const { value, direction, warningThreshold, criticalThreshold } = observation
  if (direction === 'high') {
    if (value >= criticalThreshold) return 'critical'
    if (warningThreshold !== null && value >= warningThreshold) return 'warning'
    return 'normal'
  }

  if (value <= criticalThreshold) return 'critical'
  if (warningThreshold !== null && value <= warningThreshold) return 'warning'
  return 'normal'
}

export function classifyWithHysteresis(
  observation: MonitorObservation,
  currentState: AlertSeverity,
): AlertSeverity {
  if (currentState === 'normal') return classifyObservation(observation)

  const { value, direction, warningThreshold, criticalThreshold, hysteresis } = observation
  if (direction === 'high') {
    if (currentState === 'critical' && value >= criticalThreshold - hysteresis) return 'critical'
    if (currentState === 'warning' && value >= criticalThreshold) return 'critical'
    if (warningThreshold !== null && value >= warningThreshold - hysteresis) return 'warning'
    return 'normal'
  }

  if (currentState === 'critical' && value <= criticalThreshold + hysteresis) return 'critical'
  if (currentState === 'warning' && value <= criticalThreshold) return 'critical'
  if (warningThreshold !== null && value <= warningThreshold + hysteresis) return 'warning'
  return 'normal'
}

export function decideAlertTransition(params: {
  observation: MonitorObservation
  currentState: AlertSeverity
  normalStreak: number
  recoverySamples: number
}): AlertDecision {
  const rawState = classifyObservation(params.observation)
  const targetState = classifyWithHysteresis(params.observation, params.currentState)

  if (targetState === 'normal' && params.currentState !== 'normal') {
    const nextNormalStreak = Math.min(100, params.normalStreak + 1)
    if (nextNormalStreak < params.recoverySamples) {
      return { rawState, nextState: params.currentState, nextNormalStreak, transition: 'none' }
    }
    return { rawState, nextState: 'normal', nextNormalStreak: 0, transition: 'recover' }
  }

  if (targetState === params.currentState) {
    return { rawState, nextState: targetState, nextNormalStreak: 0, transition: 'none' }
  }
  if (params.currentState === 'normal') {
    return { rawState, nextState: targetState, nextNormalStreak: 0, transition: 'open' }
  }
  if (targetState === 'critical') {
    return { rawState, nextState: targetState, nextNormalStreak: 0, transition: 'escalate' }
  }
  return { rawState, nextState: targetState, nextNormalStreak: 0, transition: 'deescalate' }
}
