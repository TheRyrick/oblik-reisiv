/*
 * Спільне для Telegram-функцій: читання даних із Supabase (серверним ключем) і надсилання повідомлень.
 * Секрети — ЛИШЕ у змінних оточення Netlify, ніколи в коді:
 *   SUPABASE_URL, SUPABASE_ANON_KEY            — ті самі, що для сайту
 *   SUPABASE_SERVICE_ROLE_KEY                  — серверний ключ Supabase (service_role / secret)
 *   TELEGRAM_BOT_TOKEN                         — токен бота від @BotFather
 */
import Calc from '../../js/calc.js';

export { Calc };

const env = (k) => (process.env[k] || '').trim();

export function missingEnv() {
  return ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'TELEGRAM_BOT_TOKEN'].filter((k) => !env(k));
}

/** Заголовки для серверного ключа: нові ключі sb_secret_… — лише в apikey, старі JWT — ще й у Authorization. */
function serviceHeaders() {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const h = { apikey: key };
  if (key.startsWith('eyJ')) h.Authorization = 'Bearer ' + key;
  return h;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Рядки app_data → { trips, cars, drivers, settings } по користувачах. */
async function readRows(filter) {
  const url = `${env('SUPABASE_URL')}/rest/v1/app_data?select=user_id,key,value${filter || ''}`;
  const res = await fetch(url, { headers: serviceHeaders() });
  if (!res.ok) throw new Error('Supabase ' + res.status);
  const rows = await res.json();
  const users = new Map();
  for (const r of rows) {
    if (!users.has(r.user_id)) users.set(r.user_id, { trips: [], cars: [], drivers: [], settings: {} });
    users.get(r.user_id)[r.key] = r.value;
  }
  return users;
}

export async function allUsersData() {
  return readRows('');
}

export async function userData(userId) {
  if (!UUID.test(userId)) throw new Error('bad user id');
  const users = await readRows('&user_id=eq.' + encodeURIComponent(userId));
  return users.get(userId) || { trips: [], cars: [], drivers: [], settings: {} };
}

/** Перевірити токен сесії з браузера → id користувача або null. */
export async function verifyUser(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token || token.length > 4096) return null;
  const res = await fetch(`${env('SUPABASE_URL')}/auth/v1/user`, {
    headers: { apikey: env('SUPABASE_ANON_KEY'), Authorization: 'Bearer ' + token },
  });
  if (!res.ok) return null;
  const u = await res.json().catch(() => null);
  return u && UUID.test(u.id || '') ? u.id : null;
}

export const validChatId = (v) => /^-?\d{5,15}$/.test(String(v || ''));

/** Надіслати простий текст (без розмітки — нічого не «зламається» від символів у назвах). */
export async function sendTelegram(chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN')}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: String(chatId), text: String(text).slice(0, 4000), disable_web_page_preview: true }),
  });
  const out = await res.json().catch(() => ({}));
  return { ok: res.ok && out.ok === true, status: res.status, description: out.description || '' };
}

/** Сьогоднішня дата за Києвом, «РРРР-ММ-ДД». */
export const kyivToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});
