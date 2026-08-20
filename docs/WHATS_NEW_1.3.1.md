# Что нового — 1.3.1

Версия `1.3.1`, сборка `6`. Правка уведомлений.

## Русский

Уведомления.

• Телефон заново спрашивает у Apple адрес для уведомлений при каждом запуске.
  Раньше он делал это только при первом разрешении, и после переустановки,
  восстановления из копии или обновления системы адрес устаревал молча — на
  сервере устройство переставало числиться, а уведомления просто не приходили.
• Проверка в профиле стала отвечать по делу: если адрес получить не удалось,
  показывает, что именно ответил Apple, а не «устройств нет».

## English

Notifications.

• The app now asks Apple for a notification address on every launch, not only
  when permission is first granted. Reinstalling, restoring from a backup or
  updating iOS used to invalidate it silently: the server stopped seeing the
  device and notifications simply stopped arriving.
• The self-check in the profile now reports what Apple actually said instead of
  a bare "no devices registered".
