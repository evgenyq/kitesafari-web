# Supabase Row Level Security Setup

## Что такое RLS?

Row Level Security (RLS) - это механизм безопасности в PostgreSQL/Supabase, который контролирует доступ к данным на уровне строк таблицы.

## Зачем нужно?

В нашем проекте frontend напрямую подключается к Supabase используя **ANON_KEY**. Этот ключ публичный (виден в браузере), поэтому нужно защитить данные через RLS политики.

## Текущие политики

### Read Access (SELECT)
✅ **Разрешено читать:**
- `trips` - все трипы
- `yachts` - все яхты
- `cabins` - все каюты

❌ **Запрещено читать:**
- `users` - информация о пользователях
- `bookings` - детали бронирований

### Write Access (INSERT, UPDATE, DELETE)
❌ **Запрещены все операции** на всех таблицах для ANON_KEY

## Применение RLS политик

### Вариант 1: Через Supabase Dashboard (UI)

1. Открыть https://supabase.com
2. Выбрать проект
3. Перейти в **Authentication → Policies**
4. Включить RLS для каждой таблицы
5. Добавить политики вручную через UI

### Вариант 2: Через SQL Editor (рекомендуется)

1. Открыть https://supabase.com → SQL Editor
2. Скопировать содержимое файла `supabase-rls.sql`
3. Вставить и выполнить SQL
4. Проверить что политики применились

```bash
# Содержимое файла supabase-rls.sql
cat supabase-rls.sql
```

## Проверка что RLS работает

### Тест 1: Проверить что RLS включен

```sql
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN ('trips', 'yachts', 'cabins', 'users', 'bookings');
```

Ожидаемый результат: `rowsecurity = true` для всех таблиц

### Тест 2: Проверить политики

```sql
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename;
```

Должны быть политики:
- `Allow public read trips` (SELECT)
- `Deny public insert trips` (INSERT)
- ... и т.д. для всех таблиц

### Тест 3: Попробовать изменить данные через ANON_KEY

Из frontend попробовать:
```typescript
// Должно работать (разрешено)
const { data } = await supabase.from('trips').select('*')

// Должно fail (запрещено)
const { error } = await supabase.from('trips').insert({ name: 'test' })
// Error: "new row violates row-level security policy"
```

## Безопасность

**✅ Безопасно коммитить в git:**
- `supabase-rls.sql` - SQL скрипт с политиками
- `.env.local` файл в `.gitignore`

**❌ НИКОГДА не коммитить:**
- `SUPABASE_SERVICE_KEY` (если есть)
- Любые приватные ключи

**ANON_KEY публичный:**
- Можно использовать в frontend
- Защищен через RLS политики
- Имеет ограниченный доступ

## Текущий статус

- [ ] RLS политики созданы (этот файл)
- [ ] Нужно применить в Supabase
- [ ] Нужно протестировать

## Применение политик

**Для продакшн базы:**
1. Открыть Supabase Dashboard
2. SQL Editor → New Query
3. Скопировать `supabase-rls.sql`
4. Выполнить
5. Проверить через verification queries

**Готово!** Frontend теперь имеет **read-only** доступ к trips, yachts, cabins.
