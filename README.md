# Облік рейсів

Статичний вебзастосунок (HTML + Tailwind CSS через CDN + JavaScript). Збирання не потрібне.

## Локальний запуск
Відкрийте `index.html` у браузері або запустіть будь-який статичний сервер, наприклад:
```
npx serve .
```

## Деплой
- **GitHub Pages** — автоматично через `.github/workflows/deploy.yml` при кожному push у `main`
  (Settings → Pages → Source: *GitHub Actions*).
- **Netlify** — `netlify.toml` (підключіть репозиторій, налаштування підхопляться самі).
- **Vercel** — `vercel.json` (Import Project → Framework: *Other*).

## Зміна логіна/пароля
Відкрийте `tools/password.html`, згенеруйте новий блок і замініть ним вміст `js/auth-config.js`.
