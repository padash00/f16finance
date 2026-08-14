/**
 * Признаки несамостоятельного ответа на ситуационный вопрос.
 *
 * Надёжных «детекторов ИИ-текста» не существует: любой такой классификатор
 * ошибается на аккуратно пишущих людях, а цена ошибки здесь — обвинение
 * сотрудника. Поэтому тут нет вердикта «писал ИИ». Есть объективные сигналы,
 * каждый из которых можно проверить глазами: сколько секунд занял ответ на
 * столько знаков, совпадает ли текст с ответом коллеги, выглядит ли он как
 * оформленная статья, а не как речь человека в чате.
 *
 * Решение принимает руководитель. Функция только помечает, что стоит смотреть.
 */

export type IntegritySignal = {
  code: 'speed' | 'duplicate' | 'style' | 'formatting'
  label: string
  detail: string
  /** Вклад в общий риск, 0–100. */
  weight: number
}

export type IntegrityReport = {
  /** 0 — вопросов нет, 100 — смотреть обязательно. */
  risk: number
  signals: IntegritySignal[]
  seconds: number | null
  chars: number
  chars_per_second: number | null
}

/** Обороты, которые почти не встречаются в живом ответе оператора в чате. */
const BOOKISH_PHRASES = [
  'важно отметить',
  'следует отметить',
  'в первую очередь',
  'таким образом',
  'кроме того',
  'необходимо обеспечить',
  'в случае возникновения',
  'при возникновении ситуации',
  'ключевым моментом',
  'резюмируя',
  'в заключение',
  'алгоритм действий',
  'рекомендуется',
  'данный случай',
  'вышеуказанн',
]

function normalize(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Похожесть двух текстов по общим словам (Jaccard). Достаточно для списывания. */
export function textSimilarity(left: string, right: string): number {
  const a = new Set(normalize(left).split(' ').filter((word) => word.length > 3))
  const b = new Set(normalize(right).split(' ').filter((word) => word.length > 3))
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const word of a) if (b.has(word)) shared += 1
  const union = a.size + b.size - shared
  return union > 0 ? shared / union : 0
}

export function analyzeOpenAnswer(params: {
  text: string
  /** Сколько секунд прошло от выдачи вопроса до ответа. null — время неизвестно. */
  seconds: number | null
  /** Ответы других сотрудников на этот же вопрос. */
  others?: Array<{ operatorName?: string | null; text: string }>
}): IntegrityReport {
  const text = String(params.text || '')
  const chars = text.length
  const seconds = params.seconds != null && params.seconds >= 0 ? Math.round(params.seconds) : null
  const cps = seconds && seconds > 0 ? chars / seconds : null
  const signals: IntegritySignal[] = []

  // 1. Скорость. Человек набирает в чате 3–5 знаков в секунду, и это верх.
  //    Больше 12 — текст вставлен целиком, откуда бы он ни взялся. Короткие
  //    реплики («понял, зафиксирую») под это не попадают: там мало знаков.
  if (cps != null && chars >= 120 && cps > 12) {
    signals.push({
      code: 'speed',
      label: 'Текст вставлен, а не набран',
      detail: `${chars} знаков за ${seconds} сек — это ${cps.toFixed(1)} знака в секунду`,
      weight: 45,
    })
  } else if (cps != null && chars >= 400 && cps > 7) {
    signals.push({
      code: 'speed',
      label: 'Очень быстрый ответ',
      detail: `${chars} знаков за ${seconds} сек`,
      weight: 25,
    })
  }

  // 2. Совпадение с ответом коллеги — самый прямой признак и его легко проверить.
  let bestMatch: { name: string; ratio: number } | null = null
  for (const other of params.others || []) {
    const ratio = textSimilarity(text, other.text)
    if (!bestMatch || ratio > bestMatch.ratio) {
      bestMatch = { name: String(other.operatorName || 'другой сотрудник'), ratio }
    }
  }
  if (bestMatch && bestMatch.ratio >= 0.55) {
    signals.push({
      code: 'duplicate',
      label: 'Совпадает с чужим ответом',
      detail: `Совпадение с ответом «${bestMatch.name}» — ${Math.round(bestMatch.ratio * 100)}%`,
      weight: bestMatch.ratio >= 0.75 ? 45 : 30,
    })
  }

  // 3. Оформление: маркеры, заголовки, markdown. Человек в Telegram так не пишет.
  const hasBullets = /(^|\n)\s*([-•*—]|\d+[.)])\s+/m.test(text)
  const bulletCount = (text.match(/(^|\n)\s*([-•*—]|\d+[.)])\s+/gm) || []).length
  const hasMarkdown = /\*\*[^*]+\*\*|^#{1,3}\s/m.test(text)
  if (hasMarkdown || (hasBullets && bulletCount >= 3)) {
    signals.push({
      code: 'formatting',
      label: 'Оформлено как статья',
      detail: hasMarkdown ? 'Разметка заголовков и жирного текста' : `Список из ${bulletCount} пунктов`,
      weight: 20,
    })
  }

  // 4. Книжные обороты. Сам по себе слабый признак — только вместе с остальными.
  const lower = normalize(text)
  const bookish = BOOKISH_PHRASES.filter((phrase) => lower.includes(phrase))
  if (bookish.length >= 2) {
    signals.push({
      code: 'style',
      label: 'Канцелярский слог',
      detail: `Обороты: ${bookish.slice(0, 3).join(', ')}`,
      weight: 15,
    })
  }

  // Одинокий стилистический признак ничего не доказывает: человек может писать
  // складно. Помечаем, только когда сигналов больше одного или есть жёсткий.
  const hard = signals.some((signal) => signal.weight >= 30)
  const risk = signals.length === 0 || (!hard && signals.length < 2)
    ? 0
    : Math.min(100, signals.reduce((sum, signal) => sum + signal.weight, 0))

  return { risk, signals: risk > 0 ? signals : [], seconds, chars, chars_per_second: cps }
}
