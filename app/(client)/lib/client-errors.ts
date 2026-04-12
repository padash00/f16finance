/** Человекочитаемые коды ошибок API личного кабинета гостя */
export function formatClientApiError(code: string | undefined, fallback: string) {
  switch (code) {
    case 'company-id-required':
      return 'Выберите точку клуба на главной (несколько точек в одном аккаунте).'
    case 'company-not-in-profile':
      return 'Эта точка не привязана к вашему профилю.'
    case 'customer-company-not-found':
      return 'Профиль не привязан к точке. Обратитесь к администратору клуба.'
    case 'startsAt-required':
      return 'Укажите дату и время начала визита.'
    case 'startsAt-invalid':
    case 'endsAt-invalid':
      return 'Проверьте дату и время — формат некорректен.'
    case 'message-required':
      return 'Введите текст обращения.'
    case 'message-too-long':
      return 'Сообщение слишком длинное (максимум 2000 символов).'
    default:
      return fallback
  }
}
