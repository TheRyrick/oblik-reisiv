/**
 * Розбір звіту логіста з Телеграму. Працює і в браузері (window.Report), і в Node — для тестів.
 *
 * Приклад звіту:
 *   28.10.2026
 *   Днепр - Поляниця — Киев
 *   1) 12000грн / безнал
 *   2) 7000грн / наличка
 *   -1000грн / диспетчерских
 *   6000грн / касса
 *
 * Готівка/безнал/карта — скільки отримали всього; диспетчерські — скільки віддали посереднику;
 * рядок «касса» (сума після диспетчерських) лише для інформації і не рахується.
 */
(function (root) {
  'use strict';

  /** "12000", "12 000", "12.000", "7 700,50" → число */
  function parseAmount(s) {
    const v = String(s).replace(/[\s ]/g, '');
    if (/^\d{1,3}([.,]\d{3})+$/.test(v)) return parseFloat(v.replace(/[.,]/g, ''));
    const n = parseFloat(v.replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  }

  const KINDS = [
    ['dispatch', /дисп|dispatch/g],
    ['kassa', /кас+а|кас+и/g],
    ['total', /итого|ітого|разом|всього|всего|сумарно/g],
    ['bank', /безнал|без\s*нал|б\s*\/\s*н|безгот|рахун|сч[её]т|iban|фоп|тов\b|ооо\b/g],
    ['card', /карт|card/g],
    ['cash', /нал|готів|готiв|готив|кеш|cash/g],
  ];

  /**
   * Тип оплати за словом у тексті. last=false — перше слово (текст після суми),
   * last=true — останнє слово (текст перед сумою), тобто завжди найближче до суми.
   */
  function kindOf(text, last = false) {
    const t = text.toLowerCase();
    let best = null, bestPos = -1;
    for (const [kind, re] of KINDS) {
      for (const m of t.matchAll(re)) {
        // «нал» всередині «безнал» — це безнал, не готівка
        if (kind === 'cash' && /без\s*$/.test(t.slice(0, m.index))) continue;
        const pos = m.index;
        if (best === null || (last ? pos > bestPos : pos < bestPos)) { best = kind; bestPos = pos; }
      }
    }
    return best;
  }

  function toIso(d, m, y) {
    let year = Number(y);
    if (year < 100) year += 2000;
    const dd = Number(d), mm = Number(m);
    if (!(dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12 && year >= 2000 && year <= 2100)) return '';
    const iso = `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    const check = new Date(iso + 'T00:00:00Z');
    return check.getUTCDate() === dd ? iso : '';
  }

  const DATE_RE = /(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})/g;
  // Сума: «12000», «12 000», «12.000», «7700,50», з мінусом або без, з «грн»/«гр»/«₴» або без
  const MONEY_RE = /[-−–—]?\s*(\d{1,3}(?:[  .]\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:грн\.?|гривень|гривен|гривні|гр\.?|₴|uah)?/giu;

  /**
   * Розбирає рядок на пари «сума — тип». Розуміє обидва порядки:
   *   «7000грн / наличка», «-300гр/дисп.» — спочатку сума;
   *   «дисп. 1500», «Диспетчерские: 1500» — спочатку слово;
   *   «12000 нал (1500 дисп)» — кілька сум в одному рядку.
   */
  function lineItems(line) {
    const tokens = [...line.matchAll(MONEY_RE)].map((m) => ({ amount: parseAmount(m[1]), from: m.index, to: m.index + m[0].length }));
    if (!tokens.length) return [];
    const wordFirst = /^\p{L}/u.test(line);
    return tokens.map((t, i) => {
      const after = line.slice(t.to, i + 1 < tokens.length ? tokens[i + 1].from : line.length);
      const before = line.slice(i > 0 ? tokens[i - 1].to : 0, t.from);
      const kind = wordFirst ? kindOf(before, true) || kindOf(after) : kindOf(after) || kindOf(before, true);
      return { amount: t.amount, kind };
    });
  }

  function parse(text) {
    const res = {
      startDate: '', endDate: '', route: '',
      cash: 0, bank: 0, card: 0, dispatch: 0,
      orders: 0, unknown: [], remainders: [],
    };
    const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let seenAmount = false;
    let order = { paid: 0, dispatch: 0 }; // поточне замовлення — щоб розпізнати залишок після диспетчерських

    for (const raw of lines) {
      // Дата (або дві дати — початок і кінець)
      const dates = [...raw.matchAll(DATE_RE)].map((m) => toIso(m[1], m[2], m[3])).filter(Boolean);
      if (dates.length) {
        if (!res.startDate) res.startDate = dates[0];
        if (dates.length > 1) res.endDate = dates[dates.length - 1];
      }
      // Прибираємо дати та номер замовлення «1)» / «1.»
      const noDates = raw.replace(DATE_RE, ' ');
      const NUM_RE = /^\s*\d{1,3}\s*\)\s*|^\s*\d{1,3}\.\s+/;
      const numbered = NUM_RE.test(noDates);
      const line = noDates.replace(NUM_RE, '').trim();
      if (!line || !/[\d\p{L}]/u.test(line)) continue;

      const items = lineItems(line).filter((x) => Number.isFinite(x.amount) && x.amount > 0);
      const known = items.filter((x) => x.kind);

      // Текстовий рядок без сум до першої суми — маршрут
      if (!known.length && !seenAmount) {
        // Перевага рядку з роздільниками («Київ - Львів»), а не просто слову
        const looksLikeRoute = /[-—–→]/.test(line);
        if ((!res.route || (looksLikeRoute && !res.route.includes('→'))) && /\p{L}{2,}/u.test(line)) {
          res.route = line.replace(/\s+[-—–]+\s+|\s*[—–]\s*/g, ' → ').replace(/\s+/g, ' ').slice(0, 120);
        }
        continue;
      }
      if (!items.length) continue; // звичайний текст (коментар) — пропускаємо

      // Новий номер «5)» — нове замовлення
      if (numbered) order = { paid: 0, dispatch: 0 };

      let lineOk = true;
      let remainder = false;
      for (const x of items) {
        if (x.kind === 'dispatch') {
          res.dispatch += x.amount;
          order.dispatch += x.amount;
        } else if (x.kind === 'cash' || x.kind === 'bank' || x.kind === 'card') {
          // «4500 нал, -1500 дисп, 3000 карта» — 3000 це залишок після диспетчерських
          // (як «касса»), а не нове замовлення: сума = оплата − диспетчерські
          if (order.dispatch > 0 && order.paid > 0 && Math.abs(x.amount - (order.paid - order.dispatch)) < 0.01) {
            remainder = true;
            continue;
          }
          res[x.kind] += x.amount;
          res.orders++;
          order.paid += x.amount;
        } else if (x.kind !== 'kassa' && x.kind !== 'total') lineOk = false;
      }
      if (remainder) res.remainders.push(raw);
      seenAmount = true;
      // Рядок із сумою, тип якої незрозумілий, — показуємо користувачу, а не губимо мовчки
      if (!lineOk) res.unknown.push(raw);
    }
    return res;
  }

  const api = { parse, parseAmount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Report = api;
})(typeof window !== 'undefined' ? window : globalThis);
