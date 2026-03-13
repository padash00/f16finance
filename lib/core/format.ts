export function formatMoney(value: number): string {
  return `${Math.round(Number(value || 0)).toLocaleString('ru-RU')} ₸`
}

export function formatPhone(value: string | null): string {
  if (!value) return ''

  const cleaned = value.replace(/\D/g, '')
  const match = cleaned.match(/^(\d{1})(\d{3})(\d{3})(\d{2})(\d{2})$/)

  if (!match) return value
  return `+${match[1]} (${match[2]}) ${match[3]}-${match[4]}-${match[5]}`
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}
