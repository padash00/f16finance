/**
 * Заголовки авторизации для внутреннего запроса к своему же API.
 *
 * PDF-роуты собирают данные, вызывая соседний роут (branch-report,
 * weekly-act). Раньше пробрасывались только cookies — это работает для
 * сайта, но приложение входит по Bearer-токену и выбирает организацию
 * заголовком `x-organization-id`: без них внутренний запрос уходил
 * анонимным, и выгрузка из приложения падала с 401.
 */
export function forwardAuthHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {}
  const cookie = req.headers.get('cookie')
  if (cookie) headers.cookie = cookie
  const authorization = req.headers.get('authorization')
  if (authorization) headers.authorization = authorization
  const organization = req.headers.get('x-organization-id')
  if (organization) headers['x-organization-id'] = organization
  return headers
}
