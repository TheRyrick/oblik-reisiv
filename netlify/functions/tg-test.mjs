/*
 * Тестове повідомлення в Telegram — кнопка «Зберегти і надіслати тест» у «Ставках».
 * Лише для того, хто увійшов: перевіряємо сесію Supabase, беремо chat ID з ЙОГО налаштувань.
 */
import { Calc, missingEnv, verifyUser, userData, validChatId, sendTelegram, kyivToday, json } from '../lib/tg.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json(405, { ok: false, error: 'Метод не підтримується' });
  if (missingEnv().length) return json(503, { ok: false, error: 'Бот ще не підключено на сервері. Додайте TELEGRAM_BOT_TOKEN і SUPABASE_SERVICE_ROLE_KEY у Netlify (див. README).' });
  try {
    const userId = await verifyUser(req);
    if (!userId) return json(401, { ok: false, error: 'Сесія застаріла — увійдіть ще раз' });
    const data = await userData(userId);
    const chatId = data.settings && data.settings.telegramChatId;
    if (!validChatId(chatId)) return json(400, { ok: false, error: 'У ставках не вказано chat ID' });
    const text = Calc.dailyDigest(data, kyivToday(), { always: true }) + '\n\nЦе тестове повідомлення. Щоранку бот писатиме лише тоді, коли є про що нагадати.';
    const r = await sendTelegram(chatId, text);
    if (!r.ok) {
      console.warn('telegram send failed', r.status, r.description);
      return json(400, { ok: false, error: 'Telegram не прийняв повідомлення. Перевірте chat ID і спершу напишіть своєму боту /start.' });
    }
    return json(200, { ok: true });
  } catch (err) {
    console.error('tg-test', err && err.message);
    return json(500, { ok: false, error: 'Помилка на сервері. Спробуйте пізніше.' });
  }
};
