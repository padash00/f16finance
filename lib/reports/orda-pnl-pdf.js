/* eslint-disable */
/**
 * Orda Control — ОПиУ развёрнуто, одна страница на срез (A4 portrait).
 *
 * Страница = общий отчёт или одна точка: все строки ОПиУ раскрыты до статей,
 * рядом прошлый месяц и изменение. Если статей много, страница ужимается
 * (zoom), а не переносится — каждый срез ровно на одном листе.
 *
 * Контракт (data):
 *   meta: { title, period, generated }
 *   pages: [ {
 *     title, subtitle?, note?,
 *     curLabel, prevLabel?,                       // заголовки колонок месяцев
 *     kpis: [ { label, value, sub?, tone? } ],    // tone: 'good' | 'bad' | ''
 *     rows: [ {
 *       kind: 'line' | 'part' | 'total' | 'final' | 'sep',
 *       label, cur?, share?, prev?, delta?,       // уже отформатированные строки
 *       curTone?, deltaTone?, expense?
 *     } ]
 *   } ]
 */

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
const toneCls = (t) => (t === 'good' || t === 'bad' ? t : '')

function header(meta, page, pageNo, total) {
  const sub = [meta.period, page.subtitle].filter(Boolean).map(esc).join(' · ')
  return `<header>
    <div class="h-l"><div class="h-kicker">${esc(meta.title || 'ОПиУ')}</div>
      <div class="h-title">${esc(page.title)}</div>
      <div class="h-sub">${sub}${sub ? ' · ' : ''}сформирован ${esc(meta.generated)}</div></div>
    <div class="h-r"><div class="h-brand">ORDA CONTROL</div><div class="h-pg">стр. ${pageNo} / ${total}</div></div>
  </header>`
}

function kpis(items) {
  if (!items || !items.length) return ''
  return `<div class="kpis">${items
    .map(
      (k) => `<div class="kpi"><div class="k-l">${esc(k.label)}</div><div class="k-v ${toneCls(k.tone)}">${esc(k.value)}</div>${
        k.sub ? `<div class="k-s ${toneCls(k.subTone)}">${esc(k.sub)}</div>` : ''
      }</div>`,
    )
    .join('')}</div>`
}

function table(page) {
  const hasPrev = Boolean(page.prevLabel)
  const cols = hasPrev ? 5 : 3
  const head = `<thead><tr><th>Статья</th><th class="num">${esc(page.curLabel)}</th><th class="num">% выручки</th>${
    hasPrev ? `<th class="num">${esc(page.prevLabel)}</th><th class="num">Изменение</th>` : ''
  }</tr></thead>`
  const body = (page.rows || [])
    .map((r) => {
      if (r.kind === 'sep') return `<tr class="sep"><td colspan="${cols}">${esc(r.label)}</td></tr>`
      const cls = r.kind === 'line' && r.expense ? 'line exp' : r.kind
      return `<tr class="${cls}"><td class="lbl">${esc(r.label)}</td><td class="num cur ${toneCls(r.curTone)}">${esc(r.cur)}</td><td class="num shr">${esc(r.share)}</td>${
        hasPrev ? `<td class="num prv">${esc(r.prev)}</td><td class="num dlt ${toneCls(r.deltaTone)}">${esc(r.delta)}</td>` : ''
      }</tr>`
    })
    .join('')
  return `<table class="pnl">${head}<tbody>${body}</tbody></table>`
}

// Ужать содержимое страницы, если не влезает в лист. Перезапускается после
// загрузки шрифтов — у них другая ширина и высота строк.
const FIT_SCRIPT = `<script>
(function(){
  function fit(){
    document.querySelectorAll('.page').forEach(function(p){
      var box=p.querySelector('.body'), c=p.querySelector('.content');
      if(!box||!c) return;
      var cs=getComputedStyle(box), z=1;
      var avail=box.clientHeight-parseFloat(cs.paddingTop)-parseFloat(cs.paddingBottom);
      c.style.zoom='1';
      // Высота при zoom меняется не строго пропорционально — ужимаем шагами до влезания
      while(z>0.45&&c.getBoundingClientRect().height>avail){ z-=0.02; c.style.zoom=String(z); }
    });
  }
  fit();
  if(document.fonts&&document.fonts.ready) document.fonts.ready.then(fit);
})();
</script>`

