#!/bin/bash
# Снимки экрана для App Store.
#
# Обойти два десятка разделов пальцем и не сбиться нельзя, поэтому переход
# делается ссылкой orda://page/<страница> — теми же идентификаторами, что в
# каталоге прав и в уведомлениях.
#
# Перед запуском: приложение установлено и в него выполнен вход на симуляторе.
#
#   apple/Tools/screenshots.sh "iPhone 17 Pro Max" ~/Desktop/orda-shots/iphone
#
# Требования Apple: iPhone 6.9″ — 1320×2868, iPad 13″ — 2064×2752. Симуляторы
# iPhone 17 Pro Max и iPad Pro 13-inch снимают ровно в этих размерах.

set -euo pipefail

DEVICE="${1:?устройство, напр. \"iPhone 17 Pro Max\"}"
OUT="${2:?папка для снимков}"
BUNDLE=kz.ordaops.apple

mkdir -p "$OUT"

# Что снимаем. Порядок — порядок карточек в App Store: сначала то, ради чего
# приложение открывают каждый день.
PAGES=(
  "home.dashboard:1-обзор"
  "shifts:2-смены"
  "income:3-доходы"
  "expenses:4-расходы"
  "profitability:5-опиу"
  "store-warehouse:6-склад"
  "salary:7-зарплата"
  "tasks:8-задачи"
)

# Часы 9:41 и полная батарея — как на снимках Apple: реальное время и
# наполовину севшая батарея в карточке магазина выглядят неряшливо.
xcrun simctl status_bar "$DEVICE" override \
  --time "9:41" --batteryState charged --batteryLevel 100 \
  --cellularBars 4 --wifiBars 3 --dataNetwork wifi >/dev/null 2>&1 || true

for entry in "${PAGES[@]}"; do
  page="${entry%%:*}"
  name="${entry##*:}"
  # Через аргумент запуска, а не через orda://: на внешнюю ссылку iOS сначала
  # спрашивает «Открыть в приложении?», и снимок поймал бы этот вопрос.
  xcrun simctl terminate "$DEVICE" "$BUNDLE" >/dev/null 2>&1 || true
  xcrun simctl launch "$DEVICE" "$BUNDLE" -ordaPage "$page" >/dev/null
  # Экран сначала показывает скелет: снимок сразу после запуска поймал бы
  # серые плашки вместо цифр.
  sleep 9
  xcrun simctl io "$DEVICE" screenshot "$OUT/$name.png" >/dev/null 2>&1
  echo "снят $name"
done

echo "готово: $OUT"
