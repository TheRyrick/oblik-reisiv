# Облік рейсів

Статичний вебзастосунок (HTML + Tailwind CSS через CDN + JavaScript). Дані зберігаються в
хмарній базі **Supabase** (безкоштовний тариф) і доступні з будь-якого пристрою після входу
поштою та паролем.

## 1. Налаштування Supabase (один раз)

1. Зареєструйтесь на <https://supabase.com> → **New project** (регіон — найближчий, напр. Frankfurt).
2. **SQL Editor → New query** → вставте вміст `supabase/schema.sql` → **Run**.
   Створиться таблиця `app_data` з Row Level Security: кожен користувач бачить лише свої дані.
3. **Authentication → Users → Add user → Create new user** — вкажіть свою пошту й пароль,
   увімкніть *Auto Confirm User*. Це і є ваш акаунт для входу.
4. **Authentication → Sign In / Providers** → вимкніть *Allow new users to sign up*,
   щоб ніхто інший не міг зареєструватися.
5. **Project Settings → API** скопіюйте:
   - *Project URL* → `SUPABASE_URL`
   - ключ *anon* / *publishable* → `SUPABASE_ANON_KEY`

   ⚠️ Ключ `service_role` / `secret` НІКОЛИ не використовуйте на сайті.

## 2. Змінні оточення (деплой)

Список змінних — у `.env.example`. Під час збирання скрипт `tools/build-env.sh`
генерує з них файл `js/env.js`, який читає сайт.

- **Netlify** — Site configuration → Environment variables → додайте `SUPABASE_URL`
  і `SUPABASE_ANON_KEY` → *Deploys → Trigger deploy*. Решта налаштувань — у `netlify.toml`.
- **Vercel** — Project → Settings → Environment Variables → ті самі дві змінні
  (Production + Preview) → *Redeploy*. Решта — у `vercel.json`.
- **GitHub Pages** — Settings → Secrets and variables → Actions → вкладка *Variables* →
  ті самі дві змінні. Деплой — `.github/workflows/deploy.yml` при кожному push у `main`.

## 3. Локальний запуск

```
cp js/env.example.js js/env.js   # і впишіть свої значення
npx serve .
```
`js/env.js` у `.gitignore` — у репозиторій він не потрапляє.

## Перенесення старих даних

Якщо раніше дані зберігались у браузері (LocalStorage), то при першому вході на тому ж
пристрої сайт запропонує перенести їх у хмару. Також можна зробити «Резервна копія (JSON)»
у старій версії і «Відновити з копії» в новій.

## Як працює збереження

- Після входу всі дані завантажуються з Supabase; кожна зміна автоматично відправляється
  в хмару (індикатор-хмаринка в шапці: зелена — збережено, синя — зберігається, червона — немає
  звʼязку, зміни буде відправлено повторно).
- Повернувшись на вкладку, сайт підтягує зміни, зроблені на інших пристроях.
- Пароль змінюється в Supabase: Authentication → Users → … → *Send password recovery*
  або вручну через *Update user*.
