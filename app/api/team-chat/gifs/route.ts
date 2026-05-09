/**
 * Поиск GIF через Tenor API (бесплатно с Google API key).
 * GET /api/team-chat/gifs?q=happy → топ-20 GIF
 * GET /api/team-chat/gifs?trending=1 — популярные сейчас
 *
 * Требует ENV: TENOR_API_KEY (бесплатный, https://developers.google.com/tenor/guides/quickstart)
 * Без ключа возвращает пустой массив.
 */

import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'

export const runtime = 'nodejs'

type TenorResult = {
  id: string
  media_formats: {
    tinygif?: { url: string; dims: number[] }
    gif?: { url: string; dims: number[] }
    mediumgif?: { url: string }
    nanomp4?: { url: string }
  }
  content_description?: string
}

export async function GET(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response

  const apiKey = process.env.TENOR_API_KEY
  if (!apiKey) {
    return NextResponse.json({ gifs: [], hint: 'TENOR_API_KEY не настроен' })
  }

  const url = new URL(request.url)
  const q = url.searchParams.get('q')?.trim() || ''
  const trending = url.searchParams.get('trending')

  const endpoint = trending || !q
    ? `https://tenor.googleapis.com/v2/featured?key=${apiKey}&client_key=ordaops&limit=24&media_filter=tinygif,gif`
    : `https://tenor.googleapis.com/v2/search?key=${apiKey}&client_key=ordaops&q=${encodeURIComponent(q)}&limit=24&media_filter=tinygif,gif&locale=ru_RU`

  try {
    const resp = await fetch(endpoint, { cache: 'no-store' })
    if (!resp.ok) {
      return NextResponse.json({ gifs: [], error: `Tenor ${resp.status}` })
    }
    const json = (await resp.json()) as { results?: TenorResult[] }
    const gifs = (json.results || []).map((r) => ({
      id: r.id,
      previewUrl: r.media_formats.tinygif?.url || r.media_formats.gif?.url || '',
      url: r.media_formats.gif?.url || r.media_formats.mediumgif?.url || '',
      width: r.media_formats.gif?.dims?.[0] || 240,
      height: r.media_formats.gif?.dims?.[1] || 200,
      title: r.content_description || '',
    })).filter((g) => g.url)

    return NextResponse.json({ gifs })
  } catch (e: any) {
    return NextResponse.json({ gifs: [], error: e?.message || 'fetch failed' })
  }
}
