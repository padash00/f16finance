/**
 * Генерация формы 910.00 (ФНО) — упрощённая декларация для ИП на упрощёнке (КЗ 2026).
 *
 * Принимает данные из /tax UI (период, оборот, ставка, ИИН/БИН, ФИО) и
 * формирует Excel-файл с заполненными ключевыми полями. Файл потом отправляется
 * бухгалтеру / переносится в cabinet.salyk.kz.
 */

import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { requireCapability } from '@/lib/server/capabilities'
import { getRequestAccessContext } from '@/lib/server/request-auth'

export const runtime = 'nodejs'

interface Body {
  period?: { from: string; to: string }
  bin?: string
  oked?: string
  companyFullName?: string
  iknRate?: number  // 2..6
  revenue?: number  // налогооблагаемый оборот за полугодие
  ipnAmount?: number  // ИПН = revenue * iknRate / 100
  socialAmount?: number  // соцплатежи "за себя"
  totalAmount?: number  // итого
}

const MRP_2026 = 4_325
const MZP_2026 = 85_000
const SOCIAL_FIXED_MONTHLY = 21_675

function fmt(v: number) {
  return Math.round(v).toLocaleString('ru-RU').replace(/,/g, ' ')
}

function periodLabel(from: string, to: string): string {
  const fromYear = from.slice(0, 4)
  const fromMonth = Number(from.slice(5, 7))
  const half = fromMonth <= 6 ? 1 : 2
  return `${half === 1 ? '1' : '2'} полугодие ${fromYear}`
}

export async function POST(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response
  // Налоговая форма 910 — финансовый документ. Нет отдельной capability →
  // роль-гейт: владелец/менеджер/суперадмин (операторы/гости отсекаются).
  if (!access.isSuperAdmin && access.staffRole !== 'owner' && access.staffRole !== 'manager') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const denied = await requireCapability(access, 'tax.view')
  if (denied) return denied

  const body = (await request.json().catch(() => null)) as Body | null
  if (!body?.period?.from || !body?.period?.to) {
    return NextResponse.json({ error: 'period required' }, { status: 400 })
  }

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Orda Control'
  wb.created = new Date()
  const ws = wb.addWorksheet('ФНО 910.00')

  ws.columns = [
    { width: 8 },
    { width: 70 },
    { width: 30 },
  ]

  // Шапка
  ws.mergeCells('A1:C1')
  const title = ws.getCell('A1')
  title.value = 'ФНО 910.00 — Упрощённая декларация для субъектов малого бизнеса'
  title.font = { bold: true, size: 14 }
  title.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(1).height = 30

  ws.mergeCells('A2:C2')
  const subtitle = ws.getCell('A2')
  subtitle.value = `Налоговый период: ${periodLabel(body.period.from, body.period.to)} (${body.period.from} — ${body.period.to})`
  subtitle.font = { italic: true, size: 11, color: { argb: 'FF555555' } }
  subtitle.alignment = { horizontal: 'center' }

  ws.addRow([])

  // Раздел 1: данные налогоплательщика
  let row = 4
  function section(title: string) {
    ws.mergeCells(`A${row}:C${row}`)
    const c = ws.getCell(`A${row}`)
    c.value = title
    c.font = { bold: true, size: 12, color: { argb: 'FF1E40AF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } }
    c.alignment = { horizontal: 'left', vertical: 'middle' }
    ws.getRow(row).height = 24
    row++
  }
  function field(code: string, name: string, value: string | number) {
    ws.getCell(`A${row}`).value = code
    ws.getCell(`A${row}`).font = { bold: true, color: { argb: 'FF666666' } }
    ws.getCell(`B${row}`).value = name
    ws.getCell(`C${row}`).value = value
    ws.getCell(`C${row}`).alignment = { horizontal: 'right' }
    if (typeof value === 'number') {
      ws.getCell(`C${row}`).numFmt = '#,##0'
      ws.getCell(`C${row}`).font = { bold: true, color: { argb: 'FF065F46' } }
    }
    row++
  }

  section('РАЗДЕЛ I. Данные налогоплательщика')
  field('001', 'ИИН/БИН', body.bin || '________________')
  field('002', 'Ф.И.О. (наименование) налогоплательщика', body.companyFullName || '________________________________________')
  field('003', 'Налоговый период (полугодие)', periodLabel(body.period.from, body.period.to))
  field('004', 'Категория налогоплательщика', 'ИП на упрощённой декларации')
  field('005', 'Признак резидентства', 'Резидент РК')
  field('006', 'ОКЭД', body.oked || '93290')

  section('РАЗДЕЛ II. Расчёт суммы ИПН')
  field('010', 'Доход, облагаемый ИПН (тенге)', body.revenue || 0)
  field('011', 'Ставка ИПН (%)', `${body.iknRate || 4}%`)
  field('012', 'Сумма исчисленного ИПН (010 × 011)', body.ipnAmount || 0)
  field('013', 'Корректировка (если есть)', 0)
  field('014', 'ИТОГО ИПН к уплате', body.ipnAmount || 0)

  section('РАЗДЕЛ III. Социальные платежи "за себя" (информационно)')
  field('020', 'МЗП на 2026', MZP_2026)
  field('021', 'ОПВ (10% от МЗП × мес)', Math.round(MZP_2026 * 0.10) * 6)
  field('022', 'ОПВР (3.5% от МЗП × мес)', Math.round(MZP_2026 * 0.035) * 6)
  field('023', 'СО (5% от МЗП × мес)', Math.round(MZP_2026 * 0.05) * 6)
  field('024', 'ВОСМС (7% от МЗП × мес)', Math.round(MZP_2026 * 0.07) * 6)
  field('025', 'ИТОГО соцплатежи за полугодие', body.socialAmount || SOCIAL_FIXED_MONTHLY * 6)

  section('РАЗДЕЛ IV. Итого к уплате')
  field('030', 'ИПН по упрощёнке', body.ipnAmount || 0)
  field('031', 'Соцплатежи "за себя"', body.socialAmount || 0)
  field('032', 'ИТОГО к уплате', body.totalAmount || 0)

  // Footer
  row += 2
  ws.mergeCells(`A${row}:C${row}`)
  ws.getCell(`A${row}`).value = `Документ сгенерирован автоматически в Orda Control · ${new Date().toLocaleString('ru-RU')}`
  ws.getCell(`A${row}`).font = { italic: true, size: 9, color: { argb: 'FF999999' } }
  ws.getCell(`A${row}`).alignment = { horizontal: 'center' }

  row++
  ws.mergeCells(`A${row}:C${row}`)
  ws.getCell(`A${row}`).value = 'Внимание: это вспомогательный шаблон. Официальная форма подаётся в cabinet.salyk.kz'
  ws.getCell(`A${row}`).font = { italic: true, size: 9, color: { argb: 'FFAA0000' } }
  ws.getCell(`A${row}`).alignment = { horizontal: 'center' }

  // Generate
  const buffer = await wb.xlsx.writeBuffer()
  const filename = `FNO_910_${body.period.from}_${body.period.to}.xlsx`

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
