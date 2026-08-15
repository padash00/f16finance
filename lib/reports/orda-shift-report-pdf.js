/* eslint-disable */
/**
 * Orda Control — разбор смен и продавцов (A4 книжная).
 *
 * Это не дашборд и не таблица, а отчёт словами: по каждой смене написано, что
 * произошло, почему касса вышла такой, что делал продавец и чему в этих
 * цифрах нельзя доверять. Владелец должен уметь прочитать его вслух
 * управляющему, не переводя ничего с языка модели.
 *
 * Отсюда решения вёрстки:
 *   * книжная ориентация — текст читается столбцом, а не полосой на всю ширину;
 *   * блок смены не рвётся между страницами (page-break-inside: avoid), иначе
 *     вывод оказывался бы отдельно от того, из чего он сложился;
 *   * ничего не обрезается по высоте — лучше лишняя страница, чем «…» на
 *     середине объяснения;
 *   * контекст (погода, праздники, каникулы) стоит рядом с выводом, потому что
 *     половина ответа «почему такая касса» именно в нём.
 *
 * Контракт (data):
 *   meta:     { title, subtitle?, period, generated, brandNote? }
 *   summary:  { kpis:[{label,value,sub?}], notes?:[string], method?:string }
 *   cashiers: [{ name, status, status_hint?, score_text, confidence_text,
 *                shifts, revenue, receipts,
 *                strengths:[string], weaknesses:[string],
 *                verdicts:[{label,count}], metrics:[{label,value,delta_text,tone}] }]
 *   shifts:   [{ date, shift, cashier, verdict, verdict_tone?, score_text,
 *                confidence_text, revenue, expected_revenue, receipts,
 *                expected_receipts, headline, paragraphs:[string],
 *                metrics:[{label,actual,expected,delta_text,tone,reading}],
 *                context:{ weather?, days:[string], periods:[string] },
 *                conclusion, action, caveats:[string] }]
 *   glossary?: [{ term, meaning }]
 */

const esc = (s) =>
  String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))

const nf = (v) =>
  v == null || v === '' || (typeof v === 'number' && !Number.isFinite(v))
    ? '—'
    : Number(Math.round(Number(v))).toLocaleString('ru-RU')

const money = (v) => (v == null ? '—' : `${nf(v)} ₸`)

const toneClass = (tone) => (tone === 'good' ? 'good' : tone === 'bad' ? 'bad' : tone === 'warn' ? 'warn' : 'mut')

// ─── Шапка и подвал ─────────────────────────────────────────────────────────

function pageHead(meta) {
  const sub = [meta.period, meta.subtitle].filter(Boolean).map(esc).join(' · ')
  return `<div class="phead">
    <div class="ph-l">
      <div class="ph-bar"></div>
      <div>
        <div class="ph-title">${esc(meta.title || 'РАЗБОР СМЕН')}</div>
        <div class="ph-sub">${sub}${sub ? ' · ' : ''}сформирован ${esc(meta.generated)}</div>
      </div>
    </div>
    <div class="ph-r">
      <div class="ph-brand">ORDA CONTROL</div>
      <div class="ph-note">${esc(meta.brandNote || '')}</div>
    </div>
  </div>`
}

// ─── Титульная страница ─────────────────────────────────────────────────────

function coverPage(data) {
  const meta = data.meta || {}
  const summary = data.summary || {}
  const kpis = (summary.kpis || []).slice(0, 6)

  const notes = (summary.notes || []).length
    ? `<div class="block">
        <div class="block-t">Что мешало считать точно</div>
        <ul class="list">${summary.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
      </div>`
    : ''

  const method = summary.method
    ? `<div class="method">
        <div class="method-t">Как это считается</div>
        <p>${esc(summary.method)}</p>
      </div>`
    : ''

  return `<section class="page">
    ${pageHead(meta)}
    <div class="cover">
      <h1 class="cover-h">${esc(meta.title || 'Разбор смен')}</h1>
      <div class="cover-sub">${esc(meta.period || '')}</div>

      <div class="kpis">
        ${kpis
          .map(
            (k) => `<div class="kpi">
              <div class="kpi-label">${esc(k.label)}</div>
              <div class="kpi-val">${esc(String(k.value ?? '—'))}</div>
              <div class="kpi-sub">${esc(k.sub || '')}</div>
            </div>`,
          )
          .join('')}
      </div>

      ${notes}
      ${method}
    </div>
  </section>`
}

// ─── Продавцы ───────────────────────────────────────────────────────────────

