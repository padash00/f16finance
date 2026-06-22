/* eslint-disable */
/**
 * Orda Control — единый шаблон управленческого отчёта (P&L) для выгрузки в PDF.
 * Framework-agnostic. Рендер PDF — headless Chromium. Контракт данных — см. REPORT_SCHEMA.
 * Источник: ТЗ_PDF_выгрузка.md + orda-report-template.js (поставка).
 */

// ---------- Палитра групп расходов ----------
export const GROUPS = {
  goods: { label: 'Себестоимость',  color: '#16a34a' },
  fot:   { label: 'ФОТ',            color: '#2563eb' },
  ops:   { label: 'Операционные',   color: '#f59e0b' },
  pos:   { label: 'POS / эквайринг', color: '#8b5cf6' },
  tax:   { label: 'Зарпл. налоги',  color: '#0d9488' },
  other: { label: 'Прочее',         color: '#ef4444' },
};
const FALLBACK = { label: 'Прочее', color: '#94a3b8' };
const grp = (k) => GROUPS[k] || FALLBACK;

// ---------- Хелперы ----------
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const fmt = (n) => Number(n || 0).toLocaleString('ru-RU').replace(/ /g, ' ');
const pct = (a, b) => (b ? (a / b * 100) : 0).toFixed(1);

function expenseColumns(n) {
  if (n <= 10) return 1;
  if (n <= 26) return 2;
  return 3;
}
function capexMode(capex) {
  if (!capex || !capex.groups || capex.groups.length === 0) return 'none';
  const items = capex.groups.reduce((s, g) => s + (g.items?.length || 0), 0);
  return (capex.groups.length <= 1 && items <= 8) ? 'inline' : 'page';
}

// ---------- Блоки ----------
function header(r, pageNo, totalPages) {
  return `
  <header>
    <div class="h-left">
      <div class="h-title">УПРАВЛЕНЧЕСКИЙ ОТЧЁТ</div>
      <div class="h-sub">${esc(r.name)} · ${esc(r.period)} · сформирован ${esc(r.generated)}</div>
    </div>
    <div class="h-right">
      <div class="h-brand">ORDA CONTROL</div>
      <div class="h-page">страница ${pageNo} / ${totalPages}</div>
    </div>
  </header>`;
}
function footer(r) {
  return `<div class="foot">Orda Control · отчёт «${esc(r.name)}» · ${esc(r.generated)}</div>`;
}

function kpi(r) {
  return `
  <div class="kpi-strip">
    <div class="kpi">
      <div class="kpi-lbl">Оборот</div>
      <div class="kpi-val">${fmt(r.turnover)} <span class="cur">₸</span></div>
      <div class="kpi-sub">100% входящего оборота</div>
    </div>
    <div class="kpi">
      <div class="kpi-lbl orange">Расходы</div>
      <div class="kpi-val">${fmt(r.expenses)} <span class="cur">₸</span></div>
      <div class="kpi-sub">${pct(r.expenses, r.turnover)}% от оборота</div>
    </div>
    <div class="kpi">
      <div class="kpi-lbl red">Налог${r.taxRate ? ' ' + r.taxRate : ''}</div>
      <div class="kpi-val">${fmt(r.tax)} <span class="cur">₸</span></div>
      <div class="kpi-sub">${pct(r.tax, r.turnover)}% нагрузка</div>
    </div>
    <div class="kpi profit">
      <div class="kpi-lbl green">Чистая прибыль</div>
      <div class="kpi-val">${fmt(r.profit)} <span class="cur">₸</span></div>
      <div class="kpi-sub">Рентабельность ${r.margin}%</div>
    </div>
  </div>`;
}

