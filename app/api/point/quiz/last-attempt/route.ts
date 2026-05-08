/**
 * Узнать дату последней попытки квиза для оператора.
 * Используется операторской программой чтобы решить — пора показывать тест или нет.
 */

import { NextResponse } from 'next/server'
import { requirePointDevice } from '@/lib/server/point-devices'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(request: Request) {
  const point = await requirePointDevice(request)
  if ('response' in point) return point.response
  const { supabase } = point

  const operatorId = request.headers.get('x-point-operator-id')
  if (!operatorId) return json({ error: 'operator-id-required' }, 400)

  // Берём последнюю успешно пройденную попытку
  const { data, error } = await supabase
    .from('knowledge_quiz_attempts')
    .select('id, completed_at, score, status')
    .eq('operator_id', operatorId)
    .eq('status', 'completed')
    .gte('score', 80)
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return json({ error: 'load-failed', detail: error.message }, 500)

  if (!data) {
    return json({ ok: true, data: { lastPassedAt: null, daysAgo: null, needsQuiz: true } })
  }

  const lastPassedAt = new Date((data as any).completed_at)
  const daysAgo = Math.floor((Date.now() - lastPassedAt.getTime()) / 86_400_000)
  const needsQuiz = daysAgo >= 7

  return json({
    ok: true,
    data: {
      lastPassedAt: (data as any).completed_at,
      lastScore: (data as any).score,
      daysAgo,
      needsQuiz,
    },
  })
}
