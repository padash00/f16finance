/* eslint-disable */
/**
 * Orda Control — простой табличный отчёт в PDF (A4 landscape).
 * Для списков (клиенты, склад, сотрудники, зарплата и т.п.), которым не подходит
 * формат финансового отчёта. Фирменный стиль (navy-шапка), авто-пагинация.
 *
 * Контракт:
 *   meta: { title, period?, company?, generated }
 *   columns: [ { key, label, align?: 'left'|'right' } ]
 *   rows: [ { [key]: string|number } ]   // значения уже отформатированы или числа
 *   total?: { [key]: string|number }     // опц. строка ИТОГО
 *   note?: string                        // опц. подпись под таблицей
 *
 * Многосекционный режим (детальные отчёты «сводная + разбивка по точкам»):
 *   sections: [ { title, columns, rows, total?, note?, dense? } ]
 *   — каждая секция начинается с новой страницы, со своей пагинацией;
 *     meta/columns/rows верхнего уровня при этом игнорируются.
 *     dense: true — компактные строки (для длинных детализаций до ~34 строк на страницу).
 * Строка с полем heading: true рисуется как подзаголовок-полоса внутри таблицы.
 */

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const fmtCell = (v) => {
  if (v == null || v === '') return '<i class="z">—</i>';
  if (typeof v === 'number') return Number(Math.round(v)).toLocaleString('ru-RU').replace(/ /g, ' ');
  return esc(v);
};

const ROWS_PER_PAGE = 26;

function header(meta, pageNo, total) {
  const sub = [meta.period, meta.company].filter(Boolean).map(esc).join(' · ');
  return `<header>
    <div class="h-l"><div class="h-title">${esc(meta.title || 'ОТЧЁТ')}</div>
      <div class="h-sub">${sub}${sub ? ' · ' : ''}сформирован ${esc(meta.generated)}</div></div>
    <div class="h-r"><div class="h-brand">ORDA CONTROL</div><div class="h-pg">стр. ${pageNo} / ${total}</div></div>
  </header>`;
}
const footer = (meta) => `<div class="foot">Orda Control · ${esc(meta.title || 'отчёт')} · ${esc(meta.generated)}</div>`;

function row(cols, r) {
  if (r && r.heading) return `<tr class="hrow"><td colspan="${cols.length}">${esc(r.heading)}</td></tr>`;
  const cls = r && r.strong ? ' strong' : '';
  return `<tr class="${cls.trim()}">${cols.map((c) => `<td class="${c.align === 'right' ? 'num' : ''}${cls}">${fmtCell(r[c.key])}</td>`).join('')}</tr>`;
}

