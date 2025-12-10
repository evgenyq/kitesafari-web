# 🏝️ Kite Safari Web

Веб-приложение для просмотра yacht трипов, яхт и бронирований кают.

## 📋 Статус проекта

**Current Status:** 🚧 Planning Complete - Ready to Start Development

- ✅ Plan approved
- ⏳ Development not started

## 🎯 Что это?

Современное веб-приложение для:
- Просмотра деталей yacht трипов
- Обзора доступных яхт с фотографиями
- Просмотра кают со статусами бронирований
- Информации о забронировавших гостях

**MVP v1:** Обычный веб-сайт (responsive, mobile-first)
**MVP v2:** + Telegram Mini App интеграция (планируется)

## 🛠️ Технологии

- **Frontend:** React 18 + TypeScript + Vite
- **Routing:** React Router v6
- **Database:** Supabase (PostgreSQL)
- **Backend:** Supabase Edge Functions (Deno/TypeScript)
- **Styling:** CSS Modules
- **Hosting:** GitHub Pages

## 📂 Структура

```
kitesafari-web/
├── src/
│   ├── components/    # React компоненты
│   ├── pages/         # Страницы приложения
│   ├── hooks/         # Custom hooks для данных
│   ├── lib/           # Утилиты и Supabase клиент
│   └── types/         # TypeScript типы
├── supabase/
│   ├── functions/     # Edge Functions (backend)
│   │   ├── create-booking/  # Бронирование кают
│   │   └── _shared/   # Общие типы и утилиты
│   └── migrations/    # SQL миграции
├── public/            # Статические файлы
├── PLAN.md            # Детальный план разработки
└── README.md          # Этот файл
```

## 🚀 Быстрый старт

> **Примечание:** Проект еще не инициализирован. Следуйте Фазе 1 в PLAN.md для setup.

**Когда проект будет готов:**

```bash
# Клонировать репозиторий
git clone https://github.com/yourusername/kitesafari-web.git
cd kitesafari-web

# Установить зависимости
npm install

# Создать .env файл
cp .env.example .env
# Заполнить переменные окружения

# Запустить dev server
npm run dev

# Запустить Edge Functions локально (в отдельном терминале)
supabase functions serve

# Деплой Edge Functions на Supabase
supabase functions deploy create-booking
```

## 🔧 Edge Functions

### Локальная разработка

```bash
# Запустить все функции локально
supabase functions serve

# Запустить конкретную функцию
supabase functions serve create-booking

# Тестировать функцию
curl -i --location --request POST 'http://localhost:54321/functions/v1/create-booking' \
  --header 'Authorization: Bearer YOUR_ANON_KEY' \
  --header 'Content-Type: application/json' \
  --data '{"trip_id":"...","cabin_id":"...","telegram_id":123}'
```

### Деплой

```bash
# Деплой всех функций
supabase functions deploy

# Деплой конкретной функции
supabase functions deploy create-booking

# Просмотр логов
supabase functions logs create-booking
```

### Environment Variables

Edge Functions используют следующие переменные:
- `SUPABASE_URL` - автоматически
- `SUPABASE_SERVICE_ROLE_KEY` - автоматически
- `BOT_WEBHOOK_URL` - опционально, для уведомлений админов

Установить через:
```bash
supabase secrets set BOT_WEBHOOK_URL=https://your-bot.com/webhook
```

## 📖 Документация

Подробная документация находится в **[PLAN.md](./PLAN.md)**:
- Функциональные требования
- UI/UX спецификация
- Детальный план реализации (8 фаз)
- Чеклисты для тестирования
- Timeline (5-6 дней)

## 🔗 Связанные проекты

- **Bot:** [kitesafaribot](https://github.com/yourusername/kitesafaribot) - Python Telegram bot
- **Database:** Supabase (shared между проектами)

## 📝 Лицензия

Private project

---

**Детали:** См. [PLAN.md](./PLAN.md) для полной информации
