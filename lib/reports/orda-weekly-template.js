/* eslint-disable */
/**
 * Orda Control — шаблон НЕДЕЛЬНОГО АКТА (по точкам) для выгрузки в PDF.
 * A4 landscape, рендер — headless Chromium. Контракт — см. WEEKLY_SCHEMA и ТЗ_АКТ_неделя.md.
 * Дополнение: сводная страница «Расходы по категориям и компаниям» (флаг expenseMatrix, по умолчанию вкл).
 */

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const clip = (s, n = 28) => { const t = String(s ?? '').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };
const fmt = (n) => Number(n || 0).toLocaleString('ru-RU').replace(/ /g, ' ');
const sign = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : 'zero');
const money = (n) => (n == null ? '<span class="dash">—</span>' : fmt(n));
const signed = (n) => (n == null ? '<span class="dash">—</span>' : (n > 0 ? '+' : '') + fmt(n));

function pointCard(p) {
  const maxCat = Math.max(1, ...(p.categories || []).map((c) => c.amount));
  const cats = (p.categories || []).slice(0, 6).map((c) => {
    const w = Math.max(5, c.amount / maxCat * 100);
    return `<div class="cat"><span class="cat-n">${esc(clip(c.name, 26))}</span>
      <span class="cat-bar"><i style="width:${w}%"></i></span>
      <span class="cat-a">${fmt(c.amount)}</span></div>`;
  }).join('') || `<div class="cat empty">расходов нет</div>`;

  const rows = (p.days || []).map((d) => `
    <tr>
      <td class="d">${esc(d.d)} <span class="wd">${esc(d.wd || '')}</span></td>
      <td class="num">${money(d.income)}</td>
      <td class="num">${money(d.expense)}</td>
      <td class="num ${sign(d.net)}">${signed(d.net)}</td>
    </tr>`).join('');

  const inc = p.income || 0;
  const cashW = inc > 0 ? Math.round((p.incomeCash || 0) / inc * 100) : 0;
  const cashlessW = inc > 0 ? 100 - cashW : 0;

  return `
  <div class="pc">
    <div class="pc-head">
      <span class="pc-name">${esc(p.name)}</span>
      <span class="pc-net ${sign(p.net)}">Чистыми ${signed(p.net)} ₸</span>
    </div>
    <div class="pc-body">
      <div class="pc-left">
        <table class="days">
          <thead><tr><th>День</th><th>Доход</th><th>Расход</th><th>Чистыми</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr>
            <td>Итого</td>
            <td class="num">${fmt(p.income)}</td>
            <td class="num">${fmt(p.expense)}</td>
            <td class="num ${sign(p.net)}">${signed(p.net)}</td>
          </tr></tfoot>
        </table>
      </div>
      <div class="pc-right">
        <div class="chips">
          <div class="chip in"><span>Доход</span><b>${fmt(p.income)} ₸</b></div>
          <div class="chip ex"><span>Расход</span><b>${fmt(p.expense)} ₸</b></div>
        </div>
        <div class="cash">
          <div class="cash-h"><span>Доход: нал ${fmt(p.incomeCash)} ₸</span><span>безнал ${fmt(p.incomeCashless)} ₸</span></div>
          <div class="cash-bar">${inc > 0
            ? `<i class="c-nal" style="width:${cashW}%"></i><i class="c-bez" style="width:${cashlessW}%"></i>`
            : `<i class="c-non" style="width:100%"></i>`}</div>
        </div>
        <div class="left">
          <div class="lf ${sign(p.leftCash)}"><span>Осталось нал</span><b>${signed(p.leftCash)} ₸</b></div>
          <div class="lf ${sign(p.leftCashless)}"><span>Осталось безнал</span><b>${signed(p.leftCashless)} ₸</b></div>
        </div>
        <div class="cats">
          <div class="cats-h">Расходы по категориям</div>
          ${cats}
          <div class="cat total"><span class="cat-n">Всего расход</span><span class="cat-a">${fmt(p.expense)} ₸</span></div>
        </div>
      </div>
    </div>
  </div>`;
}

function header(t, pageNo, totalPages) {
  return `
  <header>
    <div class="h-left">
      <div class="h-title">АКТ ЗА НЕДЕЛЮ</div>
      <div class="h-sub">${esc(t.period)} · сформирован ${esc(t.generated)}</div>
    </div>
    <div class="h-right">
      <div class="h-brand">ORDA CONTROL</div>
      <div class="h-page">страница ${pageNo} / ${totalPages}</div>
    </div>
  </header>`;
}
function footer(t) { return `<div class="foot">Orda Control · акт за неделю · ${esc(t.period)}</div>`; }

