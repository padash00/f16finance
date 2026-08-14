import { NextResponse } from 'next/server'

import { generateAiText } from '@/lib/ai/provider'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { listOrganizationCompanyIds } from '@/lib/server/organizations'
import { createAdminSupabaseClient } from '@/lib/server/supabase'
import { getRequestAccessContext, requireStaffCapabilityRequest } from '@/lib/server/request-auth'

export const runtime = 'nodejs'
export const maxDuration = 300

const MAX_FILE_SIZE = 8 * 1024 * 1024
/** Кусок для одного запроса к модели. Больше — модель начинает терять разделы. */
const CHUNK_CHARS = 9000

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

/** Docx читаем на сервере: у клиента файл может быть в общей папке, а не на его машине. */
async function extractText(file: File): Promise<string> {
  const name = file.name.toLowerCase()
  const buffer = Buffer.from(await file.arrayBuffer())

  if (name.endsWith('.docx')) {
    const mammoth = await import('mammoth')
    // convertToMarkdown есть в рантайме, но отсутствует в типах пакета:
    // markdown нужен, чтобы заголовки документа стали границами разделов.
    const converter = (mammoth as any).convertToMarkdown || (mammoth as any).default?.convertToMarkdown
    if (typeof converter === 'function') {
      const result = await converter({ buffer })
      const value = String(result?.value || '')
      if (value.trim()) return value
    }
    const fallback = await mammoth.extractRawText({ buffer })
    return String(fallback.value || '')
  }

  if (name.endsWith('.md') || name.endsWith('.txt')) {
    return buffer.toString('utf-8')
  }

  throw new Error('Поддерживаются .docx, .md и .txt')
}

/**
 * Режем документ по заголовкам, а не по символам: раздел «Тарифы Arena» должен
 * попасть в модель целиком, иначе половина таблицы уедет в соседний запрос.
 */
function splitIntoChunks(text: string): string[] {
  const lines = text.split(/\r?\n/)
  const chunks: string[] = []
  let current: string[] = []
  let size = 0

  const flush = () => {
    const body = current.join('\n').trim()
    if (body) chunks.push(body)
    current = []
    size = 0
  }

  for (const line of lines) {
    const isHeading = /^#{1,3}\s/.test(line)
    if (isHeading && size > CHUNK_CHARS * 0.6) flush()
    current.push(line)
    size += line.length + 1
    if (size > CHUNK_CHARS) flush()
  }
  flush()

  return chunks.length ? chunks : [text.slice(0, CHUNK_CHARS)]
}

const SYSTEM_PROMPT = `Ты разбираешь внутренний регламент компании на материалы базы знаний.

Верни СТРОГО JSON без пояснений:
{
  "articles": [
    {
      "title": "короткий заголовок",
      "category": "название категории",
      "summary": "одно предложение сути",
      "content": "<p>текст в простом HTML: p, ul, li, strong, table</p>",
      "severity": "info|normal|warning|critical",
      "requires_confirmation": true|false,
      "tags": ["тег"],
      "point": "название точки из текста или null"
    }
  ],
  "checklists": [
    {
      "title": "название",
      "description": "зачем",
      "schedule_type": "opening|periodic|closing|onboarding|handover",
      "recurrence_minutes": 120,
      "blocks_shift": true|false,
      "point": "название точки или null",
      "items": [{ "title": "проверка", "answer_type": "boolean|text|number|photo|choice", "is_required": true, "requires_photo": false }]
    }
  ]
}

Правила разбора:
- Одна статья = один смысловой раздел. Не дроби на абзацы и не склеивай разные темы.
- Сохраняй цифры, суммы, тарифы, ID оборудования и время как в оригинале. Ничего не выдумывай.
- severity: "critical" для денег, недостач, доступа и безопасности; "warning" для нарушений с последствиями; иначе "normal".
- requires_confirmation: true для правил об ответственности, деньгах, штрафах и конфиденциальности.
- "point": заполняется ТОЛЬКО когда раздел явно про одну точку — её название стоит в заголовке
  («F16 Arena», «Extra», «Ramen») или текст говорит о её оборудовании и тарифах. Общие правила
  смены, кассы, опозданий, штрафов и безопасности действуют на всех точках — у них point = null.
  Не приписывай точку по догадке: сомневаешься — ставь null.
- Списки проверок и приложения с отметками — это checklists, а не статьи.
- Если таблица перечисляет проверки по нескольким точкам сразу (столбец на точку), сделай
  ОТДЕЛЬНЫЙ чек-лист на каждую точку и проставь ей point, а не один общий список.
- blocks_shift: true для чек-листа закрытия и приёма смены.
- Пустые массивы допустимы. Не добавляй ничего от себя.`