function cashierCard(c) {
  const verdicts = (c.verdicts || [])
    .filter((v) => v.count > 0)
    .map((v) => `<span class="chip">${esc(v.label)} · ${v.count}</span>`)
    .join('')

  const metrics = (c.metrics || [])
    .map(
      (m) => `<tr>
        <td class="m-l">${esc(m.label)}</td>
        <td class="m-v">${esc(String(m.value ?? '—'))}</td>
        <td class="m-d ${toneClass(m.tone)}">${esc(m.delta_text || '')}</td>
      </tr>`,
    )
    .join('')

  const strengths = (c.strengths || []).length
    ? `<div class="sw"><b class="good">Сильные стороны:</b> ${esc(c.strengths.join(', '))}</div>`
    : ''
  const weaknesses = (c.weaknesses || []).length
    ? `<div class="sw"><b class="warn">Стоит подтянуть:</b> ${esc(c.weaknesses.join(', '))}</div>`
    : ''

  return `<div class="card">
    <div class="card-h">
      <div>
        <div class="card-t">${esc(c.name)}</div>
        <div class="card-s">${esc(c.status)}${c.status_hint ? ` — ${esc(c.status_hint)}` : ''}</div>
      </div>
      <div class="card-r">
        <div class="card-score">${esc(c.score_text || '—')}</div>
        <div class="card-conf">${esc(c.confidence_text || '')}</div>
      </div>
    </div>

    <div class="facts">
      <span>Смен: <b>${nf(c.shifts)}</b></span>
      <span>Чеков: <b>${nf(c.receipts)}</b></span>
      <span>Выручка: <b>${money(c.revenue)}</b></span>
    </div>

    ${verdicts ? `<div class="chips">${verdicts}</div>` : ''}
    ${metrics ? `<table class="mtab">${metrics}</table>` : ''}
    ${strengths}
    ${weaknesses}
  </div>`
}

function cashiersPages(data) {
  const list = data.cashiers || []
  if (list.length === 0) return ''

  // По четыре карточки на страницу: больше не помещается, меньше — пустоты.
  const perPage = 4
  const pages = []
  for (let i = 0; i < list.length; i += perPage) pages.push(list.slice(i, i + perPage))

  return pages
    .map(
      (chunk, i) => `<section class="page">
      ${pageHead(data.meta || {})}
      ${i === 0 ? '<h2 class="h2">Продавцы за период</h2><p class="lead">Оценка человека, а не смены: как он работал с покупателем в среднем по всем своим сменам. Выручка здесь — справка, за неё эта оценка не отвечает.</p>' : ''}
      ${chunk.map(cashierCard).join('')}
    </section>`,
    )
    .join('')
}

// ─── Смены ──────────────────────────────────────────────────────────────────

function shiftBlock(s) {
  const paragraphs = (s.paragraphs || []).map((p) => `<p class="p">${esc(p)}</p>`).join('')

  const metrics = (s.metrics || [])
    .map(
      (m) => `<div class="metric">
        <div class="metric-h">
          <span class="metric-l">${esc(m.label)}</span>
          <span class="metric-d ${toneClass(m.tone)}">${esc(m.delta_text || '—')}</span>
        </div>
        <div class="metric-n">было ${esc(String(m.actual ?? '—'))} · обычно бывает ${esc(String(m.expected ?? '—'))}</div>
        ${m.reading ? `<div class="metric-r">${esc(m.reading)}</div>` : ''}
      </div>`,
    )
    .join('')

  const ctx = s.context || {}
  const ctxItems = []
  if (ctx.weather) ctxItems.push(`<li><b>Погода.</b> ${esc(ctx.weather)}</li>`)
  for (const d of ctx.days || []) ctxItems.push(`<li><b>Календарь.</b> ${esc(d)}</li>`)
  for (const p of ctx.periods || []) ctxItems.push(`<li><b>Учёба.</b> ${esc(p)}</li>`)
  const context = ctxItems.length
    ? `<div class="ctx">
        <div class="ctx-t">Обстановка в этот день</div>
        <ul class="list">${ctxItems.join('')}</ul>
        <div class="ctx-n">Обстановка объясняет, сколько людей зашло. На оценку продавца она не влияет.</div>
      </div>`
    : `<div class="ctx"><div class="ctx-t">Обстановка в этот день</div>
        <div class="ctx-n">Ни погоды, ни праздников, ни учебных периодов. Значит, кассу нечем объяснить, кроме работы.</div>
      </div>`

  const caveats = (s.caveats || []).length
    ? `<div class="caveats">
        <div class="caveats-t">Где выводу нельзя доверять</div>
        <ul class="list">${s.caveats.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
      </div>`
    : ''

  return `<div class="shift">
    <div class="shift-h">
      <div class="shift-when">
        <span class="shift-date">${esc(s.date)}</span>
        <span class="shift-part">${esc(s.shift)}</span>
        <span class="shift-who">${esc(s.cashier || 'без продавца')}</span>
      </div>
      <div class="shift-badges">
        <span class="pill ${toneClass(s.verdict_tone)}">${esc(s.verdict)}</span>
        <span class="pill mut">${esc(s.score_text || '—')}</span>
        <span class="pill mut">${esc(s.confidence_text || '')}</span>
      </div>
    </div>

    <div class="shift-nums">
      <div><span>Касса</span><b>${money(s.revenue)}</b><i>обычно ${money(s.expected_revenue)}</i></div>
      <div><span>Покупателей</span><b>${nf(s.receipts)}</b><i>обычно ${nf(s.expected_receipts)}</i></div>
    </div>

    ${s.headline ? `<div class="shift-head">${esc(s.headline)}</div>` : ''}
    ${paragraphs}
    ${context}

    ${metrics ? `<div class="metrics"><div class="metrics-t">Что видно по работе с покупателем</div>${metrics}</div>` : ''}

    <div class="verdict">
      ${s.conclusion ? `<div><b>Что это значит.</b> ${esc(s.conclusion)}</div>` : ''}
      ${s.action ? `<div><b>Что делать.</b> ${esc(s.action)}</div>` : ''}
    </div>
    ${caveats}
  </div>`
}