function totalStrip(g) {
  return `
  <div class="kpi-strip">
    <div class="kpi"><div class="kpi-lbl">Доход</div><div class="kpi-val">${fmt(g.income)} <span class="cur">₸</span></div><div class="kpi-sub">по всем точкам</div></div>
    <div class="kpi"><div class="kpi-lbl orange">Расход</div><div class="kpi-val">${fmt(g.expense)} <span class="cur">₸</span></div><div class="kpi-sub">${g.income ? (g.expense / g.income * 100).toFixed(1) : 0}% от дохода</div></div>
    <div class="kpi profit"><div class="kpi-lbl green">Чистыми</div><div class="kpi-val ${sign(g.net)}">${signed(g.net)} <span class="cur">₸</span></div><div class="kpi-sub">за неделю</div></div>
    <div class="kpi"><div class="kpi-lbl">Осталось нал</div><div class="kpi-val ${sign(g.cashLeft)}">${signed(g.cashLeft)} <span class="cur">₸</span></div><div class="kpi-sub">наличными</div></div>
    <div class="kpi"><div class="kpi-lbl">Осталось безнал</div><div class="kpi-val ${sign(g.cashlessLeft)}">${signed(g.cashlessLeft)} <span class="cur">₸</span></div><div class="kpi-sub">на счёте</div></div>
  </div>`;
}

function paginate(points, first = 4, rest = 6) {
  const pages = [];
  let i = 0;
  pages.push(points.slice(0, first)); i = first;
  while (i < points.length) { pages.push(points.slice(i, i + rest)); i += rest; }
  return pages.length ? pages : [[]];
}

// Сводная матрица: строки — категории (объединение по всем точкам), столбцы — точки
function expenseMatrixPage(t, points, pageNo, totalPages) {
  const cols = points.filter((p) => (p.categories || []).length);
  const map = new Map(); // name -> { byPoint:{}, total }
  for (const p of cols) for (const c of (p.categories || [])) {
    const row = map.get(c.name) || { byPoint: {}, total: 0 };
    row.byPoint[p.name] = (row.byPoint[p.name] || 0) + c.amount;
    row.total += c.amount;
    map.set(c.name, row);
  }
  const rows = [...map.entries()].map(([name, r]) => ({ name, ...r })).sort((a, b) => b.total - a.total);
  const grand = rows.reduce((s, r) => s + r.total, 0);

  const colTotals = {};
  for (const p of cols) colTotals[p.name] = rows.reduce((s, r) => s + (r.byPoint[p.name] || 0), 0);

  const head = `<tr><th class="cat-col">Категория</th>${cols.map((p) => `<th>${esc(p.name)}</th>`).join('')}<th class="tot-col">Итого</th><th class="share-col">Доля</th></tr>`;
  const body = rows.map((r) => {
    const maxInRow = Math.max(...cols.map((p) => r.byPoint[p.name] || 0));
    const cells = cols.map((p) => {
      const v = r.byPoint[p.name] || 0;
      const hot = v > 0 && v === maxInRow ? ' hot' : '';
      return `<td class="num${hot}">${v ? fmt(v) : '<span class="dash">—</span>'}</td>`;
    }).join('');
    const share = grand ? (r.total / grand * 100) : 0;
    return `<tr>
      <td class="cat-col">${esc(clip(r.name, 34))}</td>
      ${cells}
      <td class="num tot-col">${fmt(r.total)}</td>
      <td class="share-col"><span class="mbar"><i style="width:${Math.max(4, share)}%"></i></span><span class="mpc">${share.toFixed(1)}%</span></td>
    </tr>`;
  }).join('');
  const foot = `<tr class="mfoot">
    <td class="cat-col">Всего расход</td>
    ${cols.map((p) => `<td class="num">${fmt(colTotals[p.name])}</td>`).join('')}
    <td class="num tot-col">${fmt(grand)}</td>
    <td class="share-col">100%</td>
  </tr>`;

  return `
  <div class="page">
    ${header(t, pageNo, totalPages)}
    <div class="body">
      <div class="sec-h"><span>Расходы по категориям и компаниям</span><span class="badge">сводно за неделю · ${cols.length} точек</span></div>
      <div class="mwrap">
        <table class="matrix">
          <thead>${head}</thead>
          <tbody>${body}</tbody>
          <tfoot>${foot}</tfoot>
        </table>
      </div>
    </div>
    ${footer(t)}
  </div>`;
}

