/* eslint-disable */
/**
 * Orda Control — детальный финансовый отчёт в PDF (A4 landscape).
 * Страницы: Обзор · Сводка · По компаниям · Расходы · Операции.
 * Источник: ТЗ_PDF_финотчёт.md + orda-finreport-pdf.js (поставка).
 */

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const clip = (s, n = 30) => { const t = String(s ?? '').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };
const fmt = (n) => Number(Math.round(n) || 0).toLocaleString('ru-RU').replace(/ /g, ' ');
const pct1 = (x) => (x * 100).toFixed(1).replace('.', ',') + '%';

function deltaChip(cur, prev, goodUp = true) {
  if (!prev) return `<span class="dlt zero">—</span>`;
  const d = (cur - prev) / prev;
  const up = d > 0; const good = up === goodUp;
  const arrow = up ? '▲' : '▼';
  return `<span class="dlt ${good ? 'good' : 'bad'}">${arrow} ${Math.abs(d * 100).toFixed(1).replace('.', ',')}% <i>к прошлому</i></span>`;
}

function header(meta, pageNo, total, subtitle) {
  return `<header>
    <div class="h-l"><div class="h-title">ФИНАНСОВЫЙ ОТЧЁТ</div>
      <div class="h-sub">${esc(meta.period)} · ${esc(meta.company)} · сформирован ${esc(meta.generated)}</div></div>
    <div class="h-r"><div class="h-brand">ORDA CONTROL</div><div class="h-pg">${esc(subtitle)} · стр. ${pageNo} / ${total}</div></div>
  </header>`;
}
const footer = (meta) => `<div class="foot">Orda Control · финансовый отчёт · ${esc(meta.period)} · суммы в ₸</div>`;

