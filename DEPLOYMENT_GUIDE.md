# Deployment Guide - Booking Feature

## Что деплоим

1. **Database Migrations** - 4 миграции в Supabase
2. **Edge Function** - `create-booking` функция на Supabase
3. **Frontend** - React приложение на Vercel

---

## Шаг 1: Установить Supabase CLI

```bash
# macOS
brew install supabase/tap/supabase

# или npm
npm install -g supabase
```

Проверка установки:
```bash
supabase --version
```

---

## Шаг 2: Залогиниться и линковать проект

```bash
# Логин
supabase login

# Перейти в папку с миграциями
cd /Users/evgenyq/Projects/kitesafaribot

# Линковать к Supabase проекту
supabase link --project-ref zmbiiywazaytltemzzvc
```

Когда спросит пароль БД - это пароль от Supabase project settings → Database → Database password

---

## Шаг 3: Накатить миграции

```bash
cd /Users/evgenyq/Projects/kitesafaribot

# Применить ВСЕ миграции сразу
supabase db push
```

Это накатит:
- ✅ `001_add_booking_source_fields.sql` - поля booking_source, admin_booked_by
- ✅ `002_enable_realtime_cabins.sql` - Realtime для cabins таблицы
- ✅ `003_add_guests_info_to_bookings.sql` - поле guests_info
- ✅ `004_add_rls_policies.sql` - Row Level Security политики

**Проверка**: Зайди в Supabase Dashboard → Table Editor → проверь что поля добавились

---

## Шаг 4: Получить Service Role Key

1. Открой Supabase Dashboard → Settings → API
2. Найди секцию **Project API keys**
3. Скопируй `service_role` secret key (⚠️ НЕ `anon` key!)

---

## Шаг 5: Задеплоить Edge Function

```bash
cd /Users/evgenyq/Projects/kitesafaribot

# Деплой функции
supabase functions deploy create-booking

# Настроить секреты (environment variables)
supabase secrets set SUPABASE_URL=https://zmbiiywazaytltemzzvc.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<paste-your-service-role-key>

# Опционально: webhook для уведомлений боту (пропускаем)
# supabase secrets set BOT_WEBHOOK_URL=https://your-bot.fly.dev/webhook
```

**Проверка**:
```bash
# Посмотреть статус функции
supabase functions list

# Посмотреть логи
supabase functions logs create-booking --tail
```

URL функции будет: `https://zmbiiywazaytltemzzvc.supabase.co/functions/v1/create-booking`

---

## Шаг 6: Протестировать Edge Function

```bash
# Тестовый запрос (замени cabin_id и trip_id на реальные)
curl -X POST https://zmbiiywazaytltemzzvc.supabase.co/functions/v1/create-booking \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -d '{
    "trip_id": "реальный-trip-uuid",
    "cabin_id": "реальный-cabin-uuid",
    "telegram_id": 123456789,
    "telegram_handle": "@test",
    "full_name": "Test User",
    "booking_type": "full_single"
  }'
```

Должен вернуть:
```json
{
  "success": true,
  "booking_id": "uuid",
  "total_amount": 1200
}
```

---

## Шаг 7: Задеплоить Frontend на Vercel

### Вариант A: Через Vercel CLI (быстро)

```bash
cd /Users/evgenyq/Projects/kitesafari-web

# Установить Vercel CLI
npm i -g vercel

# Деплой (первый раз - настройка, потом автоматом)
vercel

# Production деплой
vercel --prod
```

### Вариант B: Через Git + Vercel Dashboard

1. Закоммить все изменения:
```bash
cd /Users/evgenyq/Projects/kitesafari-web
git add .
git commit -m "feat: add booking feature with Optimistic Lock

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>"
git push origin main
```

