/*
 * Для ЛОКАЛЬНОГО запуску: скопіюйте цей файл у js/env.js і впишіть свої значення
 * (Supabase → Project Settings → API). На Netlify/Vercel js/env.js створюється
 * автоматично зі змінних оточення (див. tools/build-env.sh), вручну не потрібно.
 *
 * Ключ anon/publishable — публічний за задумом: дані захищає Row Level Security.
 * НІКОЛИ не вставляйте сюди service_role / secret ключ.
 */
window.ENV = {
  SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-ANON-OR-PUBLISHABLE-KEY',
};
