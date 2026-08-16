# Действия, которых нет в приложении

Собрано `scripts/triage-mobile-actions.mjs` по каталогу прав и коду приложения. Считается «есть», если право упомянуто в Swift.

Всего: **262**. На телефон просятся **26**, работа за столом — **107**, спорных — **129**.

## Нужно на телефоне

| Раздел | Действие | Право | Важность |
|---|---|---|---|
| HR / Кадры | Уволить сотрудника | `hr.dismiss` | high |
| HR / Кадры | Восстановить уволенного | `hr.restore` | high |
| База знаний (админка) | Создание | `knowledge-admin.create` | medium |
| Движения товара | Создать перемещение | `store-movements.create` | medium |
| Доверенные поставщики | Создание | `expense-whitelist.create` | medium |
| Задачи | Ответить на задачу | `tasks.respond` | low |
| Задачи | Отправить уведомление по задаче | `tasks.notify` | medium |
| Зарплата операторов | Отправить расчёт ЗП в Telegram | `salary.send_telegram` | medium |
| Заявки поставщикам | Создание | `store-purchase-orders.create` | medium |
| Заявки поставщикам | Отменить заявку поставщику | `store-purchase-orders.cancel` | medium |
| Заявки склад → витрина | Создание заявки | `store-requests.create` | medium |
| Инциденты | Закрыть инцидент | `incidents.close` | medium |
| Кассовые устройства | Создание | `point-devices.create` | medium |
| Каталог товаров | Создание | `store-catalog.create` | medium |
| Новости | Опубликовать пост | `news.create` | medium |
| Поставщики | Создание | `store-suppliers.create` | medium |
| Приёмки от поставщиков | Отмена проведённой приёмки | `store-receipts.cancel` | high |
| Расходники | Добавить расходник | `store-consumables.create` | medium |
| Ревизии (инвентаризация) | Создание | `store-revisions.create` | medium |
| Ревизии (инвентаризация) | Отменить ревизию | `store-revisions.cancel` | high |
| Реклама на витрине | Добавить рекламу | `store-advertising.create` | medium |
| Смены (расписание) | Создать смену | `shifts.create` | medium |
| Сотрудники | Создание | `staff.create` | medium |
| Сотрудники | Сбросить пароль сотрудника | `staff.reset_password` | high |
| Списания товара | Отменить списание | `store-writeoffs.cancel` | high |
| Цели | Создать цель/KPI-план | `goals.create` | medium |

## Спорные — решить владельцу

