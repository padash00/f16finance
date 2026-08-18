/**
 * Поток «пришло новое» для чатов.
 *
 * Опрос раз в несколько секунд — это компромисс, который видно глазами:
 * собеседник ответил, а строчка появляется через паузу, и разговор кажется
 * мёртвым. Здесь браузер и приложение держат одно соединение, а сервер сам
 * говорит, когда появилось новое.
 *
 * Сервер всё равно спрашивает базу — но раз в секунду и в одном месте, а не
 * каждым телефоном по отдельности. Для точки с пятью операторами это разница
 * между одним запросом в секунду и пятью.
 *
 * В событии намеренно нет самих сообщений: клиент по сигналу перечитывает ленту
 * своим обычным маршрутом. Иначе разбор ответа пришлось бы держать в двух
 * местах — и однажды они разойдутся.
 *
 * Соединение живёт четыре минуты и закрывается само: у бессерверных функций
 * есть предел, а EventSource переподключается сам.
 */
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const POLL_MS = 1000
const LIFETIME_MS = 4 * 60 * 1000
const HEARTBEAT_MS = 15 * 1000

export async function GET(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response

  const url = new URL(request.url)
  const scope = url.searchParams.get('scope') === 'direct' ? 'direct' : 'team'
  const peerUserId = String(url.searchParams.get('peer') || '').trim()
  const userId = access.user?.id || null

  if (scope === 'direct' && (!peerUserId || !userId)) {
    return new Response('peer required', { status: 400 })
  }

  const orgId = access.activeOrganization?.id || null
  if (scope === 'team' && !orgId) return new Response('no-organization', { status: 400 })

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

  /** Время самого свежего сообщения, доступного этому человеку. */
  async function latestAt(): Promise<string | null> {
    if (scope === 'direct') {
      // Только этот разговор и только его половины: чужая переписка не должна
      // будить чей-то экран.
      const { data } = await supabase
        .from('direct_messages')
        .select('created_at')
        .or(
          `and(sender_user_id.eq.${userId},recipient_user_id.eq.${peerUserId}),` +
            `and(sender_user_id.eq.${peerUserId},recipient_user_id.eq.${userId})`,
        )
        .order('created_at', { ascending: false })
        .limit(1)
      return ((data as any[]) || [])[0]?.created_at || null
    }

    // Скоуп ровно тот же, что у чтения ленты: строго организация. Разойдись
    // они — поток будил бы экран на сообщения, которых человек не увидит.
    const { data } = await supabase
      .from('team_chat_messages')
      .select('created_at')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(1)

    return ((data as any[]) || [])[0]?.created_at || null
  }

  const encoder = new TextEncoder()
  const startedAt = Date.now()
  let cursor = await latestAt()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text))
        } catch {
          /* соединение уже закрыто */
        }
      }

      // Первое событие сразу: клиент узнаёт, что поток жив, и не ждёт минуту
      // тишины, гадая, работает ли он.
      send(`event: ready\ndata: {}\n\n`)

      let lastBeat = Date.now()

      while (Date.now() - startedAt < LIFETIME_MS) {
        if (request.signal.aborted) break

        await new Promise((resolve) => setTimeout(resolve, POLL_MS))
        if (request.signal.aborted) break

        let fresh: string | null = null
        try {
          fresh = await latestAt()
        } catch {
          // Сеть до базы моргнула — не роняем поток из-за одной попытки.
          continue
        }

        if (fresh && fresh !== cursor) {
          cursor = fresh
          send(`event: message\ndata: ${JSON.stringify({ at: fresh })}\n\n`)
        } else if (Date.now() - lastBeat > HEARTBEAT_MS) {
          // Комментарий-пульс: без него посредники рвут «молчащее» соединение.
          send(`: ping\n\n`)
          lastBeat = Date.now()
        }
      }

      send(`event: bye\ndata: {}\n\n`)
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Отключает буферизацию у обратных прокси: с ней события копятся и
      // приходят пачкой, что убивает весь смысл.
      'X-Accel-Buffering': 'no',
    },
  })
}
