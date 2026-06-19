# Orda Mobile (Expo) — кабинет владельца

Тонкий клиент поверх существующего Next.js API. Supabase — только для входа,
данные — через `/api/*` с `Authorization: Bearer` и `x-organization-id`.

## Запуск (прототип: вход + дашборд)

```bash
cd mobile
npm install
npx expo install --fix     # выровнять версии под текущий Expo SDK
cp .env.example .env        # заполни значения (см. ниже)
npx expo start             # открой в Expo Go (QR) на телефоне
```

### .env
- `EXPO_PUBLIC_SUPABASE_URL` = `NEXT_PUBLIC_SUPABASE_URL` веб-проекта
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` = `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_API_BASE_URL` = `https://ordaops.kz` (прод; localhost с телефона не виден)

Войди логином владельца (тот, что заводится при создании организации). Дашборд
дёрнет `/api/admin/my-subscription` — увидишь свою организацию и тариф (доказывает
сквозной путь Supabase-сессия → Bearer → API → данные своей орг).

## Архитектура
- `lib/supabase.ts` — Supabase Auth (вход/refresh/выход).
- `lib/api.ts` — `apiFetch()`: добавляет Bearer-токен сессии + `x-organization-id`.
- `lib/auth.tsx` — контекст сессии.
- `app/_layout.tsx` — гейт: нет сессии → /login.
- `app/login.tsx`, `app/index.tsx` — вход и дашборд.

## Дальше (по плану)
1. Экраны: финансы (выручка/расходы/прибыль), смены, долги, AI-CFO, согласование расходов.
2. Переключатель организаций (для мультибренд-владельцев) — через `setActiveOrganization()`.
3. Биометрия (expo-local-authentication) поверх сохранённой сессии.
4. Пуш (expo-notifications) + таблица `mobile_devices` + отправка из cron-точек.
5. Хардеринг: токены из AsyncStorage → expo-secure-store (chunked).
6. Сборка: EAS Build + публикация (Apple Dev $99/год, Google Play $25).