function overviewPage(d, pageNo, total) {
  const k = d.kpi;
  const profitShare = k.revenue ? k.profit / k.revenue : 0;
  const expShare = k.revenue ? k.expense / k.revenue : 0;
  const inc = d.summary.find((s) => /Наличные/.test(s.label || '')) || {};
  const incl = d.summary.find((s) => /Безналичный/.test(s.label || '')) || {};
  const cash = inc.cur || 0, cashless = incl.cur || 0, incTot = cash + cashless || k.revenue;
  const comp = [...d.byCompany].sort((a, b) => b.revenue - a.revenue);
  const exp = [...d.expenses].sort((a, b) => b.amount - a.amount);
  const maxC = Math.max(...comp.map((c) => c.revenue), 1);
  const maxE = Math.max(...exp.map((e) => e.amount), 1);
  const compRows = comp.map((c) => `<div class="lrow"><span class="ln">${esc(c.name)}</span>
    <span class="lbar"><i style="width:${Math.max(3, c.revenue / maxC * 100)}%;background:var(--green)"></i></span>
    <span class="lv">${fmt(c.revenue)} ₸</span></div>`).join('') || '<div class="empty">Нет данных за период</div>';
  const expRows = exp.slice(0, 6).map((e) => `<div class="lrow"><span class="ln">${esc(clip(e.name, 22))}</span>
    <span class="lbar"><i style="width:${Math.max(3, e.amount / maxE * 100)}%;background:var(--orange)"></i></span>
    <span class="lv">${fmt(e.amount)} ₸</span></div>`).join('') || '<div class="empty">Нет данных за период</div>';

  return `<div class="page">${header(d.meta, pageNo, total, 'Обзор')}<div class="body">
    <div class="kpis">
      <div class="kpi"><div class="kpi-l">ОБОРОТ</div><div class="kpi-v">${fmt(k.revenue)} ₸</div>${deltaChip(k.revenue, k.revenuePrev, true)}</div>
      <div class="kpi"><div class="kpi-l orange">РАСХОДЫ</div><div class="kpi-v">${fmt(k.expense)} ₸</div>${deltaChip(k.expense, k.expensePrev, false)}</div>
      <div class="kpi profit"><div class="kpi-l green">ЧИСТАЯ ПРИБЫЛЬ</div><div class="kpi-v">${fmt(k.profit)} ₸</div><div class="kpi-s">Рентабельность ${pct1(profitShare)}</div></div>
      <div class="kpi"><div class="kpi-l">СРЕДНИЙ ЧЕК</div><div class="kpi-v">${fmt(k.avgCheck)} ₸</div><div class="kpi-s">${k.txns} операций</div></div>
    </div>
    <div class="grid2">
      <div class="col">
        <div class="card">
          <div class="card-h">Куда ушёл оборот <span class="muted">100% = ${fmt(k.revenue)} ₸</span></div>
          <div class="split"><i class="s-prof" style="width:${profitShare * 100}%">${pct1(profitShare)}</i><i class="s-exp" style="width:${expShare * 100}%">${pct1(expShare)}</i></div>
          <div class="legend"><span><b class="dot green"></b>Прибыль ${fmt(k.profit)} ₸</span><span><b class="dot orange"></b>Расходы ${fmt(k.expense)} ₸</span></div>
        </div>
        <div class="card">
          <div class="card-h">Структура дохода <span class="muted">нал / безнал</span></div>
          <div class="split2"><i class="s-cash" style="width:${cashless ? cash / incTot * 100 : 0}%"></i><i class="s-cl" style="width:${incTot ? cashless / incTot * 100 : 0}%"></i></div>
          <div class="legend"><span><b class="dot green"></b>Наличные ${fmt(cash)} ₸</span><span><b class="dot blue"></b>Безналичные ${fmt(cashless)} ₸</span></div>
        </div>
        <div class="card insights">
          <div class="card-h">Ключевые выводы</div>
          <ul>
            <li>Оборот за период — <b>${fmt(k.revenue)} ₸</b>, чистая прибыль <b>${fmt(k.profit)} ₸</b> при рентабельности <b>${pct1(profitShare)}</b>.</li>
            ${comp[0] ? `<li>Лидер по обороту: <b>${esc(comp[0].name)}</b> — ${fmt(comp[0].revenue)} ₸ (${k.revenue ? pct1(comp[0].revenue / k.revenue) : '—'} оборота).</li>` : ''}
            ${exp[0] ? `<li>Главная статья расходов: <b>${esc(exp[0].name)}</b> — ${fmt(exp[0].amount)} ₸ (${k.expense ? pct1(exp[0].amount / k.expense) : '—'} расходов).</li>` : ''}
            <li>К прошлому периоду: оборот ${deltaChip(k.revenue, k.revenuePrev, true)}, прибыль ${deltaChip(k.profit, k.profitPrev, true)}.</li>
          </ul>
        </div>
      </div>
      <div class="col">
        <div class="card grow">
          <div class="card-h">Оборот по компаниям</div>
          <div class="list">${compRows}</div>
        </div>
        <div class="card grow">
          <div class="card-h">Расходы по категориям <span class="muted">топ-6</span></div>
          <div class="list">${expRows}</div>
        </div>
      </div>
    </div>
  </div>${footer(d.meta)}</div>`;
}

