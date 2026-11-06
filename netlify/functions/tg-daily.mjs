/*
 * Щоденні нагадування в Telegram (запускає сам Netlify за розкладом).
 * 06:00 UTC = 08:00 за Києвом взимку / 09:00 влітку.
 * Пише лише тим, хто вказав chat ID, і лише коли є що нагадати (ТО, документи, прострочені оплати).
 */
import { Calc, missingEnv, allUsersData, validChatId, sendTelegram, kyivToday } from '../lib/tg.mjs';

export const config = { schedule: '0 6 * * *' };

export default async () => {
  const miss = missingEnv();
  if (miss.length) { console.warn('tg-daily: не задано', miss.join(', ')); return; }
  const today = kyivToday();
  const users = await allUsersData();
  let sent = 0;
  for (const data of users.values()) {
    const chatId = data.settings && data.settings.telegramChatId;
    if (!validChatId(chatId)) continue;
    const text = Calc.dailyDigest(data, today);
    if (!text) continue;
    const r = await sendTelegram(chatId, text);
    if (r.ok) sent++;
    else console.warn('tg-daily: не надіслано', r.status, r.description);
  }
  console.log(`tg-daily ${today}: надіслано ${sent}`);
};
