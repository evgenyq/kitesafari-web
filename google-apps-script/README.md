# Google Apps Script Setup для экспорта в Google Sheets

Этот скрипт решает проблему с JWT signing в Supabase Edge Functions, используя Google Apps Script как прокси для записи в Google Sheets.

## Шаги по настройке:

### 1. Создать Google Apps Script

1. Открой https://script.google.com/
2. Создай новый проект ("New Project")
3. Скопируй код из `sheets-api.gs` в редактор
4. Замени константы:
   - `SHEET_ID` - ID твоей Google таблицы (из URL: `https://docs.google.com/spreadsheets/d/SHEET_ID/edit`)
   - `SECRET_KEY` - придумай случайную строку для безопасности (например, сгенерируй UUID)

### 2. Deploy как Web App

1. Нажми "Deploy" → "New deployment"
2. Выбери тип: "Web app"
3. Настройки:
   - **Execute as**: Me (your email)
   - **Who has access**: Anyone
4. Нажми "Deploy"
5. **Скопируй Web App URL** - он понадобится для Supabase

### 3. Настроить Supabase Secrets

Добавь два новых секрета в Supabase:

```bash
# URL из предыдущего шага (должен заканчиваться на /exec)
npx supabase secrets set GOOGLE_APPS_SCRIPT_URL="https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec"

# Тот же SECRET_KEY, что использовал в Apps Script
npx supabase secrets set GOOGLE_APPS_SCRIPT_SECRET="your-random-secret-key"

# GOOGLE_SHEET_ID уже должен быть настроен
```

### 4. Deploy Edge Function

```bash
npx supabase functions deploy export-to-sheets
```

## Как это работает

1. Edge Function получает запрос на экспорт от админа
2. Собирает данные бронирований из Supabase
3. Вызывает Google Apps Script webhook с данными
4. Apps Script записывает данные в Google Sheets (используя твои права доступа)
5. Возвращает URL таблицы

## Преимущества этого подхода

- ✅ Обходит проблему с `SubtleCrypto.sign` в Deno
- ✅ Не требует Service Account и приватных ключей
- ✅ Использует твои права доступа к Google Drive
- ✅ Простая настройка
- ✅ Надёжная работа

## Безопасность

- Секретный ключ проверяется перед каждым запросом
- Apps Script работает только с указанной таблицей
- Доступ к webhook есть только у Supabase Edge Function