function summaryPage(d, pageNo, total) {
  const rows = d.summary.map((s) => {
    if (s.section) return `<tr class="sec"><td colspan="4">${esc(s.section)}</td></tr>`;
    const dl = s.prev ? (s.cur - s.prev) / s.prev : null;
    const cls = dl == null ? 'zero' : dl >= 0 ? 'good' : 'bad';
    const dtxt = dl == null ? '—' : (dl > 0 ? '+' : '−') + Math.abs(dl * 100).toFixed(1).replace('.', ',') + '%';
    return `<tr class="${s.strong ? 'strong' : ''}">
      <td class="lbl">${esc(s.label)}</td>
      <td class="num">${fmt(s.cur)} ₸</td>
      <td class="num prev">${fmt(s.prev)} ₸</td>
      <td class="num dl ${cls}">${dtxt}</td></tr>`;
  }).join('');
  const mx = Math.max(d.kpi.revenuePrev, d.kpi.expensePrev, d.kpi.profitPrev, 1);
  const bar = (lbl, cur, prev, color) => `<div class="cmp">
    <div class="cmp-l">${lbl}</div>
    <div class="cmp-bars">
      <div class="cmp-row"><span class="cmp-t">текущий</span><span class="cmp-bar"><i style="width:${cur / mx * 100}%;background:${color}"></i></span><span class="cmp-v">${fmt(cur)} ₸</span></div>
      <div class="cmp-row"><span class="cmp-t">прошлый</span><span class="cmp-bar"><i style="width:${prev / mx * 100}%;background:#cbd5e1"></i></span><span class="cmp-v muted">${fmt(prev)} ₸</span></div>
    </div></div>`;
  return `<div class="page">${header(d.meta, pageNo, total, 'Сводка')}<div class="body">
    <div class="grid-sum">
      <div class="card">
        <div class="card-h">Показатели · текущий и прошлый период</div>
        <table class="sum"><thead><tr><th>Показатель</th><th class="num">Текущий</th><th class="num">Прошлый</th><th class="num">Изм.</th></tr></thead>
        <tbody>${rows}</tbody></table>
      </div>
      <div class="card">
        <div class="card-h">Сравнение с прошлым периодом</div>
        ${bar('Оборот', d.kpi.revenue, d.kpi.revenuePrev, 'var(--lime-d)')}
        ${bar('Расходы', d.kpi.expense, d.kpi.expensePrev, 'var(--orange)')}
        ${bar('Прибыль', d.kpi.profit, d.kpi.profitPrev, 'var(--green)')}
        <div class="note">Масштаб баров общий — наглядно видно снижение объёмов к прошлому периоду.</div>
      </div>
    </div>
  </div>${footer(d.meta)}</div>`;
}

function companiesPage(d, pageNo, total) {
  const comp = [...d.byCompany].sort((a, b) => b.revenue - a.revenue);
  const totRev = comp.reduce((s, c) => s + c.revenue, 0) || 1;
  const cards = comp.map((c) => {
    const inc = c.revenue || 1;
    const cashW = Math.round((c.cash || 0) / inc * 100);
    const avg = c.txns ? c.revenue / c.txns : 0;
    return `<div class="cc">
      <div class="cc-h"><span class="cc-n">${esc(c.name)}</span><span class="cc-sh">${pct1(c.revenue / totRev)} оборота</span></div>
      <div class="cc-rev">${fmt(c.revenue)} ₸</div>
      <div class="cc-split"><i class="s-cash" style="width:${cashW}%"></i><i class="s-cl" style="width:${100 - cashW}%"></i></div>
      <div class="cc-leg"><span><b class="dot green"></b>Нал ${fmt(c.cash)} ₸</span><span><b class="dot blue"></b>Безнал ${fmt(c.cashless)} ₸</span></div>
      <div class="cc-kv"><div><span>Транзакций</span><b>${fmt(c.txns)}</b></div><div><span>Средний чек</span><b>${fmt(avg)} ₸</b></div></div>
    </div>`;
  }).join('') || '<div class="empty">Нет данных за период</div>';
  const tot = comp.reduce((a, c) => ({ r: a.r + c.revenue, ca: a.ca + c.cash, cl: a.cl + c.cashless, on: a.on + c.online, cd: a.cd + c.card, tx: a.tx + c.txns }), { r: 0, ca: 0, cl: 0, on: 0, cd: 0, tx: 0 });
  const trows = comp.map((c) => `<tr><td class="lbl">${esc(c.name)}</td>
    <td class="num">${fmt(c.revenue)} ₸</td><td class="num">${fmt(c.cash)} ₸</td><td class="num">${fmt(c.cashless)} ₸</td>
    <td class="num">${fmt(c.online)} ₸</td><td class="num">${fmt(c.card)} ₸</td><td class="num">${fmt(c.txns)}</td>
    <td class="num">${fmt(c.txns ? c.revenue / c.txns : 0)} ₸</td></tr>`).join('');
  return `<div class="page">${header(d.meta, pageNo, total, 'По компаниям')}<div class="body">
    <div class="cc-row">${cards}</div>
    <div class="card grow">
      <div class="card-h">Детально по компаниям</div>
      <table class="tbl"><thead><tr><th>Компания</th><th class="num">Оборот</th><th class="num">Наличные</th><th class="num">Безнал</th><th class="num">Online</th><th class="num">Card</th><th class="num">Транз.</th><th class="num">Ср. чек</th></tr></thead>
      <tbody>${trows}
        <tr class="total"><td>ИТОГО</td><td class="num">${fmt(tot.r)} ₸</td><td class="num">${fmt(tot.ca)} ₸</td><td class="num">${fmt(tot.cl)} ₸</td><td class="num">${fmt(tot.on)} ₸</td><td class="num">${fmt(tot.cd)} ₸</td><td class="num">${fmt(tot.tx)}</td><td class="num">${fmt(tot.tx ? tot.r / tot.tx : 0)} ₸</td></tr>
      </tbody></table>
    </div>
  </div>${footer(d.meta)}</div>`;
}

