/**
 * AI tool: инфо о клиенте (история, баллы, дни рождения).
 * Capability: customers.view
 */

import type { CopilotTool } from '../../types'

export const getCustomerInfoTool: CopilotTool = {
  name: 'get_customer_info',
  category: 'analytics',
  description: 'Подробная информация о клиенте',
  requiredCapability: 'customers.view',
  severity: 'low',
  params: [
    {
      name: 'customer_id',
      label: 'Клиент',
      type: 'select',
      required: true,
      description: 'Кто',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase.from('customers').select('id, name, phone').order('name')
        return (data || []).map((c: any) => ({ value: c.id, label: `${c.name}${c.phone ? ` (${c.phone})` : ''}` }))
      },
    },
  ],
  handler: async (input, ctx) => {
    const customerId = String(input.customer_id || '')
    if (!customerId) return { ok: false, message: 'Не выбран клиент.' }

    const { data: customer } = await ctx.supabase.from('customers').select('*').eq('id', customerId).single()
    if (!customer) return { ok: false, message: 'Клиент не найден.' }

    const { count: salesCount } = await ctx.supabase
      .from('point_sales')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId)

    const lines = [
      `👤 ${customer.name}`,
      customer.phone ? `📞 ${customer.phone}` : null,
      customer.birth_date ? `🎂 День рождения: ${customer.birth_date}` : null,
      `🎁 Баллов: ${customer.loyalty_points || 0}`,
      `🛍 Покупок всего: ${salesCount || 0}`,
      customer.created_at ? `📅 С нами с: ${new Date(customer.created_at).toLocaleDateString('ru-RU')}` : null,
    ].filter(Boolean) as string[]

    return { ok: true, message: lines.join('\n'), data: { customer, salesCount } }
  },
}
