/**
 * Розбір тексту з Телеграму: звіт логіста за рейс або окрема заявка.
 * Працює і в браузері (window.Report), і в Node — для тестів.
 *
 * Звіт:                               Заявка:
 *   27.10–06.11.2026                    Днепр - Хмельницкий
 *   Днепр - Винница - Львов             400кг (1.23/1.66/2.27м - 1шт)
 *   1) 13000грн / безнал                7000грн / на карту
 *   2) 7000/наличка                     6000грн / в день выгрузки
 *   -300гр/диспетчерских                1000грн / по оригиналам
 *   3700грн/касса                       0962492673 Леся
 *
 * Гроші беремо ЛИШЕ з рядків, що починаються із суми і мають «грн» або «/» (або слово оплати одразу після суми).
 * Кілограми, розміри, телефони, адреси, номери заявок і документів — не гроші.
 * Кожна оплата — окремий рядок (payments) зі способом і позначкою «отримано / чекаємо».
 * Рядок «касса» (сума після диспетчерських) лише для інформації і не рахується.
 */
(function (root) {
  'use strict';

  /** "12000", "12 000", "12.000", "7 700,50" → число */
  function parseAmount(s) {
    const v = String(s).replace(/[\s  ]/g, '');
    if (/^\d{1,3}([.,]\d{3})+$/.test(v)) return parseFloat(v.replace(/[.,]/g, ''));
    const n = parseFloat(v.replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  }

  // «нал» — лише окремим словом або на початку слова («нал», «наличка», «налом»), а не в «оригиналам» чи «безнал»
  const KINDS = [
    ['dispatch', /дисп|dispatch/gu],
    ['kassa', /кас+а|кас+и/gu],
    ['total', /итого|ітого|разом|всього|всего|сумарно/gu],
    ['bank', /безнал|без\s*нал|б\s*\/\s*н|безгот|рахун|сч[её]т|iban|перерах|перечисл/gu],
    ['card', /карт|card/gu],
    ['cash', /(?<!\p{L})нал|(?<!\p{L})наліч|готів|готiв|готив|кеш|cash/gu],
  ];

  /**
   * Тип оплати за словом у тексті. last=false — перше слово (текст після суми),
   * last=true — останнє слово (текст перед сумою), тобто завжди найближче до суми.
   */
  function kindOf(text, last = false) {
    const t = String(text).toLowerCase();
    let best = null, bestPos = -1;
    for (const [kind, re] of KINDS) {
      for (const m of t.matchAll(re)) {
        // «без нал» — це безнал, не готівка
        if (kind === 'cash' && /без\s*$/.test(t.slice(0, m.index))) continue;
        const pos = m.index;
        if (best === null || (last ? pos > bestPos : pos < bestPos)) { best = kind; bestPos = pos; }
      }
    }
    return best;
  }

  // Оплата пізніше — «чекаємо» (а не «отримано»)
  const LATER = /оригин|оригін|отсроч|відстроч|после|після|в\s*день|по\s*факту|через\s*\d|дн[ея]й|днів|днi/iu;

  function toIso(d, m, y) {
    let year = Number(y);
    if (year < 100) year += 2000;
    const dd = Number(d), mm = Number(m);
    if (!(dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12 && year >= 2000 && year <= 2100)) return '';
    const iso = `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    const check = new Date(iso + 'T00:00:00Z');
    return check.getUTCDate() === dd ? iso : '';
  }

  const AMT = String.raw`(\d{1,3}(?:[  .]\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)`;
  const CUR = String.raw`(грн\.?|гривень|гривен|гривні|гривны|гр\.?|₴|uah)`;
  // Сума на початку рядка: «7000грн / наличка», «-300гр/дисп», «7000/наличка», «12000 нал»
  const LEAD_RE = new RegExp(String.raw`^([-−–—])?\s*${AMT}\s*${CUR}?\s*(\/)?\s*(.*)$`, 'iu');
  // Спершу слово: «Диспетчерские: 1500», «дисп. 1500 грн»
  const WORD_RE = new RegExp(String.raw`^(\p{L}[\p{L}\s.:]*?)[\s:]*[-−–—]?\s*${AMT}\s*${CUR}?\s*$`, 'iu');
  // Друга сума в дужках: «12000 нал (1500 дисп)»
  const INNER_RE = new RegExp(String.raw`[(,;]\s*[-−–—]?\s*${AMT}\s*${CUR}?\s*\/?\s*(\p{L}[^),;]*)`, 'giu');

  /**
   * Дата рейсу — лише з рядка, що складається з дати (або діапазону дат):
   * «28.10.2026», «27.10–06.11.2026», «27.10.2026 - 06.11.2026», «Дата: 28.10.26».
   * Дати всередині іншого тексту («Реализация … от 28.10.2026 9:32») і розміри «1.23/1.66» ігноруються.
   */
  function lineDates(line) {
    const l = line.replace(/\s+/g, ' ').trim().replace(/^[\p{L}\s]*:\s*/u, '').replace(/\s*(р\.?|року|г\.?|года)$/iu, '');
    let m = l.match(/^(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?\s*[-–—]\s*(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})$/);
    if (m) {
      const end = toIso(m[4], m[5], m[6]);
      if (!end) return null;
      let startY = m[3] || m[6];
      // «28.12–03.01.2027» — початок у попередньому році
      if (!m[3] && Number(m[2]) > Number(m[5])) startY = String(Number(m[6].length === 2 ? '20' + m[6] : m[6]) - 1);
      const start = toIso(m[1], m[2], startY);
      return start ? [start, end] : null;
    }
    m = l.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})$/);
    if (m) { const d = toIso(m[1], m[2], m[3]); return d ? [d] : null; }
    return null;
  }

  /** Гроші в рядку → [{ amount, kind, note }] або [] (не грошовий рядок). */
  function lineMoney(line) {
    const out = [];
    let m = line.match(LEAD_RE);
    if (m) {
      const amount = parseAmount(m[2]);
      const cur = !!m[3];
      const slash = !!m[4];
      let rest = m[5] || '';
      // «400кг», «1.5т», «0962492673 Леся» — без «грн», «/» і слова оплати це не гроші
      const kind = kindOf(rest.split(/[(,;]/)[0]);
      if (cur || slash || kind) {
        // Друга сума в дужках
        for (const x of rest.matchAll(INNER_RE)) {
          const k = kindOf(x[3]);
          if (k) out.push({ amount: parseAmount(x[1]), kind: k, note: x[3].trim() });
        }
        rest = rest.replace(INNER_RE, '').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
        out.unshift({ amount, kind: kind || null, note: rest });
        return out;
      }
      return [];
    }
    m = line.match(WORD_RE);
    if (m) {
      const kind = kindOf(m[1], true);
      if (kind) return [{ amount: parseAmount(m[2]), kind, note: m[1].replace(/[:.\s]+$/, '').trim() }];
    }
    return [];
  }

  // Міста з дефісом у назві — не розбиваємо («Кривой-Рог», «Кам'янець-Подільський»)
  const COMPOUND = /(кривой|кривий|кам[ʼ'’]янець|каменец|ростов|новоград|переяслав|біла|белая)$/iu;
  /** «Днепр - Винница-Кривой-Рог» → «Днепр → Винница → Кривой-Рог» */
  function routeOf(line) {
    const s = line.replace(/\s+[-—–→]+\s+|\s*[—–→]+\s*/g, ' → ')
      .replace(/(\p{L}+)-(?=\p{L})/gu, (all, w) => (COMPOUND.test(w) ? all : w + ' → '));
    return s.replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  /** Здогадка, хто замовник: «груз для …», «ФОП …», «ТОВ …», або перший контакт «Леся 0962492673». */
  function guessCustomer(lines) {
    for (const l of lines) {
      const m = l.match(/(?:груз|вантаж|товар)\s+для\s+(.{2,60})/iu) || l.match(/((?:ФОП|ТОВ|ООО|ПП|ТзОВ|ЧП)\s+[^,(\n]{2,50})/u);
      if (m) return m[1].replace(/\s+/g, ' ').trim();
    }
    for (const l of lines) {
      const m = l.match(/^(?:\+?\d[\d\s()-]{8,})\s+(\p{L}[\p{L}'’ -]{1,30})$/u) || l.match(/^(\p{L}[\p{L}'’]{1,30})\s+(?:\+?\d[\d\s()-]{8,})$/u);
      if (m) { const phone = l.replace(m[1], '').trim(); return `${m[1].trim()} ${phone}`.slice(0, 80); }
    }
    return '';
  }

  function parse(text) {
    const res = {
      startDate: '', endDate: '', route: '', customer: '',
      cash: 0, bank: 0, card: 0, dispatch: 0,
      orders: 0, payments: [], unknown: [], remainders: [], guessed: 0,
    };
    const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let seenAmount = false;
    let orderNo = 0;
    let order = { paid: 0, dispatch: 0 }; // поточне замовлення — щоб розпізнати залишок після диспетчерських

    for (const raw of lines) {
      const dates = lineDates(raw);
      if (dates) {
        if (!res.startDate) { res.startDate = dates[0]; if (dates[1]) res.endDate = dates[1]; }
        continue;
      }
      // Номер замовлення «1)» / «1.»
      const NUM_RE = /^\s*(\d{1,3})\s*\)\s*|^\s*(\d{1,3})\.\s+(?=\D)/;
      const nm = raw.match(NUM_RE);
      const line = raw.replace(NUM_RE, '').trim();
      if (!line || !/[\d\p{L}]/u.test(line)) continue;

      const items = lineMoney(line).filter((x) => Number.isFinite(x.amount) && x.amount > 0);
      if (!items.length) {
        // Текстовий рядок до першої суми — маршрут (перевага рядку з роздільниками «Київ - Львів»)
        if (!seenAmount) {
          const looksLikeRoute = /\p{L}{2,}\s*[-—–→]+\s*\p{L}{2,}/u.test(line) && !/[:@]|https?:/.test(line);
          if ((!res.route && !/:\s*$/.test(line) && !/^\+?\d/.test(line)) || (looksLikeRoute && !res.route.includes('→'))) {
            if (/\p{L}{2,}/u.test(line)) res.route = routeOf(line);
          }
        }
        continue;
      }

      // Новий номер «5)» — нове замовлення
      if (nm) { order = { paid: 0, dispatch: 0 }; orderNo = Number(nm[1] || nm[2]); }
      seenAmount = true;
      let lineOk = true;
      let remainder = false;
      for (const x of items) {
        if (x.kind === 'dispatch') {
          res.dispatch += x.amount;
          order.dispatch += x.amount;
        } else if (x.kind === 'kassa' || x.kind === 'total') {
          // інформаційний рядок — не рахуємо
        } else if (x.kind === 'cash' || x.kind === 'bank' || x.kind === 'card' || x.kind === null) {
          // «4500 нал, -1500 дисп, 3000 карта» — 3000 це залишок після диспетчерських (як «касса»)
          if (x.kind && order.dispatch > 0 && order.paid > 0 && Math.abs(x.amount - (order.paid - order.dispatch)) < 0.01) {
            remainder = true;
            continue;
          }
          // Спосіб не вказано («6000грн / в день выгрузки») — ставимо безнал, користувач поправить
          const method = x.kind || 'bank';
          if (!x.kind) res.guessed++;
          const later = LATER.test(x.note);
          res.payments.push({
            amount: x.amount, method, note: x.note.slice(0, 120), order: orderNo || null,
            guessed: !x.kind,
            received: method !== 'bank' && x.kind !== null && !later,
          });
          res[method] += x.amount;
          res.orders++;
          order.paid += x.amount;
        } else lineOk = false;
      }
      if (remainder) res.remainders.push(raw);
      if (!lineOk) res.unknown.push(raw);
    }
    res.customer = guessCustomer(lines);
    return res;
  }

  const api = { parse, parseAmount, lineMoney, lineDates };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Report = api;
})(typeof window !== 'undefined' ? window : globalThis);
