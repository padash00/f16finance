/**
 * Оформление PDF-отчёта «Разбор смен и эффективности продавцов».
 *
 * Один файл на все пять типов страниц: цвета, шрифты и кирпичики верстки
 * должны совпадать, иначе документ распадается на пять разных документов.
 *
 * Главное правило вёрстки записано в `.pdf-page.portrait`: страницы смены
 * читают с телефона, вертикальным скроллом. Поэтому там нет ни трёх колонок,
 * ни таблиц во всю ширину, а основной текст не опускается ниже 8.5 pt. Если
 * содержимое не влезает — появляется ещё одна страница, а не мельче шрифт.
 */

export const FONT_IMPORT =
  "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Lato:wght@400;700;900&display=swap');"

export const PDF_CSS = `
:root {
  --orda-navy: #0C213A;
  --orda-navy-2: #153A62;

  --orda-bg: #F2F6FA;
  --orda-white: #FFFFFF;

  --orda-text: #10263F;
  --orda-muted: #72849A;
  --orda-line: #D6E0EB;

  --orda-green: #15AE5C;
  --orda-green-soft: #EAF8EF;

  --orda-teal: #168F88;
  --orda-teal-soft: #EAF8F6;

  --orda-amber: #E89C00;
  --orda-amber-soft: #FFF5DF;

  --orda-red: #E64B43;
  --orda-red-soft: #FFF0EE;

  --orda-blue: #2F6FD4;
  --orda-blue-soft: #EDF4FF;

  --orda-gray: #93A4B8;
  --orda-gray-soft: #F5F7FA;

  --orda-logo-lime: #A8E62F;
}

* {
  box-sizing: border-box;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

html, body { margin: 0; padding: 0; }

body {
  font-family: Inter, Lato, Manrope, Arial, sans-serif;
  color: var(--orda-text);
  background: var(--orda-white);
}

.pdf-page {
  position: relative;
  overflow: hidden;
  background: var(--orda-bg);
  page-break-after: always;
}
.pdf-page:last-child { page-break-after: auto; }

.pdf-page.landscape { width: 297mm; height: 210mm; }
.pdf-page.portrait  { width: 210mm; height: 297mm; }

/* ─── Шапки ──────────────────────────────────────────────────────────────── */

.head {
  background: var(--orda-navy);
  color: var(--orda-white);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.landscape .head { height: 25mm; padding: 0 15mm; }
.portrait  .head { height: 29mm; padding: 0 9mm; }

.head-title {
  font-weight: 800;
  letter-spacing: .06em;
  text-transform: uppercase;
}
.landscape .head-title { font-size: 15pt; }
.portrait  .head-title { font-size: 13pt; }

.head-sub {
  margin-top: 1.5mm;
  font-size: 8pt;
  font-weight: 400;
  color: #A9BDD4;
}

.head-right { text-align: right; }
.brand {
  font-weight: 800;
  font-size: 8.5pt;
  letter-spacing: .32em;
  color: var(--orda-logo-lime);
}
.head-page {
  margin-top: 1.5mm;
  font-size: 7.5pt;
  color: #8FA6C2;
}

/* ─── Подвал ─────────────────────────────────────────────────────────────── */

.foot {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  justify-content: space-between;
  color: var(--orda-gray);
  font-size: 6pt;
}
.landscape .foot { height: 9mm; padding: 0 15mm; align-items: center; }
.portrait  .foot { height: 8mm; padding: 0 9mm;  align-items: center; }

/* ─── Тело ───────────────────────────────────────────────────────────────── */

.body { }
.landscape .body { padding: 6mm 15mm 11mm; }
.portrait  .body { padding: 5mm 9mm 10mm; }

.card {
  background: var(--orda-white);
  border: 1px solid var(--orda-line);
  border-radius: 9px;
  break-inside: avoid;
  page-break-inside: avoid;
}

.sec-title {
  font-size: 9pt;
  font-weight: 700;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: var(--orda-muted);
  margin: 0 0 2.5mm;
}

.muted { color: var(--orda-muted); }
.nowrap { white-space: nowrap; }

/* ─── Цветные состояния ──────────────────────────────────────────────────── */

.tone-positive { color: var(--orda-green); }
.tone-negative { color: var(--orda-red); }
.tone-warning  { color: var(--orda-amber); }
.tone-neutral  { color: var(--orda-navy-2); }
.tone-no_data  { color: var(--orda-gray); }

.bg-positive { background: var(--orda-green-soft); }
.bg-negative { background: var(--orda-red-soft); }
.bg-warning  { background: var(--orda-amber-soft); }
.bg-neutral  { background: var(--orda-gray-soft); }
.bg-no_data  { background: var(--orda-gray-soft); }

.bg-trusted   { background: var(--orda-teal-soft); }
.bg-doubtful  { background: var(--orda-amber-soft); }
.bg-too_early { background: var(--orda-gray-soft); }

.fg-trusted   { color: var(--orda-teal); }
.fg-doubtful  { color: var(--orda-amber); }
.fg-too_early { color: var(--orda-muted); }

.badge {
  display: inline-block;
  border-radius: 999px;
  padding: 1mm 3mm;
  font-size: 7.5pt;
  font-weight: 700;
  white-space: nowrap;
}

/* ─── Страница 1: сводка месяца ──────────────────────────────────────────── */

.hero {
  height: 60mm;
  background: var(--orda-navy);
  border-radius: 10px;
  color: var(--orda-white);
  display: flex;
  align-items: stretch;
  overflow: hidden;
}
.hero-bar { width: 4mm; background: var(--orda-green); flex: none; }
.hero-left { flex: 1; padding: 7mm 8mm; display: flex; flex-direction: column; justify-content: center; }
.hero-eyebrow { font-size: 7.5pt; letter-spacing: .28em; font-weight: 700; color: var(--orda-logo-lime); }
.hero-point { margin-top: 1mm; font-size: 9pt; letter-spacing: .18em; font-weight: 700; color: #A9BDD4; }
.hero-h1 { margin-top: 4mm; font-size: 23pt; font-weight: 800; line-height: 1.15; }
.hero-meta { margin-top: 4mm; font-size: 8.5pt; color: #A9BDD4; }
.hero-divider { width: 1px; background: rgba(255,255,255,.16); margin: 9mm 0; flex: none; }
.hero-right { width: 78mm; padding: 7mm 8mm; display: flex; flex-direction: column; justify-content: center; }
.hero-num { font-size: 30pt; font-weight: 800; line-height: 1; }
.hero-num-sub { margin-top: 1.5mm; font-size: 8pt; color: #A9BDD4; }
.hero-money { margin-top: 7mm; font-size: 17pt; font-weight: 800; }

.kpi-row { display: flex; gap: 4mm; }
.kpi {
  flex: 1;
  background: var(--orda-white);
  border: 1px solid var(--orda-line);
  border-radius: 9px;
  border-top: 3px solid var(--orda-gray);
  padding: 4mm 5mm;
}
.kpi.accent-green { border-top-color: var(--orda-green); }
.kpi.accent-red   { border-top-color: var(--orda-red); }
.kpi.accent-amber { border-top-color: var(--orda-amber); }
.kpi.accent-navy  { border-top-color: var(--orda-navy); }
.kpi-label { font-size: 7pt; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--orda-muted); }
.kpi-value { margin-top: 1.5mm; font-size: 26pt; font-weight: 800; line-height: 1; }
.kpi-hint { margin-top: 2mm; font-size: 7.5pt; color: var(--orda-muted); line-height: 1.35; }

.struct-head { display: flex; justify-content: space-between; align-items: baseline; }
.struct-title { font-size: 11pt; font-weight: 700; }
.bar { display: flex; height: 7mm; border-radius: 4px; overflow: hidden; margin-top: 3mm; background: var(--orda-gray-soft); }
.bar-seg { height: 100%; }
.legend { display: flex; gap: 6mm; margin-top: 3mm; flex-wrap: wrap; }
.legend-item { display: flex; align-items: center; gap: 1.5mm; font-size: 7.5pt; color: var(--orda-text); }
.legend-dot { width: 2.6mm; height: 2.6mm; border-radius: 2px; }

.howto {
  background: var(--orda-navy);
  border-radius: 9px;
  color: #C7D6E6;
  padding: 5mm 6mm;
}
.howto-title { font-size: 8pt; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; color: var(--orda-green); }
.howto-cols { display: flex; gap: 7mm; margin-top: 3mm; }
.howto-col { flex: 1; font-size: 7.8pt; line-height: 1.5; }

/* ─── Страница 2: продавцы ───────────────────────────────────────────────── */

.sellers-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-auto-rows: 1fr;
  gap: 3.6mm;
  height: 152mm;
}
.seller {
  border: 1px solid var(--orda-line);
  border-radius: 9px;
  background: var(--orda-white);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  break-inside: avoid;
}
.seller-head {
  background: var(--orda-navy);
  color: var(--orda-white);
  padding: 2.6mm 3.4mm;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2mm;
}
.seller-name { font-size: 10pt; font-weight: 700; line-height: 1.15; }
.seller-name.long { font-size: 8.5pt; }
.seller-score { font-size: 9pt; font-weight: 800; }
.seller-row { padding: 2.2mm 3.4mm; display: flex; justify-content: space-between; gap: 2mm; align-items: center; }
.seller-status { font-size: 7pt; color: var(--orda-muted); line-height: 1.3; }
.seller-facts { padding: 0 3.4mm 2mm; display: flex; gap: 3.5mm; font-size: 7.5pt; }
.seller-facts b { font-weight: 700; }
.seller-tags { padding: 0 3.4mm 2mm; display: flex; flex-wrap: wrap; gap: 1.4mm; }
.tag { font-size: 6.4pt; font-weight: 600; padding: .6mm 1.8mm; border-radius: 999px; }
.seller-metrics { padding: 0 3.4mm; }
.seller-metric {
  display: flex;
  justify-content: space-between;
  padding: 1.1mm 0;
  border-top: 1px solid var(--orda-line);
  font-size: 7pt;
}
.seller-metric-l { color: var(--orda-muted); letter-spacing: .05em; text-transform: uppercase; font-size: 6.4pt; }
.seller-metric-v { font-weight: 700; }
.seller-bottom { margin-top: auto; padding: 2.2mm 3.4mm; font-size: 7pt; line-height: 1.35; }
.seller-bottom b { display: block; font-size: 6.4pt; text-transform: uppercase; letter-spacing: .08em; margin-bottom: .6mm; }

/* ─── Страницы смены (портрет, читают с телефона) ─────────────────────────── */

.shift-hero { display: flex; justify-content: space-between; gap: 4mm; padding: 4mm 5mm; }
.shift-when { font-size: 9pt; color: var(--orda-muted); }
.shift-seller { margin-top: 1mm; font-size: 20pt; font-weight: 800; line-height: 1.1; }
.shift-seller.long { font-size: 15pt; }
.shift-badges { display: flex; flex-direction: column; gap: 1.6mm; align-items: flex-end; max-width: 40mm; }

.kpi2 { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm; margin-top: 3.5mm; }
.kpi2 .card { padding: 3.2mm 4mm; }
.kpi2-label { font-size: 6.6pt; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--orda-muted); }
.kpi2-value { margin-top: 1mm; font-size: 17pt; font-weight: 800; line-height: 1; }
.kpi2-value.small { font-size: 13pt; }
.kpi2-sub { margin-top: 1.2mm; font-size: 7.5pt; color: var(--orda-muted); }

.conclusion { margin-top: 3.5mm; border-radius: 9px; border: 1px solid var(--orda-line); overflow: hidden; background: var(--orda-white); }
.conclusion-accent { height: 1.6mm; }
.conclusion-body { padding: 3.5mm 5mm 4mm; }
.conclusion-text { margin-top: 1.5mm; font-size: 11pt; font-weight: 700; line-height: 1.35; }

.metrics-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2.6mm; margin-top: 2.5mm; }
.metric {
  border: 1px solid var(--orda-line);
  border-radius: 8px;
  padding: 2.6mm 3.2mm;
  break-inside: avoid;
}
.metric-top { display: flex; justify-content: space-between; align-items: baseline; gap: 2mm; }
.metric-label { font-size: 6.8pt; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--orda-muted); }
.metric-delta { font-size: 12pt; font-weight: 800; }
.metric-delta.small { font-size: 8.5pt; }
.metric-nums { margin-top: 1.4mm; font-size: 7.6pt; color: var(--orda-text); }

.two-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm; margin-top: 3mm; }
.soft-card { border-radius: 9px; padding: 3.4mm 4mm; break-inside: avoid; }
.soft-title { font-size: 6.8pt; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
.soft-text { margin-top: 1.6mm; font-size: 9pt; line-height: 1.45; }

.limits { margin-top: 3mm; border-radius: 9px; padding: 3.4mm 4mm; }
.limits ul { margin: 1.6mm 0 0; padding-left: 4.5mm; }
.limits li { font-size: 8.6pt; line-height: 1.45; margin-bottom: .8mm; }

/* ─── Почему такой вывод ─────────────────────────────────────────────────── */

.strip { border-radius: 9px; padding: 3.6mm 5mm; }
.strip-title { font-size: 8.5pt; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
.strip-text { margin-top: 1.6mm; font-size: 10.5pt; font-weight: 600; line-height: 1.35; }

.reason { margin-top: 3mm; border-radius: 9px; padding: 3.6mm 4.5mm; break-inside: avoid; }
.reason-title { font-size: 7pt; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
.reason-text { margin-top: 1.5mm; font-size: 9pt; line-height: 1.5; }
.reason-text p { margin: 0 0 1.4mm; }
.reason-text p:last-child { margin-bottom: 0; }

.context-head { display: flex; justify-content: space-between; align-items: baseline; gap: 3mm; }
.context-hint { font-size: 6.8pt; color: var(--orda-muted); text-align: right; max-width: 55mm; line-height: 1.3; }
.context-list { margin-top: 2mm; }
.context-item { display: flex; gap: 2.5mm; font-size: 8.6pt; line-height: 1.45; margin-bottom: 1.2mm; }
.context-key { flex: none; width: 26mm; font-weight: 700; }

/* ─── Словарь ────────────────────────────────────────────────────────────── */

.gloss-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3.6mm; }
.gloss {
  background: var(--orda-white);
  border: 1px solid var(--orda-line);
  border-left-width: 3px;
  border-radius: 8px;
  padding: 3mm 3.6mm;
  min-height: 26mm;
  break-inside: avoid;
}
.gloss-term { font-size: 8.6pt; font-weight: 700; line-height: 1.25; }
.gloss-mean { margin-top: 1.6mm; font-size: 7.6pt; line-height: 1.45; color: var(--orda-text); }
.acc-green { border-left-color: var(--orda-green); }
.acc-amber { border-left-color: var(--orda-amber); }
.acc-red   { border-left-color: var(--orda-red); }
.acc-blue  { border-left-color: var(--orda-blue); }
.acc-teal  { border-left-color: var(--orda-teal); }
.acc-gray  { border-left-color: var(--orda-gray); }
.acc-navy  { border-left-color: var(--orda-navy); }

.principle { margin-top: 4mm; background: var(--orda-navy); border-radius: 9px; padding: 5mm 6mm; color: #C7D6E6; }
.principle-title { font-size: 8pt; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; color: var(--orda-green); }
.principle-text { margin-top: 2mm; font-size: 10pt; line-height: 1.5; color: var(--orda-white); }

.empty-note { padding: 20mm 0; text-align: center; font-size: 10pt; color: var(--orda-muted); }
`
