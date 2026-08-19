import { NextResponse } from 'next/server'

import { getRequestOperatorContext } from '@/lib/server/request-auth'

/**
 * Проверка учётной записи оператора сразу после входа.
 *
 * Форма входа делала это сама: после `signInWithPassword` она читала из базы
 * `operator_auth` и `operators` и решала, пускать ли человека. Решение о
 * доступе, принятое в браузере, — это не решение: изменённый клиент просто не
 * задаёт себе этих вопросов, а сессия к тому моменту уже выдана.
 *
 * Здесь те же два условия проверяет сервер: запись входа активна (иначе
 * контекст оператора не соберётся) и сам оператор не отключён. Ответ короткий:
 * пускать или нет, и как зовут — большего форме знать не нужно.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const context = await getRequestOperatorContext(request)
  if ('response' in context) return context.response

  return NextResponse.json({
    ok: true,
    // `authId` нужен форме, чтобы отметить время входа тем же роутом, что и
    // раньше: он сверяет запись с сессией, так что подставить чужую нельзя.
    authId: String((context.operatorAuth as any)?.id || ''),
    operatorId: String((context.operatorAuth as any)?.operator_id || ''),
    username: (context.operatorAuth as any)?.username || null,
  })
}