2. Зайти на [vercel.com](https://vercel.com)
3. Import Git Repository
4. Deploy

### Environment Variables для Vercel

В Vercel Dashboard → Settings → Environment Variables добавь:

```
VITE_SUPABASE_URL=https://zmbiiywazaytltemzzvc.supabase.co
VITE_SUPABASE_ANON_KEY=<твой anon key из Supabase Dashboard>
```

⚠️ **ВАЖНО**: Используй `anon` key, НЕ `service_role`!

---

## Шаг 8: Включить Realtime в Supabase

1. Supabase Dashboard → Database → Replication
2. Включи **Realtime** для таблицы `cabins`
3. Или выполни SQL вручную:
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE cabins;
```

---

## Шаг 9: Финальная проверка

### Чеклист перед запуском

- [ ] Миграции накачены (`supabase db push`)
- [ ] Edge Function задеплоена (`supabase functions list`)
- [ ] Секреты установлены (`supabase secrets list`)
- [ ] Realtime включен для `cabins`
- [ ] Frontend задеплоен на Vercel
- [ ] Environment variables настроены в Vercel

### Тест в Telegram Mini App

1. Открой Mini App через Telegram
2. Выбери поездку → Открой каюты
3. Нажми "Забронировать" на доступной каюте
4. Пройди весь flow: тип → гости → подтверждение
5. Проверь что бронирование создалось в Supabase

**Проверка в БД:**
```sql
SELECT * FROM bookings ORDER BY created_at DESC LIMIT 10;
SELECT * FROM cabins WHERE status = 'Booked';
```

---

## Troubleshooting

### Edge Function не работает

```bash
# Посмотреть логи
supabase functions logs create-booking --tail

# Проверить секреты
supabase secrets list
```

### CORS ошибки

В `kitesafaribot/supabase/functions/_shared/cors.ts` добавь свой production URL:

```typescript
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'https://kitesafari-web.vercel.app', // твой Vercel URL
  'https://your-custom-domain.com',
]
```

Передеплой функцию:
```bash
supabase functions deploy create-booking
```

### Realtime не работает

```sql
-- Проверить что Realtime включен
SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';

-- Должна быть строка с tablename = 'cabins'
```

### Race condition в логах

Это нормально! Это значит защита работает. Пользователь увидит ошибку:
> "Каюта только что была забронирована другим человеком"

---

## Откат (если что-то пошло не так)

### Откатить миграции

```bash
# Посмотреть историю миграций
supabase migration list

# Откатить последнюю миграцию
supabase db reset --db-url "postgresql://postgres:your-password@db.zmbiiywazaytltemzzvc.supabase.co:5432/postgres"
```

### Удалить Edge Function

```bash
supabase functions delete create-booking
```

### Откатить Frontend

В Vercel Dashboard → Deployments → Rollback to previous

---

## Monitoring после деплоя

### Что мониторить

1. **Edge Function логи**:
```bash
supabase functions logs create-booking --tail
```

2. **Database queries** (Supabase Dashboard → Logs):
   - Смотри на UPDATE queries на cabins
   - Проверяй что нет deadlocks

3. **Ошибки бронирования**:
   - RACE_CONDITION - норма, но если много → нужно UX улучшить
   - CABIN_NOT_AVAILABLE - норма
   - DB_ERROR, INTERNAL_ERROR - расследовать!

4. **Realtime connections** (Supabase Dashboard → Realtime):
   - Проверь что подписки работают
   - Не должно быть утечек памяти

---

## Performance Tips

### Оптимизация после запуска

1. **Добавить индексы** (если медленно):
```sql
CREATE INDEX IF NOT EXISTS idx_cabins_status_trip ON cabins(status, trip_id);
CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings(created_at DESC);
```

2. **Connection pooling** в Supabase:
   - Settings → Database → Connection Pooling
   - Включить для production

3. **CDN для frontend**:
   - Vercel автоматом использует CDN
   - Но проверь что static assets кэшируются

---

## Support

Если что-то не работает:

1. Проверь логи: `supabase functions logs create-booking --tail`
2. Проверь Supabase Dashboard → Logs
3. Проверь browser console в Mini App
4. Проверь `BOOKING_IMPLEMENTATION_SUMMARY.md` для деталей архитектуры

---

**Готово! 🚀**

После успешного деплоя система готова принимать бронирования с полной защитой от race conditions.
