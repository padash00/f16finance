/* eslint-disable */
/**
 * Orda Control — премиум PDF-дашборд (A4 landscape).
 *
 * Универсальный движок «как fintech-дашборд»: тёмно-синий header с зелёной полосой,
 * 4 KPI-карточки, сетка 2×2 секций (bars / split / minichart / previewTable),
 * страницы детализации с групп-заголовками по дате, и empty-state.
 *
 * Жёсткая защита вёрстки: страницы фиксированной высоты (overflow:hidden), детализация
 * пагинируется по бюджету строк, групп-заголовок не остаётся сиротой внизу страницы,
 * длинный текст — в одну строку с ellipsis.
 *
 * Контракт (data):
 *   meta: { title, subtitle?, period?, generated, brandNote? }
 *   kpis: [ { label, value, sub?, badge?, tone? } ]              // 4 карточки; value '—' = пусто
 *   sections: [ section x4 ]                                     // 2×2 сетка дашборда
 *   detail?: { title, subtitle?, columns:[{key,label,align?,w?}], groups:[ {label, meta?, total?, rows:[..]} ] }
 *   empty?: { columns:[{label,align?}], message, hint }          // если задано — рисуем empty-state страницу
 *
 * section типы:
 *   { type:'bars',  title, hint?, items:[ {label, amount, ratio(0..1), color?} ] }
 *   { type:'split', title, hint?, parts:[ {label, pct, amount, color}, ... ], accent?:{title,text} }
 *   { type:'minichart', title, hint?, bars:[ {ratio(0..1), peak?} ], footer? }
 *   { type:'previewTable', title, hint?, columns:[{key,label,align?}], rows:[..], moreNote? }
 */

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
const nf = (v) => (v == null || v === '' || (typeof v === 'number' && !Number.isFinite(v))) ? '0' : Number(Math.round(Number(v))).toLocaleString('ru-RU')
const money = (v) => `${nf(v)} тг`
const cell = (v, align) => {
  if (v == null || v === '') return '<i class="z">—</i>'
  if (typeof v === 'object' && v.text != null) return `<span class="pill ${['good', 'warn', 'bad'].includes(v.tone) ? v.tone : 'mut'}">${esc(v.text)}</span>`
  if (typeof v === 'number') return nf(v)
  return esc(v)
}

