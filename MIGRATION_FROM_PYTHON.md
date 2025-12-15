# Миграция с Python бота на Deno Edge Functions

Этот документ описывает как мигрировать с kitesafaribot (Python + fly.io) на полностью серверлесс архитектуру с Deno Edge Functions.

## Что было (Python бот)

```
kitesafaribot (Python)
├── api/webhook.py - основной бот
├── api/utils/supabase_adapter.py - Supabase клиент
├── api/handlers/ - команды бота
└── fly.toml - конфиг fly.io

Деплой: fly.io (платный хостинг)
Long Polling: постоянное соединение с Telegram
Зависимости: python-telegram-bot, supabase-py
```

## Что стало (Deno Edge Functions)

```
kitesafari-web/supabase/functions/
├── telegram-webhook/ - обработка команд бота
├── export-to-sheets/ - экспорт в Google Sheets
├── create-booking/ - создание бронирований
└── _shared/ - общие утилиты

Деплой: Supabase (бесплатный tier)
Webhooks: event-driven, без постоянного соединения
Зависимости: Deno stdlib, встроенные в runtime
```

## Сравнение функционала

| Функция | Python бот | Deno Edge Functions | Статус |
|---------|-----------|---------------------|--------|
| `/start` команда | ✅ | ✅ | Мигрировано |
| `/admin` команда | ✅ | ✅ | Мигрировано |
| Открытие Mini App | ✅ | ✅ | Мигрировано |
| Бронирование через чат | ✅ | ❌ | Не нужно (есть Web UI) |
| FAQ через чат | ✅ | ❌ | Не нужно (есть в Web) |
| Экспорт в Google Sheets | ✅ | ✅ | Мигрировано |
| Админ-панель | ✅ | ✅ | Улучшено (Web UI) |

## План миграции

### Шаг 1: Настроить Google Sheets API

Следуйте инструкциям в `GOOGLE_SHEETS_SETUP.md`:
1. Создать Service Account
2. Получить JSON ключ
3. Добавить переменные в Supabase
4. Дать доступ к spreadsheet

### Шаг 2: Задеплоить Edge Functions

```bash
cd /Users/evgenyq/Projects/kitesafari-web

# Деплой всех функций
npx supabase functions deploy telegram-webhook
npx supabase functions deploy export-to-sheets
npx supabase functions deploy create-booking
```

### Шаг 3: Настроить Telegram Webhook

```bash
# Остановить Python бота на fly.io (ОБЯЗАТЕЛЬНО!)
cd /Users/evgenyq/Projects/kitesafaribot
fly scale count 0

# Установить webhook на новую Edge Function
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://<YOUR_PROJECT_ID>.supabase.co/functions/v1/telegram-webhook"}'
```

### Шаг 4: Проверить работу

1. **Telegram бот**:
   - Отправьте `/start` → должна открыться кнопка Mini App
   - Отправьте `/admin` → должна открыться админ-панель

2. **Web App**:
   - Откройте через Mini App кнопку
   - Проверьте список трипов
   - Попробуйте забронировать каюту

3. **Админ-панель**:
   - Откройте через `/admin` или URL с `/admin`
   - Измените статус каюты
   - Нажмите "Экспорт в Google Sheets"
   - Проверьте что данные появились в spreadsheet

### Шаг 5: Удалить Python проект (опционально)

Если все работает, можно удалить Python бот:

```bash
# Полностью удалить fly.io app
cd /Users/evgenyq/Projects/kitesafaribot
fly apps destroy kitesafaribot

# Переименовать или архивировать проект
cd /Users/evgenyq/Projects/
mv kitesafaribot kitesafaribot-old
# или
tar -czf kitesafaribot-backup.tar.gz kitesafaribot && rm -rf kitesafaribot
```

## Преимущества новой архитектуры

### 💰 Экономия
- **Было**: fly.io платный хостинг (~$5-10/месяц)
- **Стало**: Supabase бесплатный tier (до 500K запросов/месяц)

### 🚀 Производительность
- **Было**: Long polling, постоянное соединение, холодные старты
- **Стало**: Webhooks, event-driven, мгновенный отклик