function fotBlock(r) {
  if (!r.fot || r.fot.length === 0) return '';
  const cards = r.fot.map((f) =>
    `<div class="fot-c"><div class="fot-l">${esc(f.label)}</div><div class="fot-v">${fmt(f.amount)} <span>₸</span></div></div>`).join('');
  const total = r.fotTotal ?? r.fot.reduce((s, f) => s + f.amount, 0);
  return `
  <div class="card fot">
    <div class="card-h"><span>Фонд оплаты труда</span><span class="muted">все статьи группы ФОТ</span></div>
    <div class="fot-grid">
      ${cards}
      <div class="fot-c total"><div class="fot-l">Итого ФОТ</div><div class="fot-v">${fmt(total)} <span>₸</span></div></div>
    </div>
  </div>`;
}

function bar(r) {
  const pE = pct(r.expenses, r.turnover), pT = pct(r.tax, r.turnover);
  return `
  <div class="card">
    <div class="card-h"><span>Куда ушёл оборот</span><span class="muted">100% = ${fmt(r.turnover)} ₸</span></div>
    <div class="stack">
      <div class="seg" style="width:${r.margin}%;background:#16a34a">${r.margin}%</div>
      <div class="seg" style="width:${pE}%;background:#f97316">${pE}%</div>
      <div class="seg" style="width:${pT}%;background:#ef4444"></div>
    </div>
    <div class="stack-lg">
      <span><i style="background:#16a34a"></i>Прибыль ${fmt(r.profit)} ₸</span>
      <span><i style="background:#f97316"></i>Расходы ${fmt(r.expenses)} ₸</span>
      <span><i style="background:#ef4444"></i>Налог ${fmt(r.tax)} ₸</span>
    </div>
  </div>`;
}

function formula(r) {
  const control = r.control10 ?? Math.round(r.profit * 0.1);
  // Если задано распределение по партнёрам — показываем его блоком ниже,
  // а дублирующую «контрольную долю 10%» в подвале формулы скрываем.
  const foot = (r.partners && r.partners.length)
    ? ''
    : `<div class="pnl-foot">Контрольная доля 10% от прибыли: ${fmt(control)} ₸</div>`;
  return `
  <div class="card pnl">
    <div class="pnl-h">Формула P&L</div>
    <div class="pnl-line">Оборот <b>${fmt(r.turnover)} ₸</b></div>
    <div class="pnl-line dim">минус налог ${fmt(r.tax)} ₸ и расходы ${fmt(r.expenses)} ₸</div>
    <div class="pnl-res">= чистая прибыль ${fmt(r.profit)} ₸</div>
    ${foot}
  </div>`;
}

// Распределение чистой прибыли по партнёрам.
function partnersBlock(r) {
  if (!r.partners || r.partners.length === 0) return '';
  const sumPct = r.partners.reduce((s, p) => s + (Number(p.percent) || 0), 0);
  const rows = r.partners.map((p) =>
    `<div class="pt-row"><span class="pt-name">${esc(p.name)}</span><span class="pt-pct">${p.percent}%</span><span class="pt-amt">${fmt(p.amount)} ₸</span></div>`).join('');
  return `
  <div class="card">
    <div class="card-h"><span>Распределение чистой прибыли</span><span class="muted">${sumPct}% от ${fmt(r.profit)} ₸</span></div>
    <div class="pt-list">${rows}</div>
  </div>`;
}

// Пояснение владельца — внизу страницы.
function noteBlock(r) {
  if (!r.note) return '';
  return `<div class="note-box"><div class="note-l">Пояснение</div><div class="note-t">${esc(r.note)}</div></div>`;
}