| Раздел | Действие | Право | Важность |
|---|---|---|---|
| AI Финдиректор | Сгенерировать анализ (AI) | `ai-cfo.generate` | medium |
| AI-анализ | Запустить новый анализ AI | `analysis.refresh` | medium |
| AI-разбор расходов | Перезапустить AI-разбор | `expense-analysis.refresh` | low |
| HR / Кадры | Просмотр истории действий | `hr.view_history` | low |
| PS-станции и игровые проекты | Создать станцию | `stations.create_station` | medium |
| PS-станции и игровые проекты | Изменить станцию | `stations.edit_station` | medium |
| PS-станции и игровые проекты | Удалить станцию | `stations.delete_station` | high |
| PS-станции и игровые проекты | Изменить тему оформления | `stations.edit_theme` | low |
| PS-станции и игровые проекты | Создать зону | `stations.create_zone` | medium |
| PS-станции и игровые проекты | Изменить зону | `stations.edit_zone` | medium |
| PS-станции и игровые проекты | Удалить зону | `stations.delete_zone` | high |
| PS-станции и игровые проекты | Добавить декорацию | `stations.create_decoration` | low |
| PS-станции и игровые проекты | Удалить декорацию | `stations.delete_decoration` | low |
| PS-станции и игровые проекты | Добавить игру в каталог | `stations.create_game_catalog` | medium |
| PS-станции и игровые проекты | Изменить игру | `stations.edit_game_catalog` | medium |
| PS-станции и игровые проекты | Удалить игру | `stations.delete_game_catalog` | high |
| PS-станции и игровые проекты | Изменить игру на станции | `stations.edit_station_game` | medium |
| PS-станции и игровые проекты | Удалить игру со станции | `stations.delete_station_game` | medium |
| PS-станции и игровые проекты | Создать тариф | `stations.create_tariff` | high |
| PS-станции и игровые проекты | Изменить тариф | `stations.edit_tariff` | high |
| PS-станции и игровые проекты | Удалить тариф | `stations.delete_tariff` | high |
| PS-станции и игровые проекты | Пополнить баланс | `stations.top_up_balance` | high |
| PS-станции и игровые проекты | Сбросить provisioning-ключ | `stations.rotate_provisioning_key` | high |
| PS-станции и игровые проекты | Изменить брендинг | `stations.update_branding` | medium |
| PS-станции и игровые проекты | Изменить карту/раскладку | `stations.update_map_layout` | medium |
| PS-станции и игровые проекты | Изменить фон киоска | `stations.edit_kiosk_background` | low |
| PS-станции и игровые проекты | Редактировать объявление киоска | `stations.edit_kiosk_announcement` | low |
| Анализ команды | Перезапустить AI-анализ | `team-analysis.refresh` | low |
| Аналитика склада + ABC | Изменить цену продажи | `store-analytics.edit_sale_price` | medium |
| База знаний (админка) | Изменение | `knowledge-admin.edit` | medium |
| База знаний (админка) | Удаление | `knowledge-admin.delete` | high |
| База знаний (админка) | Опубликовать статью | `knowledge-admin.publish` | medium |
| База знаний (админка) | Управление чек-листами | `knowledge-admin.manage_checklists` | medium |
| База знаний (админка) | Запустить чек-лист в смену | `knowledge-admin.run_checklist` | medium |
| База знаний (админка) | Пропустить обязательный чек-лист | `knowledge-admin.skip_checklist` | high |
| Биллинг и долги поставщикам | Оплатить долг поставщику | `store-billing.pay_debt` | high |
| Биллинг и долги поставщикам | Списать долг (без оплаты) | `store-billing.write_off_debt` | high |
| Биллинг и долги поставщикам | Перенести срок оплаты долга | `store-billing.reschedule_debt` | medium |
| Биллинг и долги поставщикам | AI-распознавание чека/счёта | `store-billing.parse_receipt` | medium |
| Биллинг и долги поставщикам | Удалить запись долга | `store-billing.delete_debt` | high |
| Главная склада | Глобальный поиск по складу | `store.global_search` | low |
| Денежные потоки | AI-анализ потоков | `cashflow.ai_analysis` | low |
| Доверенные поставщики | Удаление | `expense-whitelist.delete` | high |
| Доходы | Изменение | `income.edit` | medium |
| Доходы | Удаление | `income.delete` | high |
| Доходы | Изменить Online-сумму | `income.update_online` | medium |
| Доходы | Массовое добавление | `income.create_batch` | high |
| Еженедельный отчёт | Поделиться отчётом | `weekly-report.share` | medium |
| Еженедельный отчёт | Сгенерировать AI-отчёт | `weekly-report.ai_generate` | medium |
| Журнал событий | AI-объяснение ошибки | `logs.explain_error` | low |
| Зарплата операторов | Выплатить зарплату | `salary.create_payment` | high |
| Зарплата операторов | Отменить выплату | `salary.void_payment` | high |
| Зарплата операторов | Отменить корректировку | `salary.void_adjustment` | high |
| Зарплата операторов | Разблокировать закрытую неделю | `salary.unlock_week` | high |
| Зарплата операторов | Изменить Telegram ID | `salary.update_chat_id` | medium |
| Зарплата операторов | Добавить доп. рабочий день | `salary.add_extra_day` | medium |
| Заявки поставщикам | Изменение | `store-purchase-orders.edit` | medium |
| Заявки поставщикам | Отправить заявку поставщику | `store-purchase-orders.send` | medium |
| Заявки склад → витрина | Изменение количества | `store-requests.edit` | medium |
| Заявки склад → витрина | Выдать товар со склада | `store-requests.issue` | medium |
| Заявки склад → витрина | Отметить получение на точке | `store-requests.receive` | medium |
| Заявки склад → витрина | Отозвать одобрение | `store-requests.undecide` | high |
| Кассовые устройства | Изменение | `point-devices.edit` | medium |
| Кассовые устройства | Удаление | `point-devices.delete` | high |
| Кассовые устройства | Сбросить токен устройства | `point-devices.rotate_token` | high |
| Кассовые устройства | Управление флагами функций | `point-devices.manage_feature_flags` | high |
| Кассовые устройства | Просмотр токена устройства | `point-devices.reveal_token` | high |
| Кассовые устройства | Копирование токена в буфер | `point-devices.copy_token` | medium |
| Каталог товаров | Изменение | `store-catalog.edit` | medium |
| Каталог товаров | Удаление | `store-catalog.delete` | high |
| Клиенты | Изменение | `customers.edit` | medium |
| Клиенты | Удаление | `customers.delete` | high |
| Клиенты | Просмотр истории покупок клиента | `customers.view_sale_history` | low |
| Личные сообщения | Отправить сообщение | `messages.send` | low |
| Новости | Удалить пост | `news.delete` | high |
| Операторы | Изменение | `operators.edit` | medium |
| Операторы | Удаление | `operators.delete` | high |
| Операторы | Повысить в должности | `operators.promote` | medium |
| Операторы | Изменить назначения на точки | `operators.save_assignments` | medium |
| Операторы | Загрузить фото оператора | `operators.avatar_upload` | low |
| Операторы | Загрузить документы оператора | `operators.document_upload` | medium |
| Операторы | Изменить логин | `operators.edit_login` | high |
| Операторы | Копирование данных оператора в буфер | `operators.copy_profile_data` | low |
| Оприходование | Изменение | `store-postings.edit` | medium |
| Оприходование | Удаление | `store-postings.delete` | high |
| Отчёты смен | Принудительно закрыть смену | `shifts-reports.close_force` | high |
| Отчёты смен | Полная очистка данных смены | `shifts-reports.purge` | high |
| Отчёты смен | Переоткрыть смену | `shifts-reports.reopen` | high |
| Поставщики | Изменение | `store-suppliers.edit` | medium |
| Поставщики | Добавить алиас товара поставщика | `store-suppliers.add_alias` | medium |
| Поставщики | Удалить алиас товара | `store-suppliers.delete_alias` | medium |
| Приёмки от поставщиков | Изменение | `store-receipts.edit` | medium |
| Приёмки от поставщиков | Удаление | `store-receipts.delete` | high |
| Приёмки от поставщиков | AI-распознавание чека об оплате | `store-receipts.parse_payment_receipt` | medium |
| Приёмки от поставщиков | Быстрое добавление товара по штрихкоду | `store-receipts.quick_add_barcode` | low |
| Прогноз | Запустить генерацию AI | `forecast.generate` | medium |
| Прогноз | Отменить генерацию AI | `forecast.cancel_generation` | low |
| Пропуска | Копирование логина/пароля в буфер | `pass.copy_credentials` | high |
| Расходники | Изменить норму расхода | `store-consumables.edit` | medium |
| Расходники | Записать выдачу | `store-consumables.issue` | medium |
| Расходы | Изменение | `expenses.edit` | medium |
| Расходы | Удаление | `expenses.delete` | high |
| Расходы | Управление шаблонами | `expenses.manage_templates` | medium |
| Ревизии (инвентаризация) | Изменение | `store-revisions.edit` | medium |
| Ревизии (инвентаризация) | Добавить товар по штрихкоду | `store-revisions.add_item_barcode` | low |
| Ревизии (инвентаризация) | Автозаполнить остатки в форму ревизии | `store-revisions.preload_from_balances` | medium |
| Реквизиты чека ККМ | Изменение реквизитов чека | `store-receipt-settings.edit` | high |
| Рентабельность (ОПиУ) | What-if симуляция | `profitability.simulate` | low |
| Склад (остатки) | Корректировка остатков вручную | `store-warehouse.edit` | high |
| Склад (остатки) | Создать товар через сканер штрихкода | `store-warehouse.create_item` | medium |
| Смены (расписание) | Изменить смену | `shifts.edit` | medium |
| Смены (расписание) | Удалить смену | `shifts.delete` | high |
| Смены (расписание) | Копировать неделю | `shifts.copy_week` | medium |
| Смены (расписание) | Опубликовать график | `shifts.publish_week` | medium |
| Смены (расписание) | Решить конфликт смен | `shifts.resolve_issue` | medium |
| Сотрудники | Изменение | `staff.edit` | medium |
| Сотрудники | Удаление | `staff.delete` | high |
| Сотрудники | Пригласить сотрудника | `staff.invite` | high |
| Сотрудники | Активировать/деактивировать | `staff.toggle_status` | high |
| Сотрудники | Записать выплату | `staff.create_payment` | high |
| Сотрудники | Сделать корректировку зарплаты | `staff.add_adjustment` | high |
| Сотрудники | Добавить доп. рабочий день | `staff.add_extra_day` | medium |
| Списания товара | Изменение | `store-writeoffs.edit` | medium |
| Списания товара | Удаление | `store-writeoffs.delete` | high |
| Списания товара | Быстрое добавление товара по штрихкоду | `store-writeoffs.quick_add_barcode` | low |
| Цели | Удалить план | `goals.delete` | high |
| Чеки | Повторная печать чека | `pos-receipts.print` | low |
| Экзамены операторов | Переставить балл за развёрнутый ответ | `operator-exams.grade` | medium |
| Эффективность продавцов | Настройка модели и правил допродаж | `sales-kpi.manage` | high |

