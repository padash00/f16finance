/**
 * Страницы PDF-отчёта «Разбор смен и эффективности продавцов».
 *
 * Пять типов страниц, каждый отвечает на свой вопрос:
 *
 *   Сводка месяца     — что произошло за месяц
 *   Продавцы          — кто как работает
 *   Разбор смены      — что произошло именно в эту смену
 *   Почему такой вывод— почему система так решила
 *   Словарь           — что означают слова
 *
 * Шаблон ничего не считает и ничего не красит по своему усмотрению: и цифры,
 * и состояния приходят из контракта уже решёнными. Единственная арифметика,
 * которая здесь допустима, — ширина сегмента полосы: это чистая геометрия.
 */

import type {
  GlossaryItem,
  PdfMetric,
  SellerPdfSummary,
  ShiftEfficiencyPdfReport,
  ShiftPdfDetails,
} from './shift-efficiency-pdf-dto'
import { count, money } from './shift-efficiency-pdf-adapter'

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string)

/**
 * Место под номер страницы.
 *
 * Сам номер проставляется после склейки: во временных PDF он был бы «1 / 1»,
 * потому что каждая часть печатается отдельным заданием.
 */
const PAGE_SLOT = '&nbsp;'

function foot(report: ShiftEfficiencyPdfReport): string {
  return `<div class="foot">
    <span>Orda Control · ${esc(report.point.name)} · ${esc(report.period.monthLabel)}</span>
    <span>${PAGE_SLOT}</span>
  </div>`
}

function head(args: {
  title: string
  sub: string
  report: ShiftEfficiencyPdfReport
}): string {
  return `<div class="head">
    <div>
      <div class="head-title">${esc(args.title)}</div>
      <div class="head-sub">${esc(args.sub)}</div>
    </div>
    <div class="head-right">
      <div class="brand">ORDA CONTROL</div>
      <div class="head-page">${esc(args.report.period.monthLabel)}</div>
    </div>
  </div>`
}

// ─── Страница 1: сводка месяца ──────────────────────────────────────────────