type ParsedArticle = {
  title?: string
  category?: string
  summary?: string
  content?: string
  severity?: string
  requires_confirmation?: boolean
  tags?: string[]
  point?: string | null
}

type ParsedChecklist = {
  title?: string
  description?: string
  schedule_type?: string
  recurrence_minutes?: number | null
  blocks_shift?: boolean
  point?: string | null
  items?: Array<{ title?: string; answer_type?: string; is_required?: boolean; requires_photo?: boolean }>
}

function parseModelJson(text: string): { articles: ParsedArticle[]; checklists: ParsedChecklist[] } {
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return { articles: [], checklists: [] }
  try {
    const data = JSON.parse(cleaned.slice(start, end + 1))
    return {
      articles: Array.isArray(data.articles) ? data.articles : [],
      checklists: Array.isArray(data.checklists) ? data.checklists : [],
    }
  } catch {
    return { articles: [], checklists: [] }
  }
}

/** Тот же slug, что и при записи, — иначе «уже есть» и «пропущено» разойдутся. */
function slugify(value: string) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
  return slug || `item-${Date.now()}`
}

/** Сопоставляем «точку» из текста с реальной компанией организации по вхождению слов. */
function matchCompany(pointName: string | null | undefined, companies: Array<{ id: string; name: string }>) {
  const hint = String(pointName || '').trim().toLowerCase()
  if (!hint) return null
  const exact = companies.find((c) => c.name.toLowerCase() === hint)
  if (exact) return exact.id
  const partial = companies.find(
    (c) => hint.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(hint),
  )
  if (partial) return partial.id
  // «Arena» в тексте против «F16 Arena» в системе: сверяем по последнему слову.
  const word = hint.split(/\s+/).filter(Boolean).pop() || ''
  if (word.length >= 4) {
    const byWord = companies.find((c) => c.name.toLowerCase().includes(word))
    if (byWord) return byWord.id
  }
  return null
}

type CompanyRef = { id: string; name: string }