export function renderPnlHTML(d, { fontCss = '' } = {}) {
  const pages = d.pages || []
  const total = pages.length
  const html = pages
    .map(
      (p, i) => `<div class="page">${header(d.meta || {}, p, i + 1, total)}<div class="body"><div class="content">
        ${kpis(p.kpis)}
        <div class="card">${table(p)}</div>
        ${p.note ? `<div class="note">${esc(p.note)}</div>` : ''}
      </div></div><div class="foot">Orda Control · ${esc(d.meta?.title || 'ОПиУ')} · ${esc(d.meta?.period || '')}</div></div>`,
    )
    .join('')
    .replace(/₸/g, '<span class="tg">₸</span>')
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${fontCss}\n${CSS}</style></head><body>${html}${FIT_SCRIPT}</body></html>`
}

export const PDF_OPTIONS = { format: 'A4', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } }

const CSS = `
*{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
:root{--navy:#0c1a2e;--navy2:#13294a;--ink:#0f172a;--ink2:#475569;--mut:#94a3b8;--line:#e8edf3;--band:#f6f8fb;--lime:#a3e635;--good:#047857;--bad:#e11d48;}
@page{size:A4;margin:0;}
html,body{font-family:'Inter',system-ui,sans-serif;color:var(--ink);background:#fff;}
.tg{font-family:'Inter','Manrope','Noto Sans',sans-serif;}
.page{width:210mm;height:297mm;overflow:hidden;page-break-after:always;display:flex;flex-direction:column;background:#fff;}
.page:last-child{page-break-after:auto;}
header{background:linear-gradient(110deg,var(--navy),var(--navy2));color:#fff;display:flex;justify-content:space-between;align-items:flex-start;padding:8mm 12mm 6mm;}
.h-kicker{font-size:9px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#9db4d6;}
.h-title{font-family:'Manrope';font-weight:800;font-size:22px;margin-top:3px;}
.h-sub{font-size:10px;color:#9db4d6;margin-top:4px;}
.h-r{text-align:right;}
.h-brand{font-family:'Manrope';font-weight:800;font-size:12px;letter-spacing:.32em;color:var(--lime);}
.h-pg{font-size:9px;color:#7e97bd;margin-top:5px;}
.body{flex:1;padding:6mm 12mm 3mm;min-height:0;overflow:hidden;}
.content{display:flex;flex-direction:column;gap:4mm;}
.foot{padding:4px 12mm 6px;font-size:8.5px;color:#aeb9c7;text-align:center;border-top:1px solid #f1f5f9;}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:3mm;}
.kpi{border:1px solid var(--line);border-radius:12px;padding:9px 11px;background:var(--band);}
.k-l{font-size:8.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--mut);}
.k-v{font-family:'Manrope';font-weight:800;font-size:16px;margin-top:4px;white-space:nowrap;}
.k-s{font-size:8.5px;color:var(--ink2);margin-top:3px;white-space:nowrap;}
.good{color:var(--good)!important;}
.bad{color:var(--bad)!important;}
.card{border:1px solid var(--line);border-radius:12px;overflow:hidden;}
.note{font-size:9px;color:var(--ink2);line-height:1.45;}
table.pnl{width:100%;border-collapse:collapse;table-layout:fixed;}
table.pnl th{font-size:8px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--mut);padding:7px 8px;text-align:left;background:var(--band);border-bottom:1.5px solid var(--line);white-space:nowrap;}
table.pnl th:first-child{width:38%;}
table.pnl th.num{text-align:right;}
table.pnl td{font-size:10px;line-height:1.2;padding:5px 8px;border-bottom:1px solid #eef2f6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
table.pnl td.num{text-align:right;font-variant-numeric:tabular-nums;}
table.pnl td.shr{font-size:8.5px;color:var(--mut);}
table.pnl td.prv{color:var(--ink2);}
table.pnl tr.line td.lbl{font-weight:700;}
table.pnl tr.line td.cur{font-weight:700;}
table.pnl tr.line.exp td.lbl{font-weight:600;}
table.pnl tr.line.exp td.cur{font-weight:600;color:var(--ink2);}
table.pnl tr.part td{font-size:9px;padding:3px 8px;background:#fbfcfd;border-bottom:1px solid #f3f6f9;color:var(--ink2);}
table.pnl tr.part td.lbl{padding-left:22px;}
table.pnl tr.part td.cur{color:var(--ink);}
table.pnl tr.total td{font-family:'Manrope';font-weight:800;background:var(--band);}
table.pnl tr.total td.lbl{padding-left:14px;}
table.pnl tr.final td{font-family:'Manrope';font-weight:800;font-size:11px;background:#ecfdf5;border-top:1.5px solid #a7f3d0;border-bottom:1.5px solid #a7f3d0;}
table.pnl tr.final td.lbl{padding-left:14px;}
table.pnl tr.final td.shr{font-size:9px;}
table.pnl tr.sep td{font-size:8.5px;color:#b45309;background:#fffbeb;padding:4px 8px;}
`