## Работа за столом

| Раздел | Действие | Право | Важность |
|---|---|---|---|
| AI-анализ | Выгрузка результатов | `analysis.export` | low |
| HR / Кадры | Экспорт CSV сотрудников | `hr.export` | high |
| PS-станции и игровые проекты | Массовое обновление игр | `stations.bulk_upsert_games` | high |
| PS-станции и игровые проекты | Экспорт аналитики проекта | `stations.export_analytics` | low |
| Telegram-интеграция | Включить/отключить бот | `telegram.toggle_connection` | high |
| Telegram-интеграция | Добавить получателя | `telegram.add_user` | medium |
| Telegram-интеграция | Удалить получателя | `telegram.delete_user` | medium |
| Telegram-интеграция | Включить/отключить фин. отчёты | `telegram.toggle_finance` | medium |
| Telegram-интеграция | Изменить Telegram ID сотрудника | `telegram.edit_staff_telegram` | medium |
| Telegram-интеграция | Настройка webhook | `telegram.setup_webhook` | high |
| Telegram-интеграция | Тестировать webhook | `telegram.test_webhook` | low |
| Telegram-интеграция | Отправить отчёт вручную | `telegram.send_report` | medium |
| Аналитика | Выгрузка в Excel | `analytics.export` | low |
| Аналитика операторов | Выгрузка | `operator-analytics.export` | low |
| Аналитика склада + ABC | Выгрузка | `store-analytics.export` | low |
| Биллинг и долги поставщикам | Массовая оплата долгов | `store-billing.bulk_pay` | high |
| Биллинг и долги поставщикам | Выгрузка долгов в Excel | `store-billing.export` | low |
| Главная склада | Выгрузка | `store.export` | low |
| Денежные потоки | Выгрузка в Excel | `cashflow.export` | low |
| Диагностика | Запуск автотестов | `debug.run_tests` | medium |
| Долги точек | Выгрузка в Excel | `point-debts.export` | low |
| Доходы | Выгрузка в Excel/CSV | `income.export` | low |
| Еженедельный отчёт | Выгрузка в Excel | `weekly-report.export` | low |
| Еженедельный отчёт | Выгрузка в PDF | `weekly-report.export_pdf` | low |
| Журнал заявок | Выгрузка истории заявок | `store-requests-journal.export` | low |
| Журнал событий | Выгрузка журнала | `logs.export` | medium |
| Задачи | Массовое завершение задач | `tasks.bulk_complete` | medium |
| Задачи | Массовое удаление задач | `tasks.bulk_delete` | high |
| Зарплата операторов | Экспорт PDF | `salary.export` | low |
| Заявки склад → витрина | Массовое одобрение | `store-requests.bulk_approve` | high |
| Заявки склад → витрина | Массовое отклонение | `store-requests.bulk_reject` | high |
| Заявки склад → витрина | Выгрузка | `store-requests.export` | low |
| Каталог товаров | Выгрузка в Excel/CSV | `store-catalog.export` | low |
| Каталог товаров | Импорт из файла | `store-catalog.import` | medium |
| Каталог товаров | Массовое обнуление остатков | `store-catalog.bulk_zero_stock` | high |
| Каталог товаров | Скрыть все товары | `store-catalog.bulk_deactivate` | high |
| Каталог товаров | Удалить товары без остатков | `store-catalog.bulk_delete_empty` | high |
| Каталог товаров | Удалить весь каталог | `store-catalog.bulk_delete_all` | high |
| Каталог товаров | Печать ценников | `store-catalog.print_labels` | low |
| Категории расходов | Создание | `categories.create` | medium |
| Категории расходов | Изменение | `categories.edit` | medium |
| Категории расходов | Удаление | `categories.delete` | high |
| Клиенты | Выгрузка в Excel/CSV | `customers.export` | low |
| Налоги | Экспорт формы 910 (xlsx) | `tax.export_910` | medium |
| Общие настройки | Создание/изменение точек | `settings.manage_companies` | high |
| Общие настройки | Удалить точку | `settings.delete_company` | high |
| Общие настройки | Управление категориями расходов | `settings.manage_categories` | medium |
| Операторы | Массовое удаление | `operators.bulk_delete` | high |
| Операторы | Массовая отправка credentials в Telegram | `operators.bulk_send_credentials_telegram` | high |
| Операторы | Выгрузить логины и пароли в Excel | `operators.export_credentials` | high |
| Операторы | Экспорт PDF доступов операторов | `operators.export` | medium |
| Отчёты | Выгрузка в Excel | `reports.export` | low |
| Отчёты смен | Выгрузка | `shifts-reports.export` | low |
| План закупа | Создать/изменить план закупа | `store-purchase-plan.create` | medium |
| План закупа | AI-совет по закупу | `store-purchase-plan.ai_advice` | low |
| Правила зарплаты | Создать правило | `salary-rules.create` | high |
| Правила зарплаты | Изменить правило | `salary-rules.edit` | high |
| Правила зарплаты | Удалить правило | `salary-rules.delete` | high |
| Правила зарплаты | Изменить версию правила | `salary-rules.upsert_version` | high |
| Правила зарплаты | Удалить версию | `salary-rules.delete_version` | high |
| Правила зарплаты | Изменить уровень стажа | `salary-rules.upsert_seniority` | high |
| Правила зарплаты | Удалить уровень стажа | `salary-rules.delete_seniority` | high |
| Приёмки от поставщиков | Выгрузка в Excel/CSV | `store-receipts.export` | low |
| Приёмки от поставщиков | Применить шаблон приёмки | `store-receipts.apply_template` | low |
| Приёмки от поставщиков | Сохранить шаблон приёмки | `store-receipts.save_template` | low |
| Приёмки от поставщиков | Удалить шаблон приёмки | `store-receipts.delete_template` | medium |
| Приёмки от поставщиков | Применить наценку ко всем позициям | `store-receipts.bulk_markup` | medium |
| Приёмки от поставщиков | Применить цену продажи ко всем позициям | `store-receipts.bulk_sale_price` | medium |
| Пропуска | Выгрузка списка в CSV | `pass.export_csv` | high |
| Расходы | Выгрузка в Excel/CSV | `expenses.export` | low |
| Расходы | Загрузка файлов (чеки, фото) | `expenses.import_file` | medium |
| Ревизии (инвентаризация) | Выгрузка в Excel/CSV | `store-revisions.export` | low |
| Рентабельность (ОПиУ) | Экспорт PDF | `profitability.export_pdf` | low |
| Склад (остатки) | Загрузка файла подсобки | `store-warehouse.upload_backroom` | medium |
| Склад (остатки) | Применить загруженный файл подсобки | `store-warehouse.apply_backroom` | high |
| Склад (остатки) | Печать ценников | `store-warehouse.print_labels` | low |
| Склад (остатки) | Удалить выбранные товары | `store-warehouse.delete_selected` | high |
| Склад (остатки) | Очистить весь склад | `store-warehouse.delete_all` | high |
| Сменные отчёты (магазин) | Экспорт сменных отчётов | `store-shifts.export` | low |
| Смены (расписание) | Массовое назначение на неделю | `shifts.bulk_assign_week` | medium |
| Смены (расписание) | Выгрузка | `shifts.export` | low |
| Списания товара | Выгрузка в Excel/CSV | `store-writeoffs.export` | low |
| Списания товара | Применить шаблон списания | `store-writeoffs.apply_template` | low |
| Списания товара | Сохранить шаблон списания | `store-writeoffs.save_template` | low |
| Структура подчинения | Изменить подчинение | `structure.save_assignments` | high |
| Структура подчинения | Перетаскивать структуру (drag-and-drop) | `structure.drag_drop_reorder` | medium |
| Техкарты (производство) | Создать/изменить техкарту | `production.create` | medium |
| Техкарты (производство) | Удалить техкарту | `production.delete` | high |
| Техкарты (производство) | Добавить ингредиент | `production.create_ingredient` | medium |
| Техкарты (производство) | Удалить ингредиент | `production.delete_ingredient` | high |
| Техкарты (производство) | Приход сырья на склад | `production.stock_receipt` | medium |
| Техкарты (производство) | Ревизия остатка сырья | `production.stock_count` | medium |
| Техкарты (производство) | Списание сырья по продажам | `production.writeoff` | high |
| Управление доступом (роли и права) | Создать роль/должность | `access.create_role` | high |
| Управление доступом (роли и права) | Изменить роль/должность | `access.edit_role` | high |
| Управление доступом (роли и права) | Удалить роль/должность | `access.delete_role` | high |
| Управление доступом (роли и права) | Включить/выключить право для роли | `access.toggle_capability` | high |
| Управление доступом (роли и права) | Массовое управление правами | `access.bulk_capabilities` | high |
| Управление доступом (роли и права) | Переопределить права для сотрудника | `access.manage_user_overrides` | high |
| Управление доступом (роли и права) | Назначить роль сотруднику | `access.manage_staff_roles` | high |
| Управление доступом (роли и права) | Изменить email сотрудника | `access.change_email` | high |
| Управление доступом (роли и права) | Сгенерировать пароль сотрудника | `access.generate_password` | high |
| Управление доступом (роли и права) | Просмотр сгенерированного пароля | `access.reveal_password` | high |
| Управление доступом (роли и права) | Отправить приглашение по email | `access.invite_staff` | high |
| Управление доступом (роли и права) | Сброс к правам по умолчанию | `access.reset_to_defaults` | high |
| Эффективность операторов (PI) | Экспорт CSV рейтинга | `performance.export` | medium |
| Эффективность продавцов | Выгрузка | `sales-kpi.export` | low |
