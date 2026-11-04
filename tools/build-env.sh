#!/bin/sh
# Генерує js/env.js зі змінних оточення під час деплою (Netlify / Vercel / GitHub Actions).
set -e
if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_ANON_KEY" ]; then
  echo "ПОМИЛКА: не задано SUPABASE_URL та/або SUPABASE_ANON_KEY у змінних оточення." >&2
  exit 1
fi
cd "$(dirname "$0")/.."
cat > js/env.js <<JS
window.ENV = {
  SUPABASE_URL: '$SUPABASE_URL',
  SUPABASE_ANON_KEY: '$SUPABASE_ANON_KEY',
};
JS
echo "js/env.js згенеровано"