### 🛠️ Разработка
- **Было**: Python + venv, зависимости, fly.toml
- **Стало**: TypeScript + Deno, все встроено, единая кодовая база

### 📦 Deployment
- **Было**: `fly deploy`, логи через `fly logs`
- **Стало**: `npx supabase functions deploy`, логи в Dashboard

### 🔐 Безопасность
- **Было**: Токены в .env, ручная валидация
- **Стало**: Supabase Secrets, встроенная валидация initData

## Rollback план

Если что-то пошло не так, можно быстро вернуться:

```bash
# 1. Удалить webhook
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/deleteWebhook"

# 2. Запустить Python бота
cd /Users/evgenyq/Projects/kitesafaribot
fly scale count 1

# 3. Запустить локально (для отладки)
source venv/bin/activate
PYTHONPATH=/Users/evgenyq/Projects/kitesafaribot python3 api/webhook.py
```

## Что НЕ мигрировали

Следующий функционал был **намеренно убран**, так как он дублирует Web UI:

1. **Бронирование через чат** - лучше использовать Web UI с интерактивным планом палуб
2. **FAQ через чат** - можно добавить в Web UI если нужно
3. **Terms & Conditions через чат** - можно добавить в Web UI
4. **Просмотр списка каютов через чат** - есть в Web UI

Эти функции можно легко добавить в telegram-webhook если понадобятся.

## Мониторинг

### Логи Edge Functions
```bash
# Смотреть логи в реальном времени
npx supabase functions logs telegram-webhook --tail
npx supabase functions logs export-to-sheets --tail

# Или через Dashboard
# Supabase Dashboard → Edge Functions → Select function → Logs
```

### Проверить webhook
```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo"
```

Должен вернуть:
```json
{
  "ok": true,
  "result": {
    "url": "https://YOUR_PROJECT_ID.supabase.co/functions/v1/telegram-webhook",
    "has_custom_certificate": false,
    "pending_update_count": 0
  }
}
```

## FAQ

### Q: Почему отказываемся от Python?
**A**: Python бот дублирует функционал Web App. Мы оставляем только `/start` для запуска Mini App и экспорт в Google Sheets для админов.

### Q: Можно ли оставить Python только для Google Sheets?
**A**: Нет смысла - Deno отлично работает с Google Sheets API, не нужен отдельный Python проект.

### Q: Что делать если нужна новая команда в боте?
**A**: Добавить обработку в `telegram-webhook/index.ts` - это просто TypeScript код.

### Q: Как дебажить Edge Functions локально?
**A**:
```bash
# Запустить локально
npx supabase functions serve telegram-webhook --env-file .env.local

# Тестировать через curl
curl -X POST http://localhost:54321/functions/v1/telegram-webhook \
  -H "Content-Type: application/json" \
  -d '{"message": {"text": "/start", "chat": {"id": 123}}}'
```

### Q: Безопасно ли удалять Python проект?
**A**: Да, если вы:
1. ✅ Проверили что все Edge Functions работают
2. ✅ Экспорт в Google Sheets работает
3. ✅ Telegram webhook получает сообщения
4. ✅ Сделали бэкап на всякий случай

## Итоговая архитектура

```
┌─────────────────┐
│  Telegram Bot   │
│   (/start)      │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────┐
│  Edge Function              │
│  telegram-webhook           │
│  (Deno TypeScript)          │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  Telegram Mini App          │
│  (React + TypeScript)       │
│  GitHub Pages               │
└────────┬────────────────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌─────────┐  ┌──────────────┐
│ Booking │  │ Admin Panel  │
│   Flow  │  │  + Export    │
└────┬────┘  └──────┬───────┘
     │              │
     ▼              ▼
┌────────────────────────────┐
│  Supabase Edge Functions   │
│  - create-booking          │
│  - export-to-sheets        │
└────────┬───────────────────┘
         │
         ▼
┌────────────────────────────┐
│  Supabase PostgreSQL       │
│  (trips, cabins, bookings) │
└────────────────────────────┘
         │
         ▼
┌────────────────────────────┐
│  Google Sheets             │
│  (export reports)          │
└────────────────────────────┘
```

**Без единой строчки Python! 🎉**
