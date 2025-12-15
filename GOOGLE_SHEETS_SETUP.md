# Google Sheets API Setup для Export функции

Этот гайд объясняет как настроить интеграцию с Google Sheets API для экспорта бронирований.

## 1. Создать Google Cloud Project

1. Перейдите на https://console.cloud.google.com
2. Создайте новый проект или выберите существующий
3. Запомните **Project ID**

## 2. Включить Google Sheets API

1. В Google Cloud Console перейдите в **APIs & Services > Library**
2. Найдите "Google Sheets API"
3. Нажмите **Enable**

## 3. Создать Service Account

1. Перейдите в **APIs & Services > Credentials**
2. Нажмите **Create Credentials > Service Account**
3. Заполните:
   - **Service account name**: `kitesafari-sheets-export` (или любое имя)
   - **Service account ID**: будет создан автоматически
4. Нажмите **Create and Continue**
5. **Grant this service account access to project**: можно пропустить (Skip)
6. Нажмите **Done**

## 4. Создать JSON ключ для Service Account

1. В списке Service Accounts найдите созданный аккаунт
2. Нажмите на него → перейдите на вкладку **Keys**
3. Нажмите **Add Key > Create new key**
4. Выберите тип **JSON**
5. Нажмите **Create** - файл автоматически скачается

Файл будет выглядеть так:
```json
{
  "type": "service_account",
  "project_id": "your-project-123456",
  "private_key_id": "abc123...",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBA...\n-----END PRIVATE KEY-----\n",
  "client_email": "kitesafari-sheets-export@your-project-123456.iam.gserviceaccount.com",
  "client_id": "123456789",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  ...
}
```

## 5. Создать Google Spreadsheet

1. Перейдите на https://docs.google.com/spreadsheets
2. Создайте новый spreadsheet
3. Скопируйте **Sheet ID** из URL:
   ```
   https://docs.google.com/spreadsheets/d/1ABC-xyz123_SHEET_ID_HERE/edit
                                            ^^^^^^^^^^^^^^^^
   ```

## 6. Дать доступ Service Account к spreadsheet

**ВАЖНО**: Без этого шага экспорт не будет работать!

1. Откройте созданный spreadsheet
2. Нажмите кнопку **Share** (Поделиться)
3. В поле **Add people and groups** вставьте email вашего Service Account
   - Это `client_email` из JSON файла
   - Например: `kitesafari-sheets-export@your-project-123456.iam.gserviceaccount.com`
4. Дайте права **Editor** (Редактор)
5. **Снимите галочку "Notify people"** (чтобы не отправлять email)
6. Нажмите **Share**

## 7. Добавить переменные окружения в Supabase

Перейдите в Supabase Dashboard → Settings → Edge Functions → Secrets

Добавьте следующие переменные:

### `GOOGLE_SERVICE_ACCOUNT_EMAIL`
Значение: `client_email` из JSON файла
```
kitesafari-sheets-export@your-project-123456.iam.gserviceaccount.com
```

### `GOOGLE_PRIVATE_KEY`
Значение: `private_key` из JSON файла **В ОДНУ СТРОКУ**
```
-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQE...\n-----END PRIVATE KEY-----\n
```

⚠️ **ВАЖНО**: Оставьте `\n` символы как есть - они нужны для правильного парсинга ключа!

### `GOOGLE_SHEET_ID`
Значение: ID из URL spreadsheet
```
1ABC-xyz123_SHEET_ID_HERE
```

### `TELEGRAM_BOT_TOKEN` (если еще не добавлен)
Значение: токен вашего Telegram бота
```
123456789:ABCdefGHIjklMNOpqrsTUVwxyz
```

### `MINI_APP_URL` (если еще не добавлен)
Значение: URL вашего Mini App
```
https://evgenyq.github.io/kitesafari-web/
```

## 8. Задеплоить Edge Functions

```bash
cd /Users/evgenyq/Projects/kitesafari-web

# Деплой telegram webhook
npx supabase functions deploy telegram-webhook

# Деплой export функции
npx supabase functions deploy export-to-sheets
```

## 9. Настроить Telegram Webhook

После деплоя telegram-webhook функции, нужно настроить webhook в Telegram:

```bash
# Получите URL вашей Edge Function из Supabase Dashboard
# Формат: https://YOUR_PROJECT_ID.supabase.co/functions/v1/telegram-webhook

# Установите webhook через cURL:
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://YOUR_PROJECT_ID.supabase.co/functions/v1/telegram-webhook"}'
```

Или через браузер:
```
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://YOUR_PROJECT_ID.supabase.co/functions/v1/telegram-webhook
```

Проверить webhook:
```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo"
```

## 10. Проверка работы

### Проверить Telegram бота:
1. Откройте бота в Telegram
2. Отправьте `/start`
3. Должна появиться кнопка "🏄 Открыть KiteSafari"

### Проверить экспорт в Google Sheets:
1. Откройте Mini App как администратор
2. Перейдите в админ-панель
3. Нажмите кнопку "📊 Экспорт в Google Sheets"
4. Должно появиться сообщение об успехе
5. Google Spreadsheet откроется в новой вкладке
6. Проверьте что данные появились в новом листе с названием трипа

## Troubleshooting

### Ошибка: "Request had insufficient authentication scopes"
- Проверьте что Service Account имеет доступ к spreadsheet (см. шаг 6)
- Убедитесь что Google Sheets API включен (см. шаг 2)

### Ошибка: "Invalid JWT"
- Проверьте что `GOOGLE_PRIVATE_KEY` содержит `\n` символы
- Убедитесь что ключ скопирован полностью, включая `-----BEGIN PRIVATE KEY-----` и `-----END PRIVATE KEY-----`

### Ошибка: "The caller does not have permission"
- Service Account должен быть добавлен в spreadsheet с правами Editor (см. шаг 6)

### Webhook не получает обновления
- Проверьте что webhook установлен: `getWebhookInfo`
- Убедитесь что URL правильный и доступен
- Проверьте логи Edge Function в Supabase Dashboard

### Логи Edge Functions
Посмотреть логи в реальном времени:
```bash
npx supabase functions logs telegram-webhook
npx supabase functions logs export-to-sheets
```

## Что дальше?

После успешной настройки можно:
1. ✅ Удалить Python бот (kitesafaribot) - он больше не нужен
2. ✅ Остановить fly.io деплой
3. ✅ Вся функциональность теперь в Supabase Edge Functions (Deno)

## Архитектура

```
Telegram Bot API
       ↓
   Webhook → Supabase Edge Function (telegram-webhook)
                    ↓
              Mini App открывается с кнопкой

Admin Panel
       ↓
   Export Button → Supabase Edge Function (export-to-sheets)
                         ↓
                   Google Sheets API
                         ↓
                   Data exported
```

Все работает серверлесс, без Python бэкенда! 🎉