function shiftsPages(data) {
  const list = data.shifts || []
  if (list.length === 0) {
    return `<section class="page">
      ${pageHead(data.meta || {})}
      <h2 class="h2">Смены</h2>
      <p class="lead">За выбранный период смен нет.</p>
    </section>`
  }

  // Блоки идут потоком, а разрыв страницы им запрещён: так вывод никогда не
  // оторвётся от цифр, из которых он получен. Пустое место внизу страницы —
  // допустимая цена.
  return `<section class="page flow">
    ${pageHead(data.meta || {})}
    <h2 class="h2">Разбор каждой смены</h2>
    <p class="lead">Порядок тот же, что на экране. Каждая смена сравнивается не со средним по году, а с похожими: тот же сезон, тот же день недели, дневная или ночная.</p>
    ${list.map(shiftBlock).join('')}
  </section>`
}

// ─── Словарь ────────────────────────────────────────────────────────────────

function glossaryPage(data) {
  const list = data.glossary || []
  if (list.length === 0) return ''

  return `<section class="page">
    ${pageHead(data.meta || {})}
    <h2 class="h2">Что означают слова в отчёте</h2>
    <div class="gloss">
      ${list
        .map(
          (g) => `<div class="gloss-row">
            <div class="gloss-t">${esc(g.term)}</div>
            <div class="gloss-m">${esc(g.meaning)}</div>
          </div>`,
        )
        .join('')}
    </div>
  </section>`
}

// ─── Стили ──────────────────────────────────────────────────────────────────

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Inter,'Segoe UI',system-ui,sans-serif;color:#0f2038;background:#fff;font-size:10.5px;line-height:1.5}
.page{padding:14mm 14mm 12mm;page-break-after:always}
.page:last-child{page-break-after:auto}
.page.flow{page-break-after:auto}