export function renderMonthSummary(r: ShiftEfficiencyPdfReport): string {
  const s = r.summary

  const segments = [
    { key: 'strong', label: 'Сильные смены', value: s.strongShiftCount, color: 'var(--orda-green)' },
    { key: 'low', label: 'Мало покупателей', value: s.lowTrafficCount, color: 'var(--orda-amber)' },
    { key: 'question', label: 'Вопрос к продавцу', value: s.sellerQuestionCount, color: 'var(--orda-red)' },
    { key: 'other', label: 'Остальные', value: s.otherCount, color: 'var(--orda-gray)' },
  ].filter((x) => x.value > 0)

  const total = segments.reduce((sum, x) => sum + x.value, 0) || 1

  return `<section class="pdf-page landscape">
  ${head({ title: 'Разбор смен и эффективности продавцов', sub: `${r.point.name} · ${r.period.monthLabel} · управленческий отчёт`, report: r })}
  <div class="body">

    <div class="hero">
      <div class="hero-bar"></div>
      <div class="hero-left">
        <div class="hero-eyebrow">ORDA CONTROL</div>
        <div class="hero-point">${esc(r.point.name.toUpperCase())}</div>
        <div class="hero-h1">Разбор смен<br/>и эффективности продавцов</div>
        <div class="hero-meta">${esc(r.period.monthLabel)} · ${esc(r.period.from)} — ${esc(r.period.to)} · управленческий отчёт</div>
      </div>
      <div class="hero-divider"></div>
      <div class="hero-right">
        <div class="hero-num">${count(s.shiftsCount)}</div>
        <div class="hero-num-sub">смен разобрано</div>
        <div class="hero-money">${money(s.totalRevenue)}</div>
        <div class="hero-num-sub">${count(s.totalChecks)} чеков</div>
      </div>
    </div>

    <div style="margin-top:6mm">
      <div class="sec-title">Ключевая картина месяца</div>
      <div class="kpi-row">
        <div class="kpi accent-green">
          <div class="kpi-label">Сильных смен</div>
          <div class="kpi-value tone-positive">${count(s.strongShiftCount)}</div>
          <div class="kpi-hint">выше нормы по нескольким метрикам</div>
        </div>
        <div class="kpi accent-red">
          <div class="kpi-label">Вопрос к продавцу</div>
          <div class="kpi-value tone-negative">${count(s.sellerQuestionCount)}</div>
          <div class="kpi-hint">покупатели были, отдача ниже</div>
        </div>
        <div class="kpi accent-amber">
          <div class="kpi-label">Мало покупателей</div>
          <div class="kpi-value tone-warning">${count(s.lowTrafficCount)}</div>
          <div class="kpi-hint">слабый поток — не вина продавца</div>
        </div>
        <div class="kpi accent-navy">
          <div class="kpi-label">Продавцов</div>
          <div class="kpi-value tone-neutral">${count(s.sellerCount)}</div>
          <div class="kpi-hint">с указанным именем</div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:5mm;padding:4mm 5mm">
      <div class="struct-head">
        <span class="struct-title">Структура смен</span>
        <span class="muted" style="font-size:8pt">${count(s.shiftsCount)} смен</span>
      </div>
      <div class="bar">
        ${segments
          .map((x) => `<div class="bar-seg" style="width:${((x.value / total) * 100).toFixed(2)}%;background:${x.color}"></div>`)
          .join('')}
      </div>
      <div class="legend">
        ${segments
          .map(
            (x) => `<span class="legend-item">
              <span class="legend-dot" style="background:${x.color}"></span>
              ${esc(x.label)} · ${count(x.value)}
            </span>`,
          )
          .join('')}
      </div>
    </div>

    <div class="howto" style="margin-top:5mm">
      <div class="howto-title">Как читать отчёт</div>
      <div class="howto-cols">
        <div class="howto-col">
          Смена сравнивается не со средним по году, а с сопоставимыми условиями: тот же сезон, тот же
          день недели, дневная или ночная.
        </div>
        <div class="howto-col">
          Число чеков берётся как мера спроса. Счётчика посетителей у магазина нет, но чек оставляет
          каждый купивший, а привести людей в помещение продавец не может.
        </div>
        <div class="howto-col">
          Чем меньше сопоставимых смен и чем больше помех — короткая смена, погода, событие в городе —
          тем ниже доверие к выводу. Недостающие данные не заменяются нулями.
        </div>
      </div>
    </div>

  </div>
  ${foot(r)}
</section>`
}

// ─── Страница 2: продавцы ───────────────────────────────────────────────────

function sellerMetricRow(m: PdfMetric): string {
  return `<div class="seller-metric">
    <span class="seller-metric-l">${esc(m.label)}</span>
    <span class="seller-metric-v tone-${m.state}">${esc(m.deltaLabel)}</span>
  </div>`
}

function sellerCard(seller: SellerPdfSummary): string {
  const m = seller.metrics
  // Длинное имя не обрезаем многоточием: сначала уменьшаем только его.
  const longName = seller.name.length > 16

  const bottom = seller.strengths
    ? `<div class="seller-bottom bg-positive"><b>Сильные стороны</b>${esc(seller.strengths)}</div>`
    : seller.focus
      ? `<div class="seller-bottom bg-warning"><b>Фокус</b>${esc(seller.focus)}</div>`
      : `<div class="seller-bottom bg-neutral"><b>Пока без выводов</b>смен мало, сильных и слабых сторон не видно</div>`

  return `<div class="seller">
    <div class="seller-head">
      <div class="seller-name${longName ? ' long' : ''}">${seller.rank ? `${seller.rank}. ` : ''}${esc(seller.name)}</div>
      <div class="seller-score">${esc(seller.scoreVsNormLabel)}</div>
    </div>
    <div class="seller-row">
      <span class="seller-status">${esc(seller.statusText)}</span>
      <span class="badge bg-${seller.trustState} fg-${seller.trustState}">${esc(seller.trustLabel)}</span>
    </div>
    <div class="seller-facts">
      <span><b>${count(seller.shiftsCount)}</b> смен</span>
      <span><b>${count(seller.checksCount)}</b> чеков</span>
      <span><b>${money(seller.revenue)}</b></span>
    </div>
    ${
      seller.shiftTags.length
        ? `<div class="seller-tags">${seller.shiftTags
            .map((t) => `<span class="tag bg-${t.state} tone-${t.state}">${esc(t.label)} · ${t.count}</span>`)
            .join('')}</div>`
        : ''
    }
    <div class="seller-metrics">
      ${sellerMetricRow(m.avgCheck)}
      ${sellerMetricRow(m.itemsPerCheck)}
      ${sellerMetricRow(m.upsell)}
      ${sellerMetricRow(m.customerYield)}
      ${sellerMetricRow(m.plan)}
    </div>
    ${bottom}
  </div>`
}

