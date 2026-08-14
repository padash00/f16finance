/**
 * Слоты иллюстраций руководства пользователя (/help).
 *
 * Один список — три потребителя: страница /help рисует картинку в нужном месте,
 * страница /platform/help-images показывает, что именно надо снять, а таблица
 * help_images хранит загруженный файл по ключу слота.
 *
 * Добавляя слот, поставьте в /help компонент <HelpFigure slot="..."> — иначе
 * загруженная картинка просто не будет показана.
 */

export type HelpImageSlot = {
  /** Ключ в таблице help_images. Менять нельзя — потеряется связь с файлом. */
  slot: string
  /** Раздел /help, к которому относится картинка. */
  section: string
  /** Что это за картинка — заголовок карточки на /platform. */
  title: string
  /** Что должно быть видно на снимке. */
  hint: string
  /** Подпись под картинкой по умолчанию, если владелец не задал свою. */
  caption: string
}

export const HELP_IMAGE_SLOTS: HelpImageSlot[] = [
  {
    slot: 'web-login',
    section: '3. Сайт ordaops.kz',
    title: 'Вход на сайт',
    hint: 'Экран входа: поля почты и пароля, кнопка «Войти».',
    caption: 'Вход на сайте ordaops.kz',
  },
  {
    slot: 'web-dashboard',
    section: '3. Сайт ordaops.kz',
    title: 'Главный экран владельца',
    hint: 'Дашборд с выручкой, расходами и прибылью за период. Суммы можно оставить настоящие.',
    caption: 'Главный экран: деньги точки за период',
  },
  {
    slot: 'web-access',
    section: '2. Организация, точки и права',
    title: 'Права и должности',
    hint: 'Страница «Доступы»: список должностей и переключатели прав.',
    caption: 'Права выдаются должности, а не человеку',
  },
  {
    slot: 'mobile-home',
    section: '4. Приложение для iPhone и iPad',
    title: 'Приложение: главный экран',
    hint: 'Снимок с телефона: главный экран приложения Orda после входа.',
    caption: 'Orda для iPhone: главный экран',
  },
  {
    slot: 'mobile-shift',
    section: '4. Приложение для iPhone и iPad',
    title: 'Приложение: смена',
    hint: 'Экран смены в приложении — открытие или закрытие.',
    caption: 'Смена в приложении',
  },
  {
    slot: 'point-setup',
    section: '5. Программа точки (Windows)',
    title: 'Привязка устройства',
    hint: 'Окно настройки Orda Point: адрес сервера и поле токена. Сам токен закрасьте.',
    caption: 'Привязка кассы к точке по токену устройства',
  },
  {
    slot: 'point-login',
    section: '5. Программа точки (Windows)',
    title: 'Вход оператора и QR',
    hint: 'Экран входа Orda Point с кнопкой «Войти по QR».',
    caption: 'Вход оператора: пароль или QR-код',
  },
  {
    slot: 'point-sale',
    section: '5. Программа точки (Windows)',
    title: 'Продажа за кассой',
    hint: 'Экран продаж с непустым чеком: позиции, сумма к оплате, способы оплаты.',
    caption: 'Продажа: чек, скидка, оплата',
  },
  {
    slot: 'point-shift-close',
    section: '5. Программа точки (Windows)',
    title: 'Закрытие смены',
    hint: 'Форма закрытия смены целиком: денежные поля, формула расчёта, ФАКТ и ИТОГ.',
    caption: 'Закрытие смены: пересчёт кассы и сменный отчёт',
  },
  {
    slot: 'point-checklist',
    section: '5. Программа точки (Windows)',
    title: 'Чек-лист смены',
    hint: 'Чек-лист в работе: обязательный пункт, фото-доказательство, комментарий.',
    caption: 'Обязательный чек-лист не даёт закрыть смену',
  },
  {
    slot: 'point-queue',
    section: '5. Программа точки (Windows)',
    title: 'Работа без интернета',
    hint: 'Окно очереди отправки со счётчиками «в очереди» и «требует внимания».',
    caption: 'Без связи чеки копятся в очереди и уходят сами',
  },
  {
    slot: 'kiosk-welcome',
    section: '6. Киоск самообслуживания',
    title: 'Экран киоска',
    hint: 'Стартовый экран киоска, каким его видит клиент.',
    caption: 'Киоск самообслуживания: стартовый экран',
  },
]

export const HELP_IMAGE_SLOT_KEYS = HELP_IMAGE_SLOTS.map((s) => s.slot)

export function findHelpImageSlot(slot: string): HelpImageSlot | undefined {
  return HELP_IMAGE_SLOTS.find((s) => s.slot === slot)
}

export type HelpImageRecord = {
  slot: string
  url: string
  storage_path?: string | null
  alt?: string | null
  caption?: string | null
  updated_at?: string | null
}