function expensesPage(d, pageNo, total) {
  const exp = [...d.expenses].sort((a, b) => b.amount - a.amount);
  const tot = exp.reduce((s, e) => s + e.amount, 0); const den = tot || 1;
  const palette = ['#65a30d', '#16a34a', '#0ea5e9', '#6366f1', '#f97316', '#ef4444', '#a855f7', '#14b8a6', '#eab308', '#64748b'];
  let acc = 0; const segs = exp.map((e, i) => { const a = acc / den * 360, b = (acc + e.amount) / den * 360; acc += e.amount; return `${palette[i % palette.length]} ${a}deg ${b}deg`; }).join(',');
  const rows = exp.map((e, i) => `<tr><td><b class="sw" style="background:${palette[i % palette.length]}"></b>${esc(e.name)}</td>
    <td class="num">${fmt(e.amount)} ₸</td><td class="num share">${pct1(e.amount / den)}</td>
    <td class="barcell"><span class="lbar"><i style="width:${Math.max(2, e.amount / (exp[0]?.amount || 1) * 100)}%;background:${palette[i % palette.length]}"></i></span></td></tr>`).join('');
  return `<div class="page">${header(d.meta, pageNo, total, 'Расходы')}<div class="body">
    <div class="grid-exp">
      <div class="card donut-card">
        <div class="card-h">Структура расходов</div>
        <div class="donut" style="background:conic-gradient(${exp.length ? segs : '#eef2f7 0deg 360deg'})"><div class="donut-hole"><span>ИТОГО</span><b>${fmt(tot)} ₸</b></div></div>
      </div>
      <div class="card">
        <div class="card-h">Расходы по категориям <span class="muted">${exp.length} статей</span></div>
        <table class="tbl exp"><thead><tr><th>Категория</th><th class="num">Сумма</th><th class="num">Доля</th><th>Вклад</th></tr></thead>
        <tbody>${rows}<tr class="total"><td>ИТОГО РАСХОДОВ</td><td class="num">${fmt(tot)} ₸</td><td class="num">${exp.length ? '100%' : '—'}</td><td></td></tr></tbody></table>
      </div>
    </div>
  </div>${footer(d.meta)}</div>`;
}