const BAR_COLORS = ['#84cc16', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#ec4899', '#0ea5e9']

// ─── Header / Footer ──────────────────────────────────────────────────────────
function phead(meta, pageNo, totalPages, altTitle, altSub) {
  const title = altTitle || meta.title || 'ОТЧЁТ'
  const sub = altSub != null ? altSub : [meta.period, meta.subtitle].filter(Boolean).map(esc).join(' · ')
  return `<div class="phead">
    <div class="ph-l"><div class="ph-bar"></div><div>
      <div class="ph-title">${esc(title)}</div>
      <div class="ph-sub">${sub}${sub ? ' · ' : ''}сформирован ${esc(meta.generated)}</div>
    </div></div>
    <div class="ph-r">
      <div class="ph-brand">ORDA CONTROL</div>
      <div class="ph-note">${esc(meta.brandNote || '')}</div>
      <div class="ph-pg">стр. ${pageNo} / ${totalPages}</div>
    </div>
  </div>`
}
const pfoot = (meta) => `<div class="foot">Orda Control · ${esc(meta.title || 'отчёт')} · ${esc(meta.generated)}</div>`

// ─── KPI cards ──────────────────────────────────────────────────────────────
function kpiCards(kpis) {
  const items = (kpis || []).slice(0, 4)
  while (items.length < 4) items.push({ label: '', value: '—' })
  return `<div class="kpis">${items.map((k) => {
    const badge = k.badge ? `<span class="kpi-badge ${k.tone === 'bad' ? 'bad' : ''}">${esc(k.badge)}</span>` : ''
    return `<div class="kpi">
      <div class="kpi-top"><span class="kpi-label">${esc(k.label)}</span>${badge}</div>
      <div class="kpi-val ${k.tone === 'bad' ? 'neg' : ''}">${k.value === '—' ? '—' : esc(String(k.value))}</div>
      <div class="kpi-sub">${esc(k.sub || '')}</div>
    </div>`
  }).join('')}</div>`
}

// ─── Section renderers ────────────────────────────────────────────────────────
function secHead(title, hint) {
  return `<div class="sec-h"><span class="sec-t">${esc(title)}</span>${hint ? `<span class="sec-hint">${esc(hint)}</span>` : ''}</div>`
}
function secBars(s) {
  const items = (s.items || []).slice(0, 6)
  const rows = items.map((it, i) => {
    const w = Math.max(4, Math.min(100, Math.round((it.ratio || 0) * 100)))
    const color = it.color || BAR_COLORS[i % BAR_COLORS.length]
    return `<div class="bar-row">
      <div class="bar-lbl">${esc(it.label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${w}%;background:${color}"></div></div>
      <div class="bar-amt">${esc(it.amount != null ? (typeof it.amount === 'number' ? money(it.amount) : it.amount) : '')}</div>
    </div>`
  }).join('') || `<div class="sec-empty">Нет данных</div>`
  return `<div class="card sec">${secHead(s.title, s.hint)}<div class="bars">${rows}</div></div>`
}
function secSplit(s) {
  const parts = s.parts || []
  const track = parts.map((p) => `<div style="width:${Math.max(0, Math.min(100, Math.round(p.pct || 0)))}%;background:${p.color}"></div>`).join('')
  const nums = parts.map((p) => `<div class="split-col"><div class="split-pct">${Math.round(p.pct || 0)}%</div><div class="split-amt">${esc(p.label)}: ${typeof p.amount === 'number' ? money(p.amount) : esc(p.amount || '')}</div></div>`).join('')
  const accent = s.accent ? `<div class="accent"><div class="accent-t">${esc(s.accent.title)}</div><div class="accent-x">${esc(s.accent.text)}</div></div>` : ''
  return `<div class="card sec">${secHead(s.title, s.hint)}
    <div class="split-track">${track}</div>
    <div class="split-nums">${nums}</div>
    ${accent}</div>`
}
function secMini(s) {
  const bars = (s.bars || []).slice(0, 40)
  const cols = bars.map((b) => {
    const h = Math.max(6, Math.min(100, Math.round((b.ratio || 0) * 100)))
    return `<div class="mini-bar ${b.peak ? 'peak' : ''}" style="height:${h}%"></div>`
  }).join('') || ''
  return `<div class="card sec">${secHead(s.title, s.hint)}
    <div class="mini">${cols}</div>
    ${s.footer ? `<div class="mini-foot">${esc(s.footer)}</div>` : ''}</div>`
}
function secPreview(s) {
  const cols = s.columns || []
  const thead = `<tr>${cols.map((c) => `<th class="${c.align === 'right' ? 'num' : ''}">${esc(c.label)}</th>`).join('')}</tr>`
  const body = (s.rows || []).slice(0, 7).map((r) => `<tr>${cols.map((c) => `<td class="${c.align === 'right' ? 'num' : ''}">${cell(r[c.key], c.align)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="pv-empty">Нет данных</td></tr>`
  const more = s.moreNote ? `<div class="pv-more">${esc(s.moreNote)}</div>` : ''
  return `<div class="card sec">${secHead(s.title, s.hint)}<table class="pv">${thead}${body}</table>${more}</div>`
}
function secNotes(s) {
  const lead = s.lead ? `<div class="notes-lead">${esc(s.lead)}</div>` : ''
  const items = (s.items || []).slice(0, 6).map((t) => `<div class="note-li"><span class="note-dot ${s.tone || ''}"></span><span>${esc(t)}</span></div>`).join('') || `<div class="sec-empty">${esc(s.empty || 'Недостаточно данных')}</div>`
  return `<div class="card sec">${secHead(s.title, s.hint)}${lead}<div class="notes-list">${items}</div></div>`
}
function renderSection(s) {
  if (!s) return `<div class="card sec"></div>`
  if (s.type === 'bars') return secBars(s)
  if (s.type === 'split') return secSplit(s)
  if (s.type === 'minichart') return secMini(s)
  if (s.type === 'previewTable') return secPreview(s)
  if (s.type === 'notes') return secNotes(s)
  return `<div class="card sec">${secHead(s.title || '', s.hint)}<div class="sec-empty">—</div></div>`
}

// ─── Dashboard page ───────────────────────────────────────────────────────────
function dashboardPage(d, pageNo, totalPages) {
  const secs = (d.sections || []).slice(0, 4)
  while (secs.length < 4) secs.push(null)
  return `<div class="page">${phead(d.meta, pageNo, totalPages)}
    <div class="content">
      ${kpiCards(d.kpis)}
      <div class="grid2">${secs.map(renderSection).join('')}</div>
    </div>
    ${pfoot(d.meta)}</div>`
}

// ─── Detail pages (grouped, budget pagination) ─────────────────────────────────
const DETAIL_BUDGET = 22 // строк-юнитов на страницу детализации

function detailPages(d, startPageNo, totalPages) {
  const det = d.detail
  const cols = det.columns || []
  // flatten в линии: либо группы (групп-заголовок + строки), либо плоский список строк.
  const lines = []
  if (det.groups && det.groups.length) {
    for (const g of det.groups) {
      lines.push({ kind: 'group', g })
      for (const r of g.rows || []) lines.push({ kind: 'row', r })
    }
  } else {
    for (const r of det.rows || []) lines.push({ kind: 'row', r })
  }
  if (det.total) lines.push({ kind: 'total', r: det.total })
  // пагинация по бюджету; групп-заголовок не оставляем сиротой в конце страницы
  const pages = []
  let cur = []
  let used = 0
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]
    if (used >= DETAIL_BUDGET) { pages.push(cur); cur = []; used = 0 }
    cur.push(ln)
    used += 1
    // сирота: групп-заголовок стал последним на странице → перенести на следующую
    if (used >= DETAIL_BUDGET && ln.kind === 'group') { cur.pop(); pages.push(cur); cur = [ln]; used = 1 }
  }
  if (cur.length) pages.push(cur)
  if (pages.length === 0) pages.push([])

  const thead = `<tr class="dt-head">${cols.map((c) => `<th class="${c.align === 'right' ? 'num' : ''}" ${c.w ? `style="width:${c.w}"` : ''}>${esc(c.label)}</th>`).join('')}</tr>`
  // групп-строка: label(1) + meta(colspan N-3) + total(colspan 2, справа) = N ячеек
  const metaSpan = Math.max(1, cols.length - 3)
  const totalSpan = cols.length >= 4 ? 2 : 1

  return pages.map((lns, pi) => {
    const rowsHtml = lns.map((ln) => {
      if (ln.kind === 'group') {
        const g = ln.g
        const totalTxt = g.total != null ? (typeof g.total === 'number' ? money(g.total) : g.total) : ''
        return `<tr class="dt-group">
          <td class="g-lbl">${esc(g.label)}</td>
          <td class="g-meta" colspan="${metaSpan}">${esc(g.meta || '')}</td>
          <td class="num g-total" colspan="${totalSpan}">${esc(totalTxt)}</td>
        </tr>`
      }
      const tdFor = (c, v, label0) => {
        let cls = c.align === 'right' ? 'num' : ''
        if (c.signed && typeof v === 'number') cls += v < 0 ? ' neg' : v > 0 ? ' pos' : ''
        return `<td class="${cls}">${label0 != null && v == null ? label0 : cell(v, c.align)}</td>`
      }
      if (ln.kind === 'total') {
        const r = ln.r
        return `<tr class="dt-total">${cols.map((c, i) => tdFor(c, r[c.key], i === 0 ? 'ИТОГО' : null)).join('')}</tr>`
      }
      const r = ln.r
      return `<tr>${cols.map((c) => tdFor(c, r[c.key], null)).join('')}</tr>`
    }).join('') || `<tr><td colspan="${cols.length}" class="dt-empty">Нет данных за период</td></tr>`

    return `<div class="page">${phead(d.meta, startPageNo + pi, totalPages, det.title || 'ДЕТАЛИЗАЦИЯ', det.subtitle)}
      <div class="content">
        <div class="card dt-card"><table class="dt">${thead}${rowsHtml}</table></div>
      </div>
      ${pfoot(d.meta)}</div>`
  })
}

// ─── Empty state page ─────────────────────────────────────────────────────────
function emptyPage(d, pageNo, totalPages) {
  const e = d.empty || {}
  const cols = e.columns || []
  const kpis = (d.kpis || []).slice(0, 4).map((k) => ({ label: k.label, value: '—', sub: 'Нет данных за период' }))
  const thead = `<tr class="dt-head">${cols.map((c) => `<th class="${c.align === 'right' ? 'num' : ''}">${esc(c.label)}</th>`).join('')}</tr>`
  return `<div class="page">${phead(d.meta, pageNo, totalPages, null, 'Пустой шаблон · выберите период')}
    <div class="content">
      ${kpiCards(kpis)}
      <div class="card empty-card">
        <div class="empty-title">${esc(e.message || 'Нет данных за выбранный период')}</div>
        <div class="empty-hint">${esc(e.hint || 'Выберите период или добавьте данные.')}</div>
        <div class="empty-foot">
          <div class="empty-lbl">Будущая детализация</div>
          <table class="dt"><thead>${thead}</thead></table>
        </div>
      </div>
    </div>
    ${pfoot(d.meta)}</div>`
}

// ─── Main ───────────────────────────────────────────────────────────────────
export function renderPremiumHTML(d, { fontCss = '' } = {}) {
  if (d && d.empty) {
    const html = emptyPage(d, 1, 1).replace(/₸/g, '<span class="tg">₸</span>')
    return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${fontCss}\n${CSS}</style></head><body>${html}</body></html>`
  }
  const hasDetail = d.detail && (((d.detail.groups || []).length > 0) || ((d.detail.rows || []).length > 0))
  // считаем кол-во страниц детализации заранее (для нумерации)
  let detailCount = 0
  if (hasDetail) {
    let used = 0, n = 1
    const lines = []
    if (d.detail.groups && d.detail.groups.length) {
      for (const g of d.detail.groups) { lines.push('g'); for (const _ of g.rows || []) lines.push('r') }
    } else {
      for (const _ of d.detail.rows || []) lines.push('r')
    }
    if (d.detail.total) lines.push('r')
    for (let i = 0; i < lines.length; i++) {
      if (used >= DETAIL_BUDGET) { n++; used = 0 }
      used++
      if (used >= DETAIL_BUDGET && lines[i] === 'g') { used = 1 }
    }
    detailCount = lines.length ? n : 0
  }
  const totalPages = 1 + detailCount
  let pagesHtml = dashboardPage(d, 1, totalPages)
  if (hasDetail) pagesHtml += detailPages(d, 2, totalPages).join('')

  const html = pagesHtml.replace(/₸/g, '<span class="tg">₸</span>')
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${fontCss}\n${CSS}</style></head><body>${html}</body></html>`
}

export const PDF_OPTIONS = { landscape: true, format: 'A4', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } }

const CSS = `
*{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
:root{--bg:#F4F7FB;--navy:#0E2340;--navy2:#16315a;--ink:#0f172a;--ink2:#475569;--mut:#94a3b8;--line:#DDE5EF;--band:#f1f5f9;--lime:#a3e635;--green:#16a34a;--red:#dc2626;}
@page{size:A4 landscape;margin:0;}
html,body{font-family:'Inter',system-ui,sans-serif;color:var(--ink);background:var(--bg);}
.tg{font-family:'Inter','Manrope','Noto Sans',sans-serif;}
.page{width:297mm;height:210mm;overflow:hidden;page-break-after:always;display:flex;flex-direction:column;background:var(--bg);padding:34px 40px 0;}
.page:last-child{page-break-after:auto;}
.content{flex:1;display:flex;flex-direction:column;gap:18px;min-height:0;padding-top:18px;}
.foot{margin-top:auto;padding:10px 0 12px;font-size:8.5px;color:#9fb0c6;text-align:center;border-top:1px solid #e4ebf3;}

/* header card */
.phead{background:linear-gradient(110deg,var(--navy),var(--navy2));border-radius:18px;color:#fff;display:flex;justify-content:space-between;align-items:center;padding:20px 28px;}
.ph-l{display:flex;align-items:center;gap:16px;}
.ph-bar{width:6px;height:46px;border-radius:6px;background:var(--lime);}
.ph-title{font-family:'Manrope';font-weight:800;font-size:26px;letter-spacing:.01em;text-transform:uppercase;line-height:1;}
.ph-sub{font-size:10px;color:#9db4d6;margin-top:7px;}
.ph-r{text-align:right;}
.ph-brand{font-family:'Manrope';font-weight:800;font-size:15px;letter-spacing:.34em;color:var(--lime);}
.ph-note{font-size:9.5px;color:#8fa6c9;margin-top:6px;}
.ph-pg{font-size:9.5px;color:#8fa6c9;margin-top:2px;}

/* KPI */
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;}
.kpi{background:#fff;border:1px solid var(--line);border-radius:16px;padding:16px 18px;min-width:0;}
.kpi-top{display:flex;justify-content:space-between;align-items:center;}
.kpi-label{font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);}
.kpi-badge{font-size:8px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#3f6212;background:#ecfccb;border-radius:999px;padding:2px 8px;}
.kpi-badge.bad{color:#7f1d1d;background:#fee2e2;}
.kpi-val{font-family:'Manrope';font-weight:800;font-size:25px;letter-spacing:-.01em;color:var(--ink);margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.kpi-val.neg{color:var(--red);}
.kpi-sub{font-size:9.5px;color:var(--ink2);margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}

/* sections grid */
.grid2{flex:1;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:16px;min-height:0;}
.card{background:#fff;border:1px solid var(--line);border-radius:16px;min-width:0;}
.sec{padding:16px 18px;display:flex;flex-direction:column;min-height:0;overflow:hidden;}
.sec-h{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px;}
.sec-t{font-family:'Manrope';font-weight:800;font-size:13px;color:var(--ink);}
.sec-hint{font-size:9px;color:var(--mut);}
.sec-empty{color:var(--mut);font-size:10px;font-style:italic;}

/* bars */
.bars{display:flex;flex-direction:column;gap:9px;}
.bar-row{display:grid;grid-template-columns:150px 1fr auto;align-items:center;gap:10px;}
.bar-lbl{font-size:10px;color:var(--ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bar-track{height:9px;background:#eef2f7;border-radius:999px;overflow:hidden;}
.bar-fill{height:100%;border-radius:999px;}
.bar-amt{font-family:'Manrope';font-weight:700;font-size:10.5px;text-align:right;white-space:nowrap;}

/* split */
.split-track{display:flex;height:22px;border-radius:999px;overflow:hidden;background:#eef2f7;margin-bottom:14px;}
.split-track>div{height:100%;}
.split-nums{display:flex;gap:24px;}
.split-col{flex:1;min-width:0;}
.split-pct{font-family:'Manrope';font-weight:800;font-size:24px;color:var(--ink);}
.split-amt{font-size:9.5px;color:var(--ink2);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.accent{margin-top:auto;background:#f5f8fc;border:1px solid #e7eef7;border-radius:12px;padding:9px 12px;}
.accent-t{font-size:10px;font-weight:700;color:var(--ink2);}
.accent-x{font-size:9.5px;color:var(--mut);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}

/* minichart */
.mini{flex:1;display:flex;align-items:flex-end;gap:5px;padding:6px 0 4px;min-height:0;}
.mini-bar{flex:1;background:#bfdbfe;border-radius:4px 4px 0 0;min-height:4px;}
.mini-bar.peak{background:#84cc16;}
.mini-foot{font-size:9px;color:var(--mut);margin-top:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}

/* preview table */
.pv{width:100%;border-collapse:collapse;table-layout:fixed;margin-top:2px;}
.pv th{font-size:8px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--mut);padding:0 6px 6px;text-align:left;border-bottom:1px solid var(--line);white-space:nowrap;}
.pv th.num{text-align:right;}
.pv td{font-size:9.5px;padding:4px 6px;border-bottom:1px solid #f4f7fa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pv td.num{text-align:right;font-family:'Manrope';font-weight:700;}
.pv td.pv-empty{text-align:center;color:var(--mut);font-style:italic;padding:14px 0;}
.pv-more{font-size:9px;color:var(--mut);margin-top:7px;font-weight:600;}

/* detail table */
.dt-card{padding:14px 16px;}
.dt{width:100%;border-collapse:collapse;table-layout:fixed;}
.dt th{font-size:8px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--mut);padding:6px 8px;text-align:left;background:#f3f6fb;white-space:nowrap;}
.dt th.num{text-align:right;}
.dt td{font-size:9.5px;padding:6px 8px;border-bottom:1px solid #f1f5f9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;height:22px;}
.dt td.num{text-align:right;font-family:'Manrope';font-weight:700;}
.dt tr.dt-group td{background:#f6f9fd;border-bottom:1px solid #e7eef7;height:24px;}
.dt tr.dt-group .g-lbl{font-family:'Manrope';font-weight:800;font-size:10px;color:var(--ink);}
.dt tr.dt-group .g-meta{font-size:9px;color:var(--ink2);}
.dt tr.dt-group .g-total{font-family:'Manrope';font-weight:800;font-size:10.5px;color:var(--ink);}
.dt td.dt-empty{text-align:center;color:var(--mut);font-style:italic;padding:20px 0;}
.dt tr.dt-total td{font-family:'Manrope';font-weight:800;background:#eef3fa;border-top:1.5px solid #cbd5e1;border-bottom:none;height:24px;}
.dt td.neg{color:var(--red);}
.dt td.pos{color:var(--green);}
.pill{display:inline-block;font-size:8.5px;font-weight:800;letter-spacing:.02em;border-radius:999px;padding:2px 8px;white-space:nowrap;}
.pill.good{color:#166534;background:#dcfce7;}
.pill.warn{color:#9a3412;background:#ffedd5;}
.pill.bad{color:#991b1b;background:#fee2e2;}
.pill.mut{color:#475569;background:#eef2f7;}
.pv td .pill{font-size:8px;}

/* notes (AI-блоки) */
.notes-lead{font-size:10.5px;color:var(--ink);line-height:1.5;margin-bottom:10px;font-weight:600;}
.notes-list{display:flex;flex-direction:column;gap:7px;overflow:hidden;}
.note-li{display:flex;gap:8px;align-items:flex-start;font-size:9.5px;color:var(--ink2);line-height:1.35;}
.note-li span:last-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.note-dot{flex:none;width:6px;height:6px;border-radius:999px;margin-top:4px;background:#3b82f6;}
.note-dot.bad{background:#ef4444;}
.note-dot.good{background:#16a34a;}
.note-dot.warn{background:#f59e0b;}

/* empty state */
.empty-card{flex:1;display:flex;flex-direction:column;padding:24px 26px;min-height:0;}
.empty-title{font-family:'Manrope';font-weight:800;font-size:24px;color:var(--navy);text-align:center;margin-top:auto;}
.empty-hint{font-size:11px;color:var(--ink2);text-align:center;margin-top:8px;margin-bottom:auto;}
.empty-foot{margin-top:14px;}
.empty-lbl{font-family:'Manrope';font-weight:800;font-size:12px;color:var(--ink);margin-bottom:8px;}
.z{color:#cbd5e1;font-style:normal;}
`