const PLAN_DAYS = ['', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

// Страница «План закупок» — что докупить на неделю, по точкам и дням.
function planPage(t, pageNo, totalPages) {
  const items = Array.isArray(t.purchasingPlan) ? t.purchasingPlan : [];
  const weekLabel = t.purchasingPlanWeek ? esc(t.purchasingPlanWeek) : '';
  const grand = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);

  const byCompany = new Map();
  for (const it of items) {
    const k = it.company || '—';
    if (!byCompany.has(k)) byCompany.set(k, []);
    byCompany.get(k).push(it);
  }
  const blocks = [...byCompany.entries()].map(([company, list]) => {
    const sorted = [...list].sort((a, b) => (Number(a.day) || 9) - (Number(b.day) || 9));
    const rows = sorted.map((it) => `<tr>
      <td class="cat-col">${esc(PLAN_DAYS[Number(it.day) || 0] || '—')}</td>
      <td>${esc(clip(it.category || '—', 20))}</td>
      <td>${esc(clip(it.title || '—', 34))}</td>
      <td>${esc(clip(it.supplier || '—', 22))}</td>
      <td class="num">${it.qty ? esc(String(it.qty)) : '<span class="dash">—</span>'}</td>
      <td class="num tot-col">${it.amount ? fmt(it.amount) : '<span class="dash">—</span>'}</td>
      <td class="num">${it.bought ? 'куплено' : 'план'}</td>
    </tr>`).join('');
    const sub = list.reduce((s, it) => s + (Number(it.amount) || 0), 0);
    return `<div class="sec-h" style="margin-top:9px"><span>${esc(company)}</span><span class="badge">${fmt(sub)} ₸</span></div>
      <table class="matrix"><thead><tr><th class="cat-col">День</th><th>Категория</th><th>Что закупаем</th><th>Поставщик</th><th>Кол-во</th><th class="tot-col">Сумма</th><th>Статус</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  }).join('');

  return `
  <div class="page">
    ${header(t, pageNo, totalPages)}
    <div class="body">
      <div class="sec-h"><span>План закупок${weekLabel ? ` · ${weekLabel}` : ''}</span><span class="badge">итого ${fmt(grand)} ₸</span></div>
      ${items.length ? blocks : '<div class="cat empty">План на неделю пуст.</div>'}
    </div>
    ${footer(t)}
  </div>`;
}

export function renderWeeklyHTML(t, { fontCss = '', hideEmpty = true, expenseMatrix = true } = {}) {
  let points = (t.points || []);
  if (hideEmpty) points = points.filter((p) => (p.income || 0) !== 0 || (p.expense || 0) !== 0);
  const chunks = paginate(points);
  const hasMatrix = expenseMatrix && points.some((p) => (p.categories || []).length);
  const hasPlan = Array.isArray(t.purchasingPlan) && t.purchasingPlan.length > 0;
  const totalPages = chunks.length + (hasMatrix ? 1 : 0) + (hasPlan ? 1 : 0);
  const cardPages = chunks.map((chunk, idx) => `
    <div class="page">
      ${header(t, idx + 1, totalPages)}
      <div class="body">
        ${idx === 0 ? totalStrip(t.total || {}) : ''}
        <div class="grid">${chunk.map(pointCard).join('')}</div>
      </div>
      ${footer(t)}
    </div>`);
  if (hasMatrix) cardPages.push(expenseMatrixPage(t, points, chunks.length + 1, totalPages));
  if (hasPlan) cardPages.push(planPage(t, totalPages, totalPages));
  const body = cardPages.join('').replace(/₸/g, '<span class="tg">₸</span>');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${fontCss}\n${WEEKLY_CSS}</style></head><body>${body}</body></html>`;
}

export const PDF_OPTIONS = { landscape: true, format: 'A4', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } };

export const WEEKLY_CSS = `
*{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
:root{--navy:#0c1a2e;--navy2:#13294a;--ink:#0f172a;--ink2:#475569;--mut:#94a3b8;--line:#e8edf3;--bg:#f6f8fb;
  --lime:#a3e635;--lime-d:#65a30d;--green:#16a34a;--orange:#f97316;--red:#dc2626;--blue:#2563eb;}
@page{size:A4 landscape;margin:0;}
html,body{font-family:'Inter',system-ui,sans-serif;color:var(--ink);background:#fff;}
.tg{font-family:'Inter','Manrope','Noto Sans',sans-serif;}
.page{width:297mm;height:210mm;background:#fff;overflow:hidden;page-break-after:always;display:flex;flex-direction:column;}
.page:last-child{page-break-after:auto;}
header{background:linear-gradient(110deg,var(--navy),var(--navy2));color:#fff;display:flex;justify-content:space-between;align-items:center;padding:7mm 14mm 6mm;}
.h-title{font-family:'Manrope';font-weight:800;font-size:22px;letter-spacing:.03em;}
.h-sub{font-size:10.5px;color:#9db4d6;margin-top:4px;}
.h-right{text-align:right;}
.h-brand{font-family:'Manrope';font-weight:800;font-size:13px;letter-spacing:.34em;color:var(--lime);}
.h-page{font-size:9.5px;color:#7e97bd;margin-top:5px;letter-spacing:.05em;}
.body{flex:1;padding:5mm 14mm 2mm;display:flex;flex-direction:column;gap:4mm;min-height:0;}
.kpi-strip{display:grid;grid-template-columns:repeat(5,1fr);gap:4mm;}
.kpi{border:1px solid var(--line);border-radius:13px;padding:8px 13px;background:#fff;min-width:0;}
.kpi.profit{border:1.6px solid var(--lime);background:linear-gradient(180deg,#f7fee7,#fff);box-shadow:0 6px 18px -10px rgba(132,204,22,.5);}
.kpi-lbl{font-size:8.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--mut);white-space:nowrap;}
.kpi-lbl.orange{color:#ea7317;}.kpi-lbl.green{color:var(--lime-d);}
.kpi-val{font-family:'Manrope';font-weight:800;font-size:18px;margin-top:5px;letter-spacing:-.01em;color:var(--ink);white-space:nowrap;}
.kpi-val .cur{font-size:12px;color:var(--mut);font-weight:700;}
.kpi-val.pos{color:var(--green);}.kpi-val.neg{color:var(--red);}
.kpi-sub{font-size:9px;color:var(--mut);margin-top:3px;}
.grid{flex:1;display:grid;grid-template-columns:1fr 1fr;gap:4mm;min-height:0;align-content:start;}
.pc{border:1px solid var(--line);border-radius:14px;overflow:hidden;background:#fff;display:flex;flex-direction:column;min-width:0;}
.pc-head{display:flex;justify-content:space-between;align-items:center;background:linear-gradient(110deg,var(--navy),var(--navy2));color:#fff;padding:7px 14px;}
.pc-name{font-family:'Manrope';font-weight:800;font-size:13px;letter-spacing:.02em;}
.pc-net{font-family:'Manrope';font-weight:800;font-size:12px;padding:3px 9px;border-radius:20px;}
.pc-net.pos{background:rgba(132,204,22,.18);color:var(--lime);}
.pc-net.neg{background:rgba(248,113,113,.18);color:#fca5a5;}
.pc-net.zero{background:rgba(255,255,255,.12);color:#cbd5e1;}
.pc-body{display:flex;gap:12px;padding:8px 13px 9px;min-width:0;}
.pc-left{flex:1.05;min-width:0;}.pc-right{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px;}
table.days{width:100%;border-collapse:collapse;}
table.days th{font-size:8px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--mut);text-align:right;padding:0 0 3px;border-bottom:1px solid var(--line);}
table.days th:first-child{text-align:left;}
table.days td{font-size:9px;padding:2px 0;border-bottom:1px solid #f4f7fa;color:#334155;}
table.days td.d{color:#1e293b;}.days .wd{color:var(--mut);font-size:8px;}
table.days td.num{text-align:right;font-family:'Manrope';font-weight:600;}
.days .dash{color:#cbd5e1;}
.days td.pos{color:var(--green);}.days td.neg{color:var(--red);}.days td.zero{color:var(--mut);}
table.days tfoot td{font-family:'Manrope';font-weight:800;font-size:9.5px;color:#0f172a;border-top:1.5px solid #e2e8f0;border-bottom:none;padding-top:5px;}
table.days tfoot td.pos{color:var(--green);}table.days tfoot td.neg{color:var(--red);}
.chips{display:flex;gap:7px;}
.chip{flex:1;border-radius:10px;padding:6px 10px;min-width:0;}
.chip span{font-size:8px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;display:block;}
.chip b{font-family:'Manrope';font-weight:800;font-size:12px;white-space:nowrap;}
.chip.in{background:#f0fdf4;border:1px solid #bbf7d0;}.chip.in span{color:#15803d;}.chip.in b{color:#166534;}
.chip.ex{background:#fff7ed;border:1px solid #fed7aa;}.chip.ex span{color:#c2410c;}.chip.ex b{color:#9a3412;}
.cash-h{display:flex;justify-content:space-between;font-size:8.5px;color:var(--ink2);margin-bottom:3px;}
.cash-bar{display:flex;height:8px;border-radius:5px;overflow:hidden;background:#f1f5f9;}
.cash-bar i{display:block;height:100%;}
.c-nal{background:var(--green);}.c-bez{background:var(--blue);}.c-non{background:#e2e8f0;}
.left{display:flex;gap:7px;}
.lf{flex:1;border:1px solid var(--line);border-radius:10px;padding:5px 10px;min-width:0;}
.lf span{font-size:8px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--mut);display:block;white-space:nowrap;}
.lf b{font-family:'Manrope';font-weight:800;font-size:12px;color:#0f172a;white-space:nowrap;}
.lf.pos b{color:var(--green);}.lf.neg b{color:var(--red);}
.cats{margin-top:0;}
.cats-h{font-size:8.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--ink2);margin-bottom:3px;}
.cat{display:flex;align-items:center;gap:8px;padding:1px 0;}
.cat-n{font-size:9px;color:#334155;flex:0 0 42%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.cat-bar{flex:1;height:4px;background:#f1f5f9;border-radius:3px;overflow:hidden;min-width:0;}
.cat-bar i{display:block;height:100%;background:var(--orange);border-radius:3px;}
.cat-a{font-family:'Manrope';font-weight:700;font-size:9px;color:#0f172a;flex:0 0 auto;text-align:right;}
.cat.empty{font-size:9px;color:var(--mut);font-style:italic;}
.cat.total{margin-top:3px;border-top:1px solid var(--line);padding-top:5px;}
.cat.total .cat-n{flex:1;font-weight:700;color:#1e293b;font-size:9px;}
.cat.total .cat-a{font-size:10px;}
.foot{padding:5px 14mm 7px;font-size:8.5px;color:#aeb9c7;text-align:center;border-top:1px solid #f1f5f9;}
.sec-h{display:flex;justify-content:space-between;align-items:center;}
.sec-h>span:first-child{font-family:'Manrope';font-weight:800;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink);}
.badge{font-size:9px;font-weight:600;color:#64748b;background:#f1f5f9;border:1px solid #e2e8f0;padding:3px 10px;border-radius:20px;}
.mwrap{flex:1;min-height:0;}
table.matrix{width:100%;border-collapse:collapse;table-layout:fixed;}
table.matrix th{font-size:9px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--mut);text-align:right;
  padding:9px 12px;border-bottom:2px solid #e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
table.matrix th.cat-col{text-align:left;}
.matrix .cat-col{width:20%;}.matrix .tot-col{width:11%;}.matrix .share-col{width:13%;}
table.matrix td{font-size:10.5px;padding:7px 12px;border-bottom:1px solid #f1f5f9;color:#334155;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
table.matrix td.cat-col{font-weight:600;color:#1e293b;}
table.matrix td.num{text-align:right;font-family:'Manrope';font-weight:600;color:#0f172a;}
table.matrix td.num.hot{color:#9a3412;background:#fff7ed;}
table.matrix td.tot-col{font-family:'Manrope';font-weight:800;color:#0f172a;background:#f8fafc;}
.matrix .dash{color:#cbd5e1;}
.matrix .share-col{vertical-align:middle;}
.matrix .mbar{display:inline-block;width:58%;height:6px;background:#f1f5f9;border-radius:4px;overflow:hidden;vertical-align:middle;margin-right:6px;}
.matrix .mbar i{display:block;height:100%;background:var(--orange);border-radius:4px;}
.matrix .mpc{font-family:'Manrope';font-weight:700;font-size:9px;color:#64748b;vertical-align:middle;}
table.matrix tfoot td{font-family:'Manrope';font-weight:800;font-size:10.5px;color:#0f172a;
  border-top:2px solid #e2e8f0;border-bottom:none;padding-top:9px;}
table.matrix tfoot .cat-col{text-transform:uppercase;letter-spacing:.04em;font-size:9.5px;}
.mfoot td{background:#0c1a2e !important;color:#fff !important;}
.mfoot .tot-col{color:var(--lime) !important;}
.mfoot td:first-child{border-top-left-radius:10px;border-bottom-left-radius:10px;}
.mfoot td:last-child{border-top-right-radius:10px;border-bottom-right-radius:10px;}
`;