function operationsPages(d, startPage, total) {
  const ops = d.operations;
  const per = 24;
  const chunks = [];
  for (let i = 0; i < ops.length; i += per) chunks.push(ops.slice(i, i + per));
  const sum = ops.reduce((a, o) => ({ s: a.s + (o.amount || 0), n: a.n + (o.cash || 0), b: a.b + (o.cashless || 0) }), { s: 0, n: 0, b: 0 });
  return chunks.map((chunk, ci) => {
    const rows = chunk.map((o) => {
      const isExp = o.type === 'Расход';
      return `<tr><td class="dim">${esc(o.date)}</td><td class="${isExp ? 'tneg' : 'tpos'}">${esc(o.type)}</td>
        <td>${esc(o.company)}</td><td>${esc(clip(o.cat, 22))}</td>
        <td class="num ${isExp ? 'tneg' : 'tpos'}">${fmt(o.amount)}</td>
        <td class="num">${o.cash ? fmt(o.cash) : '<i class="z">—</i>'}</td>
        <td class="num">${o.cashless ? fmt(o.cashless) : '<i class="z">—</i>'}</td>
        <td class="note">${esc(clip(o.note, 40))}</td></tr>`;
    }).join('');
    const isLast = ci === chunks.length - 1;
    const totalRow = isLast ? `<tr class="total"><td colspan="4">ИТОГО ПО ОПЕРАЦИЯМ (${ops.length})</td><td class="num">${fmt(sum.s)}</td><td class="num">${fmt(sum.n)}</td><td class="num">${fmt(sum.b)}</td><td></td></tr>` : '';
    return `<div class="page">${header(d.meta, startPage + ci, total, `Операции${chunks.length > 1 ? ` ${ci + 1}/${chunks.length}` : ''}`)}<div class="body">
      <div class="card grow">
        <div class="card-h">Детальные операции <span class="muted">суммы в ₸</span></div>
        <table class="tbl ops"><thead><tr><th>Дата</th><th>Тип</th><th>Компания</th><th>Категория</th><th class="num">Сумма</th><th class="num">Наличные</th><th class="num">Безнал</th><th>Примечание</th></tr></thead>
        <tbody>${rows}${totalRow}</tbody></table>
      </div>
    </div>${footer(d.meta)}</div>`;
  });
}

const PLAN_DAYS = ['', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

function purchasingPlanPage(d, pageNo, total) {
  const items = Array.isArray(d.purchasingPlan) ? d.purchasingPlan : [];
  const weekLabel = d.purchasingPlanWeek ? esc(d.purchasingPlanWeek) : '';
  const grand = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);

  const byCompany = new Map();
  for (const it of items) {
    const key = it.company || '—';
    if (!byCompany.has(key)) byCompany.set(key, []);
    byCompany.get(key).push(it);
  }

  const blocks = [...byCompany.entries()].map(([company, list]) => {
    const sorted = [...list].sort((a, b) => (Number(a.day) || 9) - (Number(b.day) || 9));
    const rows = sorted.map((it) => `<tr>
      <td class="lbl">${esc(PLAN_DAYS[Number(it.day) || 0] || '—')}</td>
      <td>${esc(clip(it.category || '—', 20))}</td>
      <td>${esc(clip(it.title || '—', 34))}</td>
      <td>${esc(clip(it.supplier || '—', 22))}</td>
      <td class="num">${it.qty ? esc(String(it.qty)) : '—'}</td>
      <td class="num">${it.amount ? fmt(it.amount) : '—'}</td>
      <td>${it.bought ? '<span class="tpos">куплено</span>' : '<span class="muted">план</span>'}</td>
    </tr>`).join('');
    const sub = list.reduce((s, it) => s + (Number(it.amount) || 0), 0);
    return `<div class="card grow" style="margin-bottom:5mm">
      <div class="card-h">${esc(company)} <span class="muted">${fmt(sub)} ₸</span></div>
      <table class="tbl"><thead><tr><th>День</th><th>Категория</th><th>Что закупаем</th><th>Поставщик</th><th class="num">Кол-во</th><th class="num">Сумма</th><th>Статус</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>`;
  }).join('');

  return `<div class="page">${header(d.meta, pageNo, total, 'План закупок')}<div class="body">
    <div class="card"><div class="card-h">План закупок ${weekLabel ? `<span class="muted">${weekLabel}</span>` : ''}</div>
      <div class="note">Что планируем докупить по точкам. Итого по плану: <b>${fmt(grand)} ₸</b>.</div>
    </div>
    ${items.length ? blocks : '<div class="empty">План на следующую неделю пока пуст.</div>'}
  </div>${footer(d.meta)}</div>`;
}