export function renderTableHTML(d, { fontCss = '' } = {}) {
  const sections = Array.isArray(d.sections) && d.sections.length
    ? d.sections
    : [{ title: d.meta?.title, columns: d.columns, rows: d.rows, total: d.total, note: d.note }];

  // Собираем плоский список страниц по всем секциям (сквозная нумерация).
  const pageDefs = [];
  for (const s of sections) {
    const rows = s.rows || [];
    const perPage = s.dense ? 34 : ROWS_PER_PAGE;
    const chunks = [];
    for (let i = 0; i < rows.length; i += perPage) chunks.push(rows.slice(i, i + perPage));
    if (chunks.length === 0) chunks.push([]);
    chunks.forEach((chunk, ci) => pageDefs.push({ section: s, chunk, ci, parts: chunks.length, rowsCount: rows.length }));
  }
  const total = pageDefs.length;

  const pages = pageDefs.map((p, pi) => {
    const s = p.section;
    const cols = s.columns || [];
    const isLast = p.ci === p.parts - 1;
    const thead = `<thead><tr>${cols.map((c) => `<th class="${c.align === 'right' ? 'num' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead>`;
    const totalRow = s.total
      ? `<tr class="total">${cols.map((c, i) => `<td class="${c.align === 'right' ? 'num' : ''}">${i === 0 && s.total[c.key] == null ? 'ИТОГО' : fmtCell(s.total[c.key])}</td>`).join('')}</tr>`
      : '';
    const body = p.chunk.map((r) => row(cols, r)).join('') || `<tr><td colspan="${cols.length}" class="empty">Нет данных за период</td></tr>`;
    return `<div class="page">${header(d.meta, pi + 1, total)}<div class="body">
      <div class="card grow${s.dense ? ' dense' : ''}">
        <div class="card-h">${esc(s.title || d.meta.title || 'Данные')} <span class="muted">${p.rowsCount} строк${p.parts > 1 ? ` · часть ${p.ci + 1}/${p.parts}` : ''}</span></div>
        <table class="tbl">${thead}<tbody>${body}${isLast ? totalRow : ''}</tbody></table>
        ${isLast && s.note ? `<div class="note">${esc(s.note)}</div>` : ''}
      </div>
    </div>${footer(d.meta)}</div>`;
  }).join('');

  const html = pages.replace(/₸/g, '<span class="tg">₸</span>');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${fontCss}\n${CSS}</style></head><body>${html}</body></html>`;
}

export const PDF_OPTIONS = { landscape: true, format: 'A4', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } };

const CSS = `
*{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
:root{--navy:#0c1a2e;--navy2:#13294a;--ink:#0f172a;--ink2:#475569;--mut:#94a3b8;--line:#e8edf3;--band:#f6f8fb;--lime:#a3e635;}
@page{size:A4 landscape;margin:0;}
html,body{font-family:'Inter',system-ui,sans-serif;color:var(--ink);background:#fff;}
.tg{font-family:'Inter','Manrope','Noto Sans',sans-serif;}
.page{width:297mm;height:210mm;overflow:hidden;page-break-after:always;display:flex;flex-direction:column;background:#fff;}
.page:last-child{page-break-after:auto;}
header{background:linear-gradient(110deg,var(--navy),var(--navy2));color:#fff;display:flex;justify-content:space-between;align-items:center;padding:7mm 13mm 6mm;}
.h-title{font-family:'Manrope';font-weight:800;font-size:21px;letter-spacing:.04em;text-transform:uppercase;}
.h-sub{font-size:10px;color:#9db4d6;margin-top:4px;}
.h-r{text-align:right;}
.h-brand{font-family:'Manrope';font-weight:800;font-size:13px;letter-spacing:.32em;color:var(--lime);}
.h-pg{font-size:9px;color:#7e97bd;margin-top:5px;letter-spacing:.04em;}
.body{flex:1;padding:6mm 13mm 3mm;display:flex;flex-direction:column;gap:5mm;min-height:0;}
.foot{padding:4px 13mm 6px;font-size:8.5px;color:#aeb9c7;text-align:center;border-top:1px solid #f1f5f9;}
.muted{color:var(--mut);font-weight:600;font-size:10px;}
.card{border:1px solid var(--line);border-radius:14px;padding:12px 15px;min-width:0;}
.card.grow{flex:1;display:flex;flex-direction:column;min-height:0;}
.card-h{font-family:'Manrope';font-weight:800;font-size:12px;letter-spacing:.02em;margin-bottom:9px;display:flex;justify-content:space-between;align-items:baseline;}
.note{font-size:9px;color:var(--mut);margin-top:8px;line-height:1.4;}
table.tbl{width:100%;border-collapse:collapse;table-layout:fixed;}
table.tbl th{font-size:8.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--mut);padding:0 7px 7px;text-align:left;border-bottom:1.5px solid var(--line);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
table.tbl th.num{text-align:right;}
table.tbl td{font-size:10px;padding:5px 7px;border-bottom:1px solid #f4f7fa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
table.tbl td.num{text-align:right;font-family:'Manrope';font-weight:600;}
table.tbl td.empty{text-align:center;color:var(--mut);font-style:italic;padding:18px 0;}
table.tbl tr.total td{font-family:'Manrope';font-weight:800;border-top:1.5px solid #cbd5e1;border-bottom:none;padding-top:8px;background:var(--band);}
table.tbl tr.hrow td{font-family:'Manrope';font-weight:800;font-size:8.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink2);background:var(--band);padding:6px 7px 5px;}
table.tbl td.strong{font-family:'Manrope';font-weight:800;background:#f0fdf4;}
.card.dense table.tbl td{font-size:9.5px;padding:3.5px 7px;}
.card.dense table.tbl tr.hrow td{padding:4.5px 7px 3.5px;}
.tbl .z{color:#cbd5e1;font-style:normal;}
`;