/** Приведение статей модели к виду превью: одно место правды для обоих шагов. */
function normalizeArticles(
  raw: ParsedArticle[],
  companies: CompanyRef[],
  existing: Map<string, number>,
  offset = 0,
) {
  const seen = new Set<string>()
  return raw
    .filter((item) => String(item.title || '').trim())
    .filter((item) => {
      const key = String(item.title).trim().toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((item, index) => {
      const title = String(item.title).trim()
      const slug = slugify(title)
      return {
        key: `article-${offset}-${index}`,
        title,
        category: String(item.category || 'Регламент').trim(),
        summary: String(item.summary || '').trim(),
        content: String(item.content || '').trim(),
        severity: ['info', 'normal', 'warning', 'critical'].includes(String(item.severity))
          ? String(item.severity)
          : 'normal',
        requires_confirmation: item.requires_confirmation === true,
        tags: Array.isArray(item.tags) ? item.tags.map(String).slice(0, 8) : [],
        point: item.point || null,
        company_id: matchCompany(item.point, companies),
        exists: existing.has(slug),
        existing_version: existing.get(slug) || null,
      }
    })
}

/** То же для чек-листов. */
function normalizeChecklists(raw: ParsedChecklist[], companies: CompanyRef[], offset = 0) {
  return raw
    .filter((item) => String(item.title || '').trim() && Array.isArray(item.items) && item.items.length > 0)
    .map((item, index) => ({
      key: `checklist-${offset}-${index}`,
      title: String(item.title).trim(),
      description: String(item.description || '').trim(),
      schedule_type: ['opening', 'periodic', 'closing', 'onboarding', 'handover'].includes(String(item.schedule_type))
        ? String(item.schedule_type)
        : 'opening',
      recurrence_minutes: Number(item.recurrence_minutes) > 0 ? Math.round(Number(item.recurrence_minutes)) : null,
      blocks_shift: item.blocks_shift === true,
      point: item.point || null,
      company_id: matchCompany(item.point, companies),
      items: (item.items || [])
        .filter((row) => String(row.title || '').trim())
        .map((row) => ({
          title: String(row.title).trim(),
          answer_type: ['boolean', 'text', 'number', 'photo', 'choice'].includes(String(row.answer_type))
            ? String(row.answer_type)
            : 'boolean',
          is_required: row.is_required !== false,
          requires_photo: row.requires_photo === true,
        })),
    }))
}

/** Разбор документа. Ничего не пишет в базу — возвращает предпросмотр. */
export async function POST(request: Request) {
  try {
    const guard = await requireStaffCapabilityRequest(request, 'staff')
    if (guard) return guard
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'knowledge-admin.create')
    if (denied) return denied

    // Второй шаг: клиент присылает один кусок текста и получает его разбор.
    // Так на экране идёт «разобрано 3 из 7», а не бесконечная крутилка.
    const contentType = request.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      const body = (await request.json().catch(() => null)) as { chunk?: string; offset?: number } | null
      const chunk = String(body?.chunk || '').trim()
      if (!chunk) return json({ error: 'Пустой фрагмент' }, 400)

      const supabaseForChunk = createAdminSupabaseClient()
      const allowedForChunk = await listOrganizationCompanyIds({
        activeOrganizationId: access.activeOrganization?.id || null,
        isSuperAdmin: access.isSuperAdmin,
      })
      let chunkCompaniesQuery = supabaseForChunk.from('companies').select('id, name').order('name')
      if (allowedForChunk) {
        if (allowedForChunk.length === 0) return json({ error: 'У организации нет точек' }, 400)
        chunkCompaniesQuery = chunkCompaniesQuery.in('id', allowedForChunk)
      }
      const { data: chunkCompanies } = await chunkCompaniesQuery
      const companyList = (chunkCompanies || []).map((row: any) => ({ id: String(row.id), name: String(row.name) }))

      const result = await generateAiText({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: chunk },
        ],
        maxTokens: 4000,
      })
      const parsed = parseModelJson(result.text)

      const orgScopeForChunk = access.activeOrganization?.id
        ? `organization_id.is.null,organization_id.eq.${access.activeOrganization.id}`
        : null
      let existingChunkQuery = supabaseForChunk.from('knowledge_articles').select('slug, version')
      if (orgScopeForChunk) existingChunkQuery = existingChunkQuery.or(orgScopeForChunk)
      const { data: existingChunkRows } = await existingChunkQuery
      const existingChunk = new Map(
        (existingChunkRows || []).map((row: any) => [String(row.slug), Number(row.version || 1)]),
      )

      const offset = Number(body?.offset || 0)
      return json({
        ok: true,
        data: {
          articles: normalizeArticles(parsed.articles, companyList, existingChunk, offset),
          checklists: normalizeChecklists(parsed.checklists, companyList, offset),
        },
      })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return json({ error: 'Файл обязателен' }, 400)
    if (file.size > MAX_FILE_SIZE) return json({ error: 'Максимальный размер файла — 8 МБ' }, 400)

    const text = (await extractText(file)).trim()
    if (text.length < 200) return json({ error: 'В файле почти нет текста — проверьте документ' }, 400)

    const supabase = createAdminSupabaseClient()

    const allowedCompanyIds = await listOrganizationCompanyIds({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    let companiesQuery = supabase.from('companies').select('id, name').order('name')
    if (allowedCompanyIds) {
      if (allowedCompanyIds.length === 0) return json({ error: 'У организации нет точек' }, 400)
      companiesQuery = companiesQuery.in('id', allowedCompanyIds)
    }
    const { data: companiesData, error: companiesError } = await companiesQuery
    if (companiesError) throw companiesError
    const companies = (companiesData || []).map((row: any) => ({ id: String(row.id), name: String(row.name) }))

    // Куски отдаём клиенту: он разберёт их по одному и покажет прогресс.
    const chunks = splitIntoChunks(text)

    return json({
      ok: true,
      data: {
        file_name: file.name,
        chars: text.length,
        chunks,
        companies,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/knowledge/import:post',
      message: error?.message || 'Knowledge import error',
    })
    return json({ error: error?.message || 'Не удалось разобрать документ' }, 500)
  }
}