export function renderFinReportHTML(d, { fontCss = '' } = {}) {
  const opsPages = Math.ceil((d.operations?.length || 0) / 24);
  const hasPlan = Array.isArray(d.purchasingPlan) && d.purchasingPlan.length > 0;
  const total = 4 + opsPages + (hasPlan ? 1 : 0);
  const pages = [
    overviewPage(d, 1, total),
    summaryPage(d, 2, total),
    companiesPage(d, 3, total),
    expensesPage(d, 4, total),
    ...operationsPages(d, 5, total),
  ];
  if (hasPlan) pages.push(purchasingPlanPage(d, total, total));
  const body = pages.join('').replace(/₸/g, '<span class="tg">₸</span>');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${fontCss}\n${CSS}</style></head><body>${body}</body></html>`;
}

export const PDF_OPTIONS = { landscape: true, format: 'A4', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } };

const CSS = `
*{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
:root{--navy:#0c1a2e;--navy2:#13294a;--ink:#0f172a;--ink2:#475569;--mut:#94a3b8;--line:#e8edf3;--band:#f6f8fb;
  --lime:#a3e635;--lime-d:#65a30d;--green:#16a34a;--orange:#f97316;--red:#dc2626;--blue:#2563eb;}
@page{size:A4 landscape;margin:0;}
html,body{font-family:'Inter',system-ui,sans-serif;color:var(--ink);background:#fff;}
.tg{font-family:'Inter','Manrope','Noto Sans',sans-serif;}
.page{width:297mm;height:210mm;overflow:hidden;page-break-after:always;display:flex;flex-direction:column;background:#fff;}
.page:last-child{page-break-after:auto;}
header{background:linear-gradient(110deg,var(--navy),var(--navy2));color:#fff;display:flex;justify-content:space-between;align-items:center;padding:7mm 13mm 6mm;}
.h-title{font-family:'Manrope';font-weight:800;font-size:21px;letter-spacing:.04em;}
.h-sub{font-size:10px;color:#9db4d6;margin-top:4px;}
.h-r{text-align:right;}
.h-brand{font-family:'Manrope';font-weight:800;font-size:13px;letter-spacing:.32em;color:var(--lime);}
.h-pg{font-size:9px;color:#7e97bd;margin-top:5px;letter-spacing:.04em;}
.body{flex:1;padding:6mm 13mm 3mm;display:flex;flex-direction:column;gap:5mm;min-height:0;}
.foot{padding:4px 13mm 6px;font-size:8.5px;color:#aeb9c7;text-align:center;border-top:1px solid #f1f5f9;}
.muted{color:var(--mut);font-weight:600;font-size:10px;}
.empty{color:var(--mut);font-size:10px;font-style:italic;padding:8px 0;}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:5mm;}
.kpi{border:1px solid var(--line);border-radius:14px;padding:12px 16px;min-width:0;}
.kpi.profit{border:1.6px solid var(--lime);background:linear-gradient(180deg,#f7fee7,#fff);box-shadow:0 8px 22px -12px rgba(132,204,22,.55);}
.kpi-l{font-size:9px;font-weight:700;letter-spacing:.1em;color:var(--mut);}
.kpi-l.orange{color:#ea7317;}.kpi-l.green{color:var(--lime-d);}
.kpi-v{font-family:'Manrope';font-weight:800;font-size:23px;margin:6px 0 5px;letter-spacing:-.01em;}
.kpi-s{font-size:9.5px;color:var(--mut);}
.dlt{font-size:9.5px;font-weight:700;}.dlt i{font-style:normal;font-weight:600;color:var(--mut);}
.dlt.good{color:var(--green);}.dlt.bad{color:var(--red);}.dlt.zero{color:var(--mut);}
.grid2{flex:1;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:5mm;min-height:0;}
.grid2 .col .card.insights{flex:1;}
.col{display:flex;flex-direction:column;gap:5mm;min-height:0;min-width:0;}
.card{border:1px solid var(--line);border-radius:14px;padding:12px 15px;min-width:0;}
.card.grow{flex:1;display:flex;flex-direction:column;min-height:0;}
.card-h{font-family:'Manrope';font-weight:800;font-size:12px;letter-spacing:.02em;margin-bottom:9px;display:flex;justify-content:space-between;align-items:baseline;}
.insights ul{list-style:none;display:flex;flex-direction:column;gap:6px;}
.insights li{font-size:10px;color:var(--ink2);line-height:1.45;padding-left:13px;position:relative;}
.insights li:before{content:'';position:absolute;left:0;top:6px;width:5px;height:5px;border-radius:50%;background:var(--lime-d);}
.insights b{color:var(--ink);font-weight:700;}
.split{display:flex;height:26px;border-radius:8px;overflow:hidden;font-size:11px;font-weight:800;color:#fff;font-family:'Manrope';}
.split i{display:flex;align-items:center;justify-content:center;}
.s-prof{background:var(--green);}.s-exp{background:var(--orange);}
.split2{display:flex;height:12px;border-radius:7px;overflow:hidden;background:#eef2f7;}
.s-cash{background:var(--green);}.s-cl{background:var(--blue);}
.legend{display:flex;gap:18px;margin-top:8px;font-size:9.5px;color:var(--ink2);}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;vertical-align:middle;}
.dot.green{background:var(--green);}.dot.orange{background:var(--orange);}.dot.blue{background:var(--blue);}
.list{display:flex;flex-direction:column;gap:7px;}
.lrow{display:flex;align-items:center;gap:10px;}
.ln{font-size:10px;color:var(--ink);flex:0 0 28%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.lbar{flex:1;height:9px;background:#eef2f7;border-radius:5px;overflow:hidden;min-width:0;}
.lbar i{display:block;height:100%;border-radius:5px;}
.lv{font-family:'Manrope';font-weight:700;font-size:10px;flex:0 0 auto;text-align:right;min-width:74px;}
.grid-sum{flex:1;display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);grid-template-rows:1fr;gap:5mm;min-height:0;}
.grid-sum>.card{display:flex;flex-direction:column;}
table.sum{width:100%;border-collapse:collapse;}
table.sum th{font-size:9px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--mut);padding:0 6px 7px;text-align:right;border-bottom:1.5px solid var(--line);}
table.sum th:first-child{text-align:left;}
table.sum td{font-size:10.5px;padding:6px;border-bottom:1px solid #f4f7fa;}
table.sum td.lbl{color:var(--ink);}
table.sum td.num{text-align:right;font-family:'Manrope';font-weight:600;}
table.sum td.prev{color:var(--ink2);font-weight:500;}
table.sum td.dl{font-weight:800;}.sum .good{color:var(--green);}.sum .bad{color:var(--red);}.sum .zero{color:var(--mut);}
table.sum tr.sec td{font-size:8.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--ink2);padding:11px 6px 4px;border:none;}
table.sum tr.strong td{font-weight:800;color:var(--ink);background:#f7fee7;}
.cmp{margin-bottom:13px;}
.cmp-l{font-family:'Manrope';font-weight:800;font-size:11px;margin-bottom:5px;}
.cmp-row{display:flex;align-items:center;gap:9px;margin-bottom:4px;}
.cmp-t{font-size:9px;color:var(--mut);flex:0 0 52px;}
.cmp-bar{flex:1;height:11px;background:#eef2f7;border-radius:6px;overflow:hidden;min-width:0;}
.cmp-bar i{display:block;height:100%;border-radius:6px;}
.cmp-v{font-family:'Manrope';font-weight:700;font-size:9.5px;flex:0 0 auto;min-width:78px;text-align:right;}
.cmp-v.muted{color:var(--mut);font-weight:600;}
.note{font-size:9px;color:var(--mut);margin-top:6px;line-height:1.4;}
.cc-row{display:grid;grid-template-columns:repeat(3,1fr);gap:5mm;}
.cc{border:1px solid var(--line);border-radius:14px;padding:13px 15px;min-width:0;}
.cc-h{display:flex;justify-content:space-between;align-items:baseline;}
.cc-n{font-family:'Manrope';font-weight:800;font-size:14px;}
.cc-sh{font-size:9px;color:var(--mut);font-weight:600;}
.cc-rev{font-family:'Manrope';font-weight:800;font-size:21px;margin:7px 0 9px;}
.cc-split{display:flex;height:11px;border-radius:6px;overflow:hidden;background:#eef2f7;}
.cc-leg{display:flex;justify-content:space-between;margin-top:7px;font-size:9px;color:var(--ink2);}
.cc-kv{display:flex;gap:10px;margin-top:11px;border-top:1px solid var(--line);padding-top:9px;}
.cc-kv div{flex:1;}.cc-kv span{display:block;font-size:8.5px;color:var(--mut);letter-spacing:.04em;text-transform:uppercase;}
.cc-kv b{font-family:'Manrope';font-weight:800;font-size:13px;white-space:nowrap;}
table.tbl{width:100%;border-collapse:collapse;}
table.tbl th{font-size:8.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--mut);padding:0 7px 7px;text-align:right;border-bottom:1.5px solid var(--line);}
table.tbl th:first-child{text-align:left;}
table.tbl td{font-size:10px;padding:5.5px 7px;border-bottom:1px solid #f4f7fa;}
table.tbl td.lbl{font-weight:600;}
table.tbl td.num{text-align:right;font-family:'Manrope';font-weight:600;}
table.tbl tr.total td{font-family:'Manrope';font-weight:800;border-top:1.5px solid #cbd5e1;border-bottom:none;padding-top:8px;background:var(--band);}
.sw{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:7px;vertical-align:middle;}
.barcell{width:26%;}.barcell .lbar{display:block;width:100%;height:8px;}
.exp .share{color:var(--ink2);}
.grid-exp{flex:1;display:grid;grid-template-columns:minmax(0,0.8fr) minmax(0,1.2fr);grid-template-rows:1fr;gap:5mm;min-height:0;}
.grid-exp>.card{display:flex;flex-direction:column;}
.donut-card{justify-content:center;display:flex;flex-direction:column;align-items:center;}
.donut{width:215px;height:215px;border-radius:50%;margin:auto;position:relative;}
.donut-hole{position:absolute;inset:30%;background:#fff;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;}
.donut-hole span{font-size:9px;color:var(--mut);letter-spacing:.1em;}
.donut-hole b{font-family:'Manrope';font-weight:800;font-size:14px;margin-top:2px;}
table.ops td{padding:3.5px 7px;}
table.ops td.dim{color:var(--ink2);}
table.ops td.note{color:var(--mut);font-size:9px;}
.tpos{color:var(--green);font-weight:700;}.tneg{color:var(--red);font-weight:700;}
.ops .z{color:#cbd5e1;font-style:normal;}
table.ops th,table.tbl.ops th{padding-bottom:6px;}
`;

export const FINREPORT_SCHEMA = {
  meta: '{ title, period, company, generated }',
  kpi: '{ revenue, revenuePrev, expense, expensePrev, profit, profitPrev, avgCheck, txns }',
  summary: '[ { section } | { label, cur, prev, strong? } ]',
  byCompany: '[ { name, revenue, cash, cashless, online, card, txns } ]',
  expenses: '[ { name, amount } ]',
  operations: '[ { date, type, company, cat, amount, cash, cashless, online, card, note } ]',
  purchasingPlan: '[ { company, day, category, title, supplier, qty, amount, bought } ] (опц.)',
  purchasingPlanWeek: 'string (опц., подпись недели плана)',
};