function expenseRows(r) {
  const max = Math.max(1, ...r.categories.map((c) => c.amount));
  return r.categories.map((c) => {
    const g = grp(c.g);
    const w = Math.max(4, c.amount / max * 100);
    const p = pct(c.amount, r.expenses);
    return `<div class="exp">
      <div class="exp-row">
        <span class="dot" style="background:${g.color}"></span>
        <span class="exp-name">${esc(c.name)}${c.sub ? `<span class="exp-sub"> · ${esc(c.sub)}</span>` : ''}</span>
        <span class="exp-pct">${p}%</span>
        <span class="exp-amt">${fmt(c.amount)}</span>
      </div>
      <div class="exp-bar"><i style="width:${w}%;background:${g.color}"></i></div>
    </div>`;
  }).join('');
}
function legend(r) {
  const used = [...new Set(r.categories.map((c) => c.g))];
  return used.map((k) => `<span class="lg"><i style="background:${grp(k).color}"></i>${grp(k).label}</span>`).join('');
}

function capexInline(cap) {
  const g = cap.groups[0];
  return `
  <div class="card cap-inline">
    <div class="card-h"><span>Капитальные вложения</span><span class="muted">справочно · вне P&L</span></div>
    <div class="cap-inline-h"><span>${esc(cap.title || g.name)}</span><span>${fmt(cap.total ?? g.total)} ₸</span></div>
    <div class="cap-inline-items">
      ${g.items.map((it) => `<div class="cap-il"><span>${esc(it[1])}</span><b>${fmt(it[2])} ₸</b></div>`).join('')}
    </div>
  </div>`;
}

function mainPage(r, totalPages) {
  const nCols = expenseColumns(r.categories.length);
  const mode = capexMode(r.capex);
  return `
  <div class="page">
    ${header(r, 1, totalPages)}
    <div class="body">
      ${kpi(r)}
      <div class="cols">
        <div class="col-left">
          <div class="card insight">
            <div class="insight-h">Главный вывод периода</div>
            <div class="insight-t">За период <b>${esc(r.period)}</b> чистая прибыль составила
              <b class="hl">${fmt(r.profit)} ₸</b> при рентабельности <b class="hl">${r.margin}%</b>.
              ${esc(r.insight || '')}</div>
          </div>
          ${fotBlock(r)}
          ${bar(r)}
          ${formula(r)}
          ${partnersBlock(r)}
        </div>
        <div class="col-right">
          <div class="sec-h"><span>Расходы за период</span><span class="badge">${r.categories.length} категорий</span></div>
          <div class="exp-grid c${nCols}">${expenseRows(r)}</div>
          <div class="legend">${legend(r)}</div>
          <div class="total-bar"><span>Итого расходов</span><span class="total-v">${fmt(r.expenses)} ₸</span></div>
          ${mode === 'inline' ? capexInline(r.capex) : ''}
        </div>
      </div>
      ${noteBlock(r)}
    </div>
    ${footer(r)}
  </div>`;
}

function capexPage(r, pageNo, totalPages) {
  const cap = r.capex;
  const cards = cap.groups.map((g) =>
    `<div class="cap-card"><div class="cap-card-l">${esc(g.name)}</div><div class="cap-card-v">${fmt(g.total)} <span>₸</span></div><div class="cap-card-n">${g.items.length} позиций</div></div>`).join('');
  const total = cap.total ?? cap.groups.reduce((s, g) => s + g.total, 0);
  const groupTable = (g, twoCol) => `
    <div class="cap-group">
      <div class="cap-group-h"><span>${esc(g.name)}</span><span class="cap-group-t">${fmt(g.total)} ₸</span></div>
      <div class="cap-items${twoCol ? ' two' : ''}">
        ${g.items.map((it) => `<div class="cap-item"><span class="cap-d">${esc(it[0])}</span><span class="cap-name">${esc(it[1])}</span><span class="cap-amt">${fmt(it[2])} ₸</span></div>`).join('')}
      </div>
    </div>`;
  const big = cap.groups.reduce((a, b) => (b.items.length > a.items.length ? b : a));
  const side = cap.groups.filter((g) => g !== big);
  const layout = side.length
    ? `<div class="cap-layout">
         <div class="cap-side">${side.map((g) => groupTable(g, false)).join('')}</div>
         <div class="cap-main">${groupTable(big, true)}</div>
       </div>`
    : `<div class="cap-solo">${groupTable(big, true)}</div>`;
  return `
  <div class="page">
    ${header(r, pageNo, totalPages)}
    <div class="body cap-body">
      <div class="sec-h"><span>Капитальные вложения</span><span class="badge">справочно · вне P&L</span></div>
      <div class="cap-cards">${cards}<div class="cap-card grand"><div class="cap-card-l">Итого вложений</div><div class="cap-card-v">${fmt(total)} <span>₸</span></div><div class="cap-card-n">за период</div></div></div>
      ${layout}
    </div>
    ${footer(r)}
  </div>`;
}