/** Не больше шести карточек на страницу: сетка 3 × 2. */
export const SELLERS_PER_PAGE = 6

export function renderSellersOverview(r: ShiftEfficiencyPdfReport): string[] {
  if (r.sellers.length === 0) {
    return [
      `<section class="pdf-page landscape">
        ${head({ title: 'Эффективность продавцов', sub: `${r.point.name} · ${r.period.monthLabel}`, report: r })}
        <div class="body">
          <div class="card empty-note">
            За период нет смен с указанным продавцом. Если чеки пробивались без входа под своей учётной
            записью, оценить работу людей не из чего.
          </div>
        </div>
        ${foot(r)}
      </section>`,
    ]
  }

  const pages: string[] = []
  for (let i = 0; i < r.sellers.length; i += SELLERS_PER_PAGE) {
    const chunk = r.sellers.slice(i, i + SELLERS_PER_PAGE)
    const partOf = r.sellers.length > SELLERS_PER_PAGE ? ` · часть ${Math.floor(i / SELLERS_PER_PAGE) + 1}` : ''

    pages.push(`<section class="pdf-page landscape">
      ${head({ title: 'Эффективность продавцов', sub: `${r.point.name} · ${r.period.monthLabel}${partOf}`, report: r })}
      <div class="body">
        <div class="sec-title">Оценка отражает работу с покупателем; выручка показана как контекст, а не как оценка эффективности</div>
        <div class="sellers-grid">
          ${chunk.map(sellerCard).join('')}
        </div>
      </div>
      ${foot(r)}
    </section>`)
  }
  return pages
}

// ─── Страница смены: разбор ─────────────────────────────────────────────────

function metricCard(m: PdfMetric): string {
  // Длинная подпись «нет нормы» не должна выглядеть как крупная цифра.
  const small = m.state === 'no_data' || m.deltaLabel.length > 6
  return `<div class="metric bg-${m.state}">
    <div class="metric-top">
      <span class="metric-label">${esc(m.label)}</span>
      <span class="metric-delta${small ? ' small' : ''} tone-${m.state}">${esc(m.deltaLabel)}</span>
    </div>
    <div class="metric-nums">было ${esc(m.factLabel)} · обычно бывает ${esc(m.normLabel)}</div>
  </div>`
}

const STATUS_BG: Record<string, string> = {
  positive: 'var(--orda-green)',
  negative: 'var(--orda-red)',
  warning: 'var(--orda-amber)',
  neutral: 'var(--orda-navy-2)',
}

