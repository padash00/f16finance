export const DEFAULT_SHIFT_BASE_PAY = 8000
export const SYSTEM_START_DATE = '2025-11-01'
export const DEFAULT_COMPANY_CODES = ['arena', 'ramen', 'extra'] as const
export const OPERATOR_AUTH_EMAIL_DOMAIN = 'operator.local'

export type SupportedCompanyCode = (typeof DEFAULT_COMPANY_CODES)[number]