.phead{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1.5px solid #0f2038;padding-bottom:6px;margin-bottom:12px}
.ph-l{display:flex;gap:8px;align-items:stretch}
.ph-bar{width:4px;border-radius:2px;background:#16a34a}
.ph-title{font-family:Manrope,Inter,sans-serif;font-weight:800;font-size:13px;letter-spacing:.02em;text-transform:uppercase}
.ph-sub{color:#64748b;font-size:9px;margin-top:1px}
.ph-r{text-align:right}
.ph-brand{font-family:Manrope,Inter,sans-serif;font-weight:800;font-size:9px;letter-spacing:.14em;color:#0f2038}
.ph-note{color:#94a3b8;font-size:8px}

.cover{padding-top:14mm}
.cover-h{font-family:Manrope,Inter,sans-serif;font-size:30px;font-weight:800;letter-spacing:-.01em}
.cover-sub{color:#64748b;font-size:12px;margin-top:4px}

.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:16px}
.kpi{border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px}
.kpi-label{font-size:8.5px;text-transform:uppercase;letter-spacing:.08em;color:#64748b}
.kpi-val{font-family:Manrope,Inter,sans-serif;font-size:20px;font-weight:800;margin-top:3px}
.kpi-sub{font-size:9px;color:#64748b;margin-top:1px}

.block{margin-top:16px}
.block-t{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#64748b;margin-bottom:4px}
.method{margin-top:16px;border-left:3px solid #16a34a;background:#f8fafc;padding:8px 12px;border-radius:0 8px 8px 0}
.method-t{font-weight:700;font-size:10px;margin-bottom:2px}

.h2{font-family:Manrope,Inter,sans-serif;font-size:16px;font-weight:800;margin-bottom:3px}
.lead{color:#475569;font-size:9.5px;margin-bottom:10px;max-width:150mm}
.list{padding-left:14px;color:#334155}
.list li{margin-bottom:2px}

.card{border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;margin-bottom:8px;page-break-inside:avoid}
.card-h{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.card-t{font-weight:700;font-size:13px}
.card-s{color:#64748b;font-size:9px;margin-top:1px}
.card-r{text-align:right;white-space:nowrap}
.card-score{font-family:Manrope,Inter,sans-serif;font-weight:800;font-size:13px}
.card-conf{color:#64748b;font-size:8.5px}
.facts{display:flex;gap:14px;margin-top:6px;color:#475569;font-size:9.5px}
.chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.chip{border:1px solid #e2e8f0;border-radius:999px;padding:1px 7px;font-size:8.5px;color:#475569}

.mtab{width:100%;margin-top:6px;border-collapse:collapse}
.mtab td{padding:2px 0;font-size:9.5px;border-bottom:1px solid #f1f5f9}
.m-l{color:#475569}
.m-v{text-align:right;width:26%;font-variant-numeric:tabular-nums}
.m-d{text-align:right;width:22%;font-weight:600;font-variant-numeric:tabular-nums}
.sw{margin-top:5px;font-size:9.5px;color:#334155}

.shift{border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;margin-bottom:8px;page-break-inside:avoid}
.shift-h{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;border-bottom:1px solid #f1f5f9;padding-bottom:5px}
.shift-when{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.shift-date{font-weight:700;font-size:12px;font-variant-numeric:tabular-nums}
.shift-part{color:#64748b;font-size:9.5px}
.shift-who{font-weight:600;font-size:10.5px}
.shift-badges{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end}
.pill{border-radius:999px;padding:1px 8px;font-size:8.5px;font-weight:600;white-space:nowrap}
.pill.good{background:#dcfce7;color:#15803d}
.pill.warn{background:#fef3c7;color:#b45309}
.pill.bad{background:#fee2e2;color:#b91c1c}
.pill.mut{background:#f1f5f9;color:#475569}

.shift-nums{display:flex;gap:18px;margin-top:6px}
.shift-nums div{display:flex;flex-direction:column}
.shift-nums span{font-size:8.5px;text-transform:uppercase;letter-spacing:.06em;color:#64748b}
.shift-nums b{font-family:Manrope,Inter,sans-serif;font-size:14px;font-weight:800;font-variant-numeric:tabular-nums}
.shift-nums i{font-style:normal;font-size:8.5px;color:#94a3b8}

.shift-head{font-weight:700;font-size:11px;margin-top:7px}
.p{margin-top:4px;color:#334155;font-size:9.5px}

.ctx{margin-top:7px;background:#f8fafc;border-radius:8px;padding:7px 9px}
.ctx-t{font-size:8.5px;text-transform:uppercase;letter-spacing:.07em;color:#64748b;margin-bottom:3px}
.ctx-n{font-size:8.5px;color:#94a3b8;margin-top:3px}

.metrics{margin-top:7px}
.metrics-t{font-size:8.5px;text-transform:uppercase;letter-spacing:.07em;color:#64748b;margin-bottom:4px}
.metric{border-left:2px solid #e2e8f0;padding-left:7px;margin-bottom:5px}
.metric-h{display:flex;justify-content:space-between;gap:8px}
.metric-l{font-weight:600;font-size:9.5px}
.metric-d{font-weight:700;font-size:9.5px;font-variant-numeric:tabular-nums}
.metric-n{font-size:8.5px;color:#64748b;font-variant-numeric:tabular-nums}
.metric-r{font-size:9px;color:#475569;margin-top:1px}

.verdict{margin-top:7px;border-top:1px solid #f1f5f9;padding-top:6px;font-size:9.5px;color:#0f2038}
.verdict div{margin-top:2px}
.caveats{margin-top:6px;background:#fffbeb;border-radius:8px;padding:6px 9px}
.caveats-t{font-size:8.5px;text-transform:uppercase;letter-spacing:.07em;color:#b45309;margin-bottom:2px}
.caveats .list{color:#78350f;font-size:9px}

.gloss-row{display:flex;gap:10px;padding:5px 0;border-bottom:1px solid #f1f5f9}
.gloss-t{width:45mm;font-weight:700;font-size:9.5px;flex-shrink:0}
.gloss-m{font-size:9.5px;color:#334155}

.good{color:#15803d}
.warn{color:#b45309}
.bad{color:#b91c1c}
.mut{color:#475569}
`

// ─── Сборка ─────────────────────────────────────────────────────────────────

export function renderShiftReportHTML(data, { fontCss = '' } = {}) {
  const d = data || {}
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<style>${fontCss}${CSS}</style></head><body>
${coverPage(d)}
${cashiersPages(d)}
${shiftsPages(d)}
${glossaryPage(d)}
</body></html>`
}

export const PDF_OPTIONS = {
  landscape: false,
  format: 'A4',
  printBackground: true,
  margin: { top: '0', right: '0', bottom: '0', left: '0' },
}