export function pageCount(r) {
  return capexMode(r.capex) === 'page' ? 2 : 1;
}

export function renderReportHTML(r, { fontCss = '' } = {}) {
  const total = pageCount(r);
  const pages = [mainPage(r, total)];
  if (capexMode(r.capex) === 'page') pages.push(capexPage(r, 2, total));
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<style>${fontCss}\n${REPORT_CSS}</style></head><body>${pages.join('')}</body></html>`;
}

export const PDF_OPTIONS = {
  landscape: true,
  format: 'A4',
  printBackground: true,
  margin: { top: '0', right: '0', bottom: '0', left: '0' },
};

export const REPORT_CSS = `
*{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
:root{--navy:#0c1a2e;--navy2:#13294a;--ink:#0f172a;--ink2:#475569;--mut:#94a3b8;--line:#e8edf3;--bg:#f6f8fb;--lime:#a3e635;--lime-d:#65a30d;}
@page{size:A4 landscape;margin:0;}
html,body{font-family:'Inter',system-ui,sans-serif;color:var(--ink);background:#fff;}
.page{width:297mm;height:210mm;background:#fff;position:relative;overflow:hidden;page-break-after:always;display:flex;flex-direction:column;}
.page:last-child{page-break-after:auto;}
header{background:linear-gradient(110deg,var(--navy),var(--navy2));color:#fff;display:flex;justify-content:space-between;align-items:center;padding:9mm 14mm 8mm;}
.h-title{font-family:'Manrope';font-weight:800;font-size:23px;letter-spacing:.02em;}
.h-sub{font-size:10.5px;color:#9db4d6;margin-top:4px;letter-spacing:.01em;}
.h-right{text-align:right;}
.h-brand{font-family:'Manrope';font-weight:800;font-size:13px;letter-spacing:.34em;color:var(--lime);}
.h-page{font-size:9.5px;color:#7e97bd;margin-top:5px;letter-spacing:.05em;}
.body{flex:1;padding:6mm 14mm 3mm;display:flex;flex-direction:column;gap:5mm;}
.kpi-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:5mm;}
.kpi{border:1px solid var(--line);border-radius:14px;padding:11px 16px;background:#fff;}
.kpi.profit{border:1.6px solid var(--lime);background:linear-gradient(180deg,#f7fee7,#fff);box-shadow:0 6px 18px -10px rgba(132,204,22,.5);}
.kpi-lbl{font-size:9px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:var(--mut);}
.kpi-lbl.orange{color:#ea7317;}.kpi-lbl.red{color:#e23b3b;}.kpi-lbl.green{color:var(--lime-d);}
.kpi-val{font-family:'Manrope';font-weight:800;font-size:21px;margin-top:6px;letter-spacing:-.01em;color:var(--ink);}
.kpi-val .cur{font-size:13px;color:var(--mut);font-weight:700;}
.kpi-sub{font-size:9.5px;color:var(--mut);margin-top:4px;}
.cols{flex:1;display:grid;grid-template-columns:0.92fr 1.08fr;gap:7mm;min-height:0;}
.col-left,.col-right{display:flex;flex-direction:column;gap:4.5mm;min-height:0;}
.card{border:1px solid var(--line);border-radius:14px;padding:12px 15px;background:#fff;}
.card-h{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:9px;}
.card-h>span:first-child{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--ink2);}
.muted{font-size:9px;color:var(--mut);}
.insight{background:var(--bg);border-color:#e2e8f0;}
.insight-h{font-family:'Manrope';font-weight:800;font-size:13px;margin-bottom:6px;}
.insight-t{font-size:11px;line-height:1.5;color:#334155;}
.insight-t b{font-weight:700;}.insight-t .hl{color:var(--lime-d);}
.fot{background:linear-gradient(180deg,#f3f8ff,#fff);border-color:#dbeafe;}
.fot-grid{display:flex;gap:6px;}
.fot-c{flex:1;min-width:0;border:1px solid #dbeafe;border-radius:11px;padding:9px 10px;background:#fff;}
.fot-c.total{background:#eff6ff;border-color:#bfdbfe;}
.fot-l{font-size:8.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#3b6fc4;white-space:nowrap;}
.fot-v{font-family:'Manrope';font-weight:800;font-size:12px;margin-top:5px;color:#1d3a6b;white-space:nowrap;}
.fot-v span{font-size:9px;color:#7da0d0;}
.stack{display:flex;height:26px;border-radius:9px;overflow:hidden;}
.stack .seg{display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:800;font-family:'Manrope';}
.stack-lg{display:flex;flex-wrap:wrap;gap:5px 16px;margin-top:9px;font-size:9.5px;color:#475569;}
.stack-lg span{display:flex;align-items:center;gap:6px;}.stack-lg i{width:9px;height:9px;border-radius:50%;}
.pnl{background:linear-gradient(135deg,var(--navy),var(--navy2));border:none;color:#cdddf2;margin-top:auto;}
.pnl-h{font-family:'Manrope';font-weight:800;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--lime);margin-bottom:8px;}
.pnl-line{font-size:11.5px;margin-bottom:3px;}.pnl-line b{color:#fff;font-weight:700;}
.pnl-line.dim{color:#8aa4c8;font-size:10.5px;}
.pnl-res{font-family:'Manrope';font-weight:800;font-size:15px;color:var(--lime);margin:7px 0 6px;}
.pnl-foot{font-size:9.5px;color:#7e97bd;border-top:1px solid rgba(255,255,255,.12);padding-top:7px;}
.pt-list{display:flex;flex-direction:column;gap:5px;margin-top:2px;}
.pt-row{display:flex;align-items:center;gap:8px;font-size:10px;}
.pt-name{flex:1;min-width:0;color:#1f2d4a;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.pt-pct{color:#6b7a96;font-weight:700;font-size:9px;}
.pt-amt{font-family:'Manrope';font-weight:800;color:#15803d;white-space:nowrap;}
.note-box{margin-top:10px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc;padding:11px 14px;}
.note-l{font-size:8.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;}
.note-t{margin-top:4px;font-size:10px;line-height:1.5;color:#33415c;white-space:pre-wrap;}
.sec-h{display:flex;justify-content:space-between;align-items:center;}
.sec-h>span:first-child{font-family:'Manrope';font-weight:800;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink);}
.badge{font-size:9px;font-weight:600;color:#64748b;background:#f1f5f9;border:1px solid #e2e8f0;padding:3px 9px;border-radius:20px;}
.exp-grid{flex:1;min-height:0;}
.exp-grid.c2{column-count:2;column-gap:16px;}
.exp-grid.c3{column-count:3;column-gap:14px;}
.exp{break-inside:avoid;padding:3px 0 4px;border-bottom:1px solid #f4f7fa;}
.exp-row{display:flex;align-items:center;gap:7px;}
.dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto;}
.exp-name{font-size:10px;font-weight:600;color:#1e293b;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;}
.exp-sub{font-weight:400;color:var(--mut);font-size:8.5px;}
.exp-pct{font-size:8.5px;color:#94a3b8;font-weight:600;flex:0 0 auto;}
.exp-amt{font-family:'Manrope';font-weight:700;font-size:10px;color:#0f172a;flex:0 0 auto;min-width:54px;text-align:right;}
.exp-bar{height:2.5px;background:#f1f5f9;border-radius:3px;margin:3px 0 0 14px;overflow:hidden;}
.exp-bar i{display:block;height:100%;border-radius:3px;}
.legend{display:flex;flex-wrap:wrap;gap:5px 14px;margin:7px 0 0;font-size:8.5px;color:#64748b;}
.lg{display:flex;align-items:center;gap:5px;}.lg i{width:8px;height:8px;border-radius:2px;}
.total-bar{margin-top:8px;background:linear-gradient(135deg,var(--navy),var(--navy2));color:#fff;border-radius:12px;padding:11px 16px;display:flex;justify-content:space-between;align-items:center;font-family:'Manrope';font-weight:800;font-size:13px;letter-spacing:.04em;}
.total-bar .total-v{font-size:16px;}
.cap-inline{margin-top:1mm;}
.cap-inline-h{display:flex;justify-content:space-between;font-family:'Manrope';font-weight:800;font-size:11px;color:#1e293b;padding-bottom:6px;border-bottom:1px solid var(--line);margin-bottom:5px;}
.cap-inline-items{columns:2;column-gap:16px;}
.cap-il{display:flex;justify-content:space-between;font-size:9.5px;color:#475569;padding:2.5px 0;break-inside:avoid;}
.cap-il b{font-family:'Manrope';font-weight:700;color:#0f172a;}
.cap-body{gap:5mm;}
.cap-cards{display:flex;gap:5mm;}
.cap-card{flex:1;border:1px solid var(--line);border-radius:13px;padding:13px 16px;background:#fff;}
.cap-card.grand{background:linear-gradient(135deg,var(--navy),var(--navy2));border:none;color:#fff;}
.cap-card.grand .cap-card-l{color:var(--lime);}.cap-card.grand .cap-card-n{color:#8aa4c8;}
.cap-card-l{font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ink2);}
.cap-card-v{font-family:'Manrope';font-weight:800;font-size:18px;margin-top:6px;}
.cap-card-v span{font-size:11px;color:var(--mut);}.cap-card.grand .cap-card-v span{color:#7da0d0;}
.cap-card-n{font-size:9px;color:var(--mut);margin-top:3px;}
.cap-layout{flex:1;display:flex;gap:14px;min-height:0;}
.cap-side{flex:1;display:flex;flex-direction:column;gap:9px;}
.cap-main{flex:2;}.cap-solo{flex:1;}
.cap-items.two{column-count:2;column-gap:14px;}.cap-items.two .cap-item{break-inside:avoid;}
.cap-group{break-inside:avoid;margin-bottom:9px;border:1px solid var(--line);border-radius:11px;overflow:hidden;}
.cap-group-h{display:flex;justify-content:space-between;align-items:center;background:#f6f8fb;padding:7px 11px;border-bottom:1px solid var(--line);}
.cap-group-h>span:first-child{font-family:'Manrope';font-weight:800;font-size:10px;color:#1e293b;}
.cap-group-t{font-family:'Manrope';font-weight:700;font-size:10px;color:var(--lime-d);}
.cap-items{padding:3px 11px 5px;}
.cap-item{display:flex;align-items:baseline;gap:8px;padding:2.3px 0;font-size:9px;border-bottom:1px solid #f4f7fa;}
.cap-item:last-child{border-bottom:none;}
.cap-d{font-size:7.5px;color:#a8b4c4;flex:0 0 auto;letter-spacing:.02em;}
.cap-name{flex:1;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.cap-amt{font-family:'Manrope';font-weight:600;color:#0f172a;flex:0 0 auto;}
.foot{padding:5px 14mm 7px;font-size:8.5px;color:#aeb9c7;text-align:center;border-top:1px solid #f1f5f9;}
`;