export function renderShiftSummary(r: ShiftEfficiencyPdfReport, s: ShiftPdfDetails): string {
  const m = s.metrics
  const longName = s.sellerName.length > 14

  return `<section class="pdf-page portrait">
  ${head({
    title: 'Разбор смены',
    sub: `${s.date} · ${s.shiftTypeLabel} · ${s.sellerName}`,
    report: r,
  })}
  <div class="body">

    <div class="card shift-hero">
      <div>
        <div class="shift-when">${esc(s.date)} · ${esc(s.shiftTypeLabel)}</div>
        <div class="shift-seller${longName ? ' long' : ''}">${esc(s.sellerName)}</div>
      </div>
      <div class="shift-badges">
        <span class="badge bg-${s.statusState} tone-${s.statusState}">${esc(s.statusLabel)}</span>
        <span class="badge bg-neutral tone-neutral">${esc(s.scoreVsNormLabel)}</span>
        <span class="badge bg-${s.trustState} fg-${s.trustState}">${esc(s.trustLabel)}</span>
      </div>
    </div>

    <div class="kpi2">
      <div class="card">
        <div class="kpi2-label">Касса</div>
        <div class="kpi2-value${money(s.revenue).length > 12 ? ' small' : ''}">${money(s.revenue)}</div>
        <div class="kpi2-sub">обычно ${money(s.expectedRevenue)}</div>
      </div>
      <div class="card">
        <div class="kpi2-label">Покупателей</div>
        <div class="kpi2-value">${count(s.checks)}</div>
        <div class="kpi2-sub">обычно ${count(s.expectedChecks)}</div>
      </div>
      <div class="card">
        <div class="kpi2-label">Итоговый балл</div>
        <div class="kpi2-value">${s.score == null ? '—' : s.score.toFixed(2)}</div>
        <div class="kpi2-sub">1.00 = норма</div>
      </div>
      <div class="card">
        <div class="kpi2-label">Длительность</div>
        <div class="kpi2-value">${s.durationHours == null ? '—' : `${s.durationHours} ч`}</div>
        <div class="kpi2-sub">длительность смены</div>
      </div>
    </div>

    <div class="conclusion">
      <div class="conclusion-accent" style="background:${STATUS_BG[s.statusState] || 'var(--orda-gray)'}"></div>
      <div class="conclusion-body">
        <div class="soft-title tone-${s.statusState}">Главный вывод</div>
        <div class="conclusion-text">${esc(s.mainConclusion || 'Вывод по этой смене сделать не из чего.')}</div>
      </div>
    </div>

    <div style="margin-top:4mm">
      <div class="sec-title">Работа с покупателем</div>
      <div class="metrics-grid">
        ${metricCard(m.avgCheck)}
        ${metricCard(m.itemsPerCheck)}
        ${metricCard(m.upsell)}
        ${metricCard(m.customerYield)}
        ${metricCard(m.plan)}
        ${metricCard(m.productKnowledge)}
      </div>
    </div>

    <div class="two-cols">
      <div class="soft-card bg-neutral" style="background:var(--orda-blue-soft)">
        <div class="soft-title" style="color:var(--orda-blue)">Что это значит</div>
        <div class="soft-text">${esc(s.meaningText || 'Пояснение по этой смене не сформировано.')}</div>
      </div>
      <div class="soft-card" style="background:var(--orda-teal-soft)">
        <div class="soft-title" style="color:var(--orda-teal)">Что делать</div>
        <div class="soft-text">${esc(s.actionText || 'Действий не требуется.')}</div>
      </div>
    </div>

    ${
      s.limitations.length > 0
        ? `<div class="limits bg-warning">
            <div class="soft-title tone-warning">Где выводу нельзя доверять</div>
            <ul>${s.limitations.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
          </div>`
        : ''
    }

  </div>
  ${foot(r)}
</section>`
}

// ─── Страница смены: почему такой вывод ─────────────────────────────────────

function reasonCard(args: { title: string; text: string; bg: string; fg: string }): string {
  if (!args.text) return ''
  return `<div class="reason" style="background:${args.bg}">
    <div class="reason-title" style="color:${args.fg}">${esc(args.title)}</div>
    <div class="reason-text">${args.text
      .split('\n')
      .filter(Boolean)
      .map((p) => `<p>${esc(p)}</p>`)
      .join('')}</div>
  </div>`
}

export function renderShiftReasoning(r: ShiftEfficiencyPdfReport, s: ShiftPdfDetails): string {
  const ctx = s.context
  const contextRows: [string, string][] = []
  if (ctx.weather) contextRows.push(['Погода', ctx.weather])
  if (ctx.schools) contextRows.push(['Школы', ctx.schools])
  if (ctx.universities) contextRows.push(['Вузы', ctx.universities])
  if (ctx.colleges) contextRows.push(['Колледжи', ctx.colleges])
  if (ctx.unt) contextRows.push(['ЕНТ и гранты', ctx.unt])
  if (ctx.events?.length) contextRows.push(['Праздники и события', ctx.events.join('; ')])

  return `<section class="pdf-page portrait">
  ${head({
    title: 'Почему такой вывод',
    sub: `${s.date} · ${s.shiftTypeLabel} · ${s.sellerName}`,
    report: r,
  })}
  <div class="body">

    <div class="strip bg-${s.statusState}">
      <div class="strip-title tone-${s.statusState}">${esc(s.statusLabel)}</div>
      <div class="strip-text">${esc(s.mainConclusion || 'Вывод по этой смене сделать не из чего.')}</div>
    </div>

    ${reasonCard({ title: 'Спрос', text: s.reasoning.demandText, bg: 'var(--orda-blue-soft)', fg: 'var(--orda-blue)' })}
    ${reasonCard({ title: 'Касса', text: s.reasoning.revenueText, bg: 'var(--orda-teal-soft)', fg: 'var(--orda-teal)' })}
    ${reasonCard({
      title: 'Работа продавца',
      text: s.reasoning.sellerWorkText,
      bg:
        s.statusState === 'positive'
          ? 'var(--orda-green-soft)'
          : s.statusState === 'negative'
            ? 'var(--orda-red-soft)'
            : 'var(--orda-gray-soft)',
      fg:
        s.statusState === 'positive'
          ? 'var(--orda-green)'
          : s.statusState === 'negative'
            ? 'var(--orda-red)'
            : 'var(--orda-navy-2)',
    })}

    <div class="two-cols">
      ${
        s.reasoning.volumeText
          ? `<div class="soft-card card"><div class="soft-title muted">Объём</div><div class="soft-text">${esc(s.reasoning.volumeText)}</div></div>`
          : ''
      }
      ${
        s.reasoning.durationText
          ? `<div class="soft-card card"><div class="soft-title muted">Длительность</div><div class="soft-text">${esc(s.reasoning.durationText)}</div></div>`
          : ''
      }
    </div>

    ${
      contextRows.length > 0
        ? `<div class="reason" style="background:var(--orda-blue-soft)">
            <div class="context-head">
              <div class="reason-title" style="color:var(--orda-blue)">Обстановка в этот день</div>
              <div class="context-hint">контекст влияет на спрос, но не на оценку продавца</div>
            </div>
            <div class="context-list">
              ${contextRows
                .map(
                  ([key, value]) => `<div class="context-item">
                    <span class="context-key">${esc(key)}</span>
                    <span>${esc(value)}</span>
                  </div>`,
                )
                .join('')}
            </div>
          </div>`
        : `<div class="reason" style="background:var(--orda-gray-soft)">
            <div class="reason-title muted">Обстановка в этот день</div>
            <div class="reason-text">Ни погоды, ни праздников, ни учебных периодов. Значит, кассу нечем
            объяснить, кроме работы.</div>
          </div>`
    }

  </div>
  ${foot(r)}
</section>`
}

// ─── Словарь ────────────────────────────────────────────────────────────────

function glossCard(g: GlossaryItem): string {
  return `<div class="gloss acc-${g.accent}">
    <div class="gloss-term">${esc(g.term)}</div>
    <div class="gloss-mean">${esc(g.meaning)}</div>
  </div>`
}

export function renderGlossary(r: ShiftEfficiencyPdfReport): string {
  return `<section class="pdf-page landscape">
  ${head({ title: 'Словарь отчёта', sub: 'Что означают слова в отчёте', report: r })}
  <div class="body">
    <div class="gloss-grid">
      ${r.glossary.map(glossCard).join('')}
    </div>

    <div class="principle">
      <div class="principle-title">Главный принцип</div>
      <div class="principle-text">
        Сначала смотрим на спрос и условия смены, затем — на работу с каждым покупателем. Низкая касса не
        всегда означает плохую работу продавца, а высокая касса не всегда означает сильную смену.
      </div>
    </div>
  </div>
  ${foot(r)}
</section>`
}
