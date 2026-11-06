/**
 * Розрахунки по рейсу. Працює і в браузері (window.Calc), і в Node (module.exports) — для тестів.
 */
(function (root) {
  'use strict';

  const DEFAULTS = Object.freeze({
    perDiem: 200,   // добові, грн/доба
    taxRate: 8,     // податок, % від безготівки
    driverRate: 25, // ЗП водія, % від чистого прибутку авто
    partnerRate: 25, // частка компаньйона, % від чистого прибутку бізнесу
    stoRate: 330,   // СТО, грн/доба
    logistRate: 10, // ЗП логіста, % від фрахту
    monthlyExpenses: 0, // щомісячні витрати бізнесу, грн/міс
    mgmtShare: 30,  // авто під управлінням: ваша частка, % від прибутку до розподілу
  });

  /** Безпечне перетворення у число (підтримує кому як десятковий роздільник). */
  function num(v) {
    if (v === null || v === undefined || v === '') return 0;
    const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * Кількість діб (по 24 год) у рейсі: різниця між датою повернення та датою виїзду.
   * Напр. з 01.05 по 03.05 = 2 доби. Рейс у межах одного дня = 1 доба.
   */
  function daysBetween(start, end) {
    if (!start || !end) return 0;
    const a = Date.parse(start + 'T00:00:00Z');
    const b = Date.parse(end + 'T00:00:00Z');
    if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0;
    return Math.max(1, Math.round((b - a) / 86400000));
  }

  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

  /**
   * Розрахунок усіх показників рейсу.
   * @param {object} t — дані рейсу
   * @param {object} [rates] — ставки (perDiem, taxRate, driverRate); якщо в рейсі збережені свої — вони мають пріоритет
   */
  function calcTrip(t, rates) {
    const r = Object.assign({}, DEFAULTS, rates || {});
    const perDiemRate = t.perDiem !== undefined && t.perDiem !== '' ? num(t.perDiem) : num(r.perDiem);
    const taxRate = t.taxRate !== undefined && t.taxRate !== '' ? num(t.taxRate) : num(r.taxRate);
    const driverRate = t.driverRate !== undefined && t.driverRate !== '' ? num(t.driverRate) : num(r.driverRate);
    const partnerRate = t.partnerRate !== undefined && t.partnerRate !== '' ? num(t.partnerRate) : num(r.partnerRate);
    const stoRate = t.stoRate !== undefined && t.stoRate !== '' ? num(t.stoRate) : num(r.stoRate);
    const logistRate = t.logistRate !== undefined && t.logistRate !== '' ? num(t.logistRate) : num(r.logistRate);

    const odoStart = num(t.odoStart);
    const odoEnd = num(t.odoEnd);
    const km = Math.max(0, odoEnd - odoStart);

    const fuelLiters = num(t.fuelLiters);
    // Ціна для водія (на стелі АЗС) — з неї рахується ЗП водія
    const fuelPrice = num(t.fuelPrice);
    // Фактична ціна (зі знижкою) — реальні витрати бізнесу; якщо не вказана — як для водія
    const hasActual = t.fuelPriceActual !== undefined && t.fuelPriceActual !== null && t.fuelPriceActual !== '';
    const fuelPriceActual = hasActual ? num(t.fuelPriceActual) : fuelPrice;
    const fuelCostDriver = fuelLiters * fuelPrice;
    const fuelCost = fuelLiters * fuelPriceActual;
    const fuelDiscount = fuelCostDriver - fuelCost;
    const fuelPer100 = km > 0 ? (fuelLiters / km) * 100 : 0;

    const cash = num(t.cash);
    const bank = num(t.bank);
    const card = num(t.card);
    // Отримано всього (готівка + безнал + карта)
    const received = cash + bank + card;
    // Диспетчерські — віддали посереднику, який дав замовлення; у фрахт не входять
    const dispatch = num(t.dispatch);
    // Фрахт — реальний заробіток рейсу: з нього рахуються ЗП логіста, ЗП водія і прибуток
    const freight = received - dispatch;

    // Податок — від усієї суми, що прийшла на рахунок
    const tax = bank * (taxRate / 100);
    const days = daysBetween(t.startDate, t.endDate);
    const perDiem = days * perDiemRate;
    const sto = days * stoRate;
    const other = num(t.otherExpenses);
    const repair = num(t.repairExpenses);

    // Прибуток авто — база для ЗП водія (паливо за ціною для водія), до виплати ЗП.
    // СТО, податок і ремонт на ЗП водія не впливають — вони віднімаються лише від прибутку бізнесу.
    const carProfit = freight - fuelCostDriver - perDiem - other;
    // ЗП водія — % від прибутку авто (якщо рейс збитковий — 0)
    const driverPay = carProfit > 0 ? carProfit * (driverRate / 100) : 0;
    // ЗП логіста — % від суми фрахту (не впливає на ЗП водія)
    const logistPay = freight * (logistRate / 100);
    // Прибуток після всіх витрат = Прибуток авто + знижка на паливо − податок − СТО − ремонт − ЗП водія − ЗП логіста
    const profitAll = carProfit + fuelDiscount - tax - sto - repair - driverPay - logistPay;
    // Авто під управлінням (не ваше): увесь прибуток після витрат ділиться з власником авто.
    // Податок, СТО і ремонт віднімаються до розподілу — тобто діляться за частками (і збиток теж).
    const managed = !!t.managed;
    const mgmtShare = managed ? Math.min(100, Math.max(0, t.mgmtShare !== undefined && t.mgmtShare !== '' ? num(t.mgmtShare) : num(r.mgmtShare))) : 100;
    // Прибуток до розподілу (для авто під управлінням) і чистий прибуток вашого бізнесу
    const pool = managed ? profitAll : 0;
    const netProfit = managed ? profitAll * (mgmtShare / 100) : profitAll;
    // Власнику авто: решта прибутку до розподілу
    const carOwnerShare = managed ? profitAll - netProfit : 0;
    // Частка компаньйона — % від чистого прибутку бізнесу (для авто в управлінні — від вашої частки); якщо збиток — 0
    const partnerShare = netProfit > 0 ? netProfit * (partnerRate / 100) : 0;
    // Ваш прибуток — чистий прибуток бізнесу після виплати компаньйону
    const ownerProfit = netProfit - partnerShare;

    const pricePerKm = km > 0 ? freight / km : 0;
    const profitPerKm = km > 0 ? netProfit / km : 0;
    const totalExpenses = fuelCost + tax + perDiem + sto + other + repair + driverPay + logistPay;

    return {
      km, days, fuelLiters, fuelPrice, fuelPriceActual, fuelPer100,
      cash, bank, card, freight,
      received: round2(received),
      dispatch: round2(dispatch),
      fuelCost: round2(fuelCost),
      fuelCostDriver: round2(fuelCostDriver),
      fuelDiscount: round2(fuelDiscount),
      tax: round2(tax),
      perDiem: round2(perDiem),
      sto: round2(sto),
      other: round2(other),
      repair: round2(repair),
      carProfit: round2(carProfit),
      driverPay: round2(driverPay),
      logistPay: round2(logistPay),
      netProfit: round2(netProfit),
      partnerShare: round2(partnerShare),
      ownerProfit: round2(ownerProfit),
      managed, mgmtShare,
      pool: round2(pool),
      carOwnerShare: round2(carOwnerShare),
      totalExpenses: round2(totalExpenses),
      pricePerKm: round2(pricePerKm),
      profitPerKm: round2(profitPerKm),
      rates: { perDiem: perDiemRate, taxRate, driverRate, partnerRate, stoRate, logistRate, mgmtShare },
    };
  }

  /** Місяць запису «РРРР-ММ» або '' (захист від сміття в датах). */
  const monthOf = (d) => { const m = String(d || '').slice(0, 7); return /^\d{4}-\d{2}$/.test(m) ? m : ''; };

  /**
   * Сумарні показники за набір рейсів.
   * Витрати бізнесу зменшують чистий прибуток бізнесу та ваш прибуток, але НЕ частку компаньйона:
   *  - постійні щомісячні (rates.monthlyExpenses, грн) — один раз за кожен місяць, у якому є рейси;
   *  - записи з вкладки «Витрати» (opts.expenses — уже відібрані за періодом) — за категоріями.
   */
  function summarize(trips, rates, opts) {
    const r = Object.assign({}, DEFAULTS, rates || {});
    const s = {
      count: 0, km: 0, days: 0, fuelLiters: 0, freight: 0, cash: 0, bank: 0, card: 0, received: 0, dispatch: 0,
      fuelCost: 0, fuelCostDriver: 0, fuelDiscount: 0, tax: 0, perDiem: 0, sto: 0, other: 0, repair: 0, carProfit: 0, driverPay: 0, logistPay: 0, netProfit: 0,
      partnerShare: 0, ownerProfit: 0, carOwnerShare: 0,
      // Розбивка: свої авто / авто під управлінням
      ownCount: 0, ownNet: 0,
      mgmtCount: 0, mgmtFreight: 0, mgmtPool: 0, mgmtNet: 0,
    };
    const SUM = ['km', 'days', 'fuelLiters', 'freight', 'cash', 'bank', 'card', 'received', 'dispatch', 'fuelCost', 'fuelCostDriver', 'fuelDiscount',
      'tax', 'perDiem', 'sto', 'other', 'repair', 'carProfit', 'driverPay', 'logistPay', 'netProfit', 'partnerShare', 'ownerProfit', 'carOwnerShare'];
    const months = new Set();
    for (const t of trips) {
      const c = calcTrip(t, rates);
      s.count++;
      for (const k of SUM) s[k] += c[k];
      if (c.managed) {
        s.mgmtCount++; s.mgmtFreight += c.freight; s.mgmtPool += c.pool; s.mgmtNet += c.netProfit;
      } else {
        s.ownCount++; s.ownNet += c.netProfit;
      }
      const m = monthOf(t.startDate);
      if (m) months.add(m);
    }
    s.months = months.size;
    s.monthlyRate = num(r.monthlyExpenses);
    s.monthlyFlat = s.months * s.monthlyRate;
    // Витрати бізнесу за категоріями
    const byCat = new Map();
    let entries = 0;
    for (const e of (opts && opts.expenses) || []) {
      const a = num(e.amount);
      if (!a) continue;
      entries += a;
      const cat = String(e.category || '').trim() || 'Інше';
      byCat.set(cat, (byCat.get(cat) || 0) + a);
    }
    s.bizEntries = entries;
    s.bizByCat = Array.from(byCat, ([category, amount]) => ({ category, amount: round2(amount) })).sort((a, b) => b.amount - a.amount);
    // monthlyExpenses — усі витрати бізнесу разом (постійні + записи)
    s.monthlyExpenses = s.monthlyFlat + s.bizEntries;
    s.netProfit -= s.monthlyExpenses;
    s.ownerProfit = s.netProfit - s.partnerShare;
    for (const k of Object.keys(s)) if (typeof s[k] === 'number') s[k] = round2(s[k]);
    s.pricePerKm = s.km > 0 ? round2(s.freight / s.km) : 0;
    s.fuelPer100 = s.km > 0 ? round2((s.fuelLiters / s.km) * 100) : 0;
    s.totalExpenses = round2(s.fuelCost + s.tax + s.perDiem + s.sto + s.other + s.repair + s.driverPay + s.logistPay + s.monthlyExpenses);
    return s;
  }

  /** Ключ власника авто: імʼя без зайвих пробілів і без різниці великих/малих літер. */
  function ownerKey(name) {
    return String(name || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('uk');
  }
  const cleanName = (s) => String(s || '').trim().replace(/\s+/g, ' ');

  /** Вид запису розрахунку: старі записи без kind — це власники авто. */
  const payoutKind = (p) => (p && (p.kind === 'partner' || p.kind === 'driver') ? p.kind : 'owner');
  /** Ключ сторони розрахунку для запису виплати. */
  function payoutParty(p) {
    const kind = payoutKind(p);
    if (kind === 'partner') return 'partner';
    if (kind === 'driver') return p.party ? String(p.party) : 'n:' + ownerKey(p.name);
    return ownerKey(p.owner || p.name);
  }
  /** Ключ водія рейсу: id з довідника, або імʼя (якщо водія вже видалено і id немає). */
  const driverKeyOf = (t) => (t.driverId ? String(t.driverId) : t.driverName ? 'n:' + ownerKey(t.driverName) : '');

  /**
   * Загальний облік «нараховано / виплачено / борг».
   * cfg.partyOf(t, c) → { key, name } | null — кому нараховується з рейсу;
   * cfg.amountOf(c) — скільки нараховано з рейсу; cfg.monthFields(c) — додаткові суми для таблиці по місяцях.
   * payout.amount > 0 — ви виплатили; < 0 — вам повернули.
   * balance > 0 — ви винні; < 0 — вам винні.
   */
  function ledger(trips, payouts, rates, cfg) {
    const map = new Map();
    const get = (key, name) => {
      if (!key) return null;
      if (!map.has(key)) map.set(key, { key, name: cleanName(name) || '—', trips: [], payouts: [], accrued: 0, paid: 0, balance: 0, months: [], _m: new Map() });
      const o = map.get(key);
      if ((!o.name || o.name === '—') && cleanName(name)) o.name = cleanName(name);
      return o;
    };
    for (const t of trips || []) {
      const c = calcTrip(t, rates);
      const party = cfg.partyOf(t, c);
      if (!party) continue;
      const o = get(party.key, party.name);
      if (!o) continue;
      const amount = cfg.amountOf(c);
      o.trips.push({ t, c, amount });
      o.accrued += amount;
      const m = monthOf(t.startDate);
      if (!o._m.has(m)) {
        const row = { month: m, count: 0, freight: 0, amount: 0 };
        o._m.set(m, row);
        o.months.push(row);
      }
      const row = o._m.get(m);
      row.count++; row.freight += c.freight; row.amount += amount;
      const extra = cfg.monthFields ? cfg.monthFields(c) : {};
      for (const k of Object.keys(extra)) row[k] = (row[k] || 0) + extra[k];
    }
    for (const p of payouts || []) {
      if (payoutKind(p) !== cfg.kind) continue;
      const o = get(payoutParty(p), p.owner || p.name);
      if (!o) continue;
      o.payouts.push(p);
      o.paid += num(p.amount);
    }
    const out = Array.from(map.values());
    for (const o of out) {
      delete o._m;
      o.accrued = round2(o.accrued);
      o.paid = round2(o.paid);
      o.balance = round2(o.accrued - o.paid);
      o.months.sort((a, b) => b.month.localeCompare(a.month));
      for (const r of o.months) for (const k of Object.keys(r)) if (typeof r[k] === 'number' && k !== 'count') r[k] = round2(r[k]);
      o.payouts.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (b.createdAt || 0) - (a.createdAt || 0));
      o.trips.sort((a, b) => String(b.t.startDate || '').localeCompare(String(a.t.startDate || '')));
      o.last = o.payouts[0] || null;
      // Нараховано за рейси після останнього розрахунку (за датою початку рейсу)
      const after = o.trips.filter(({ t }) => !o.last || String(t.startDate || '') > String(o.last.date || ''));
      o.sinceLast = round2(after.reduce((a, x) => a + x.amount, 0));
      o.sinceCount = after.length;
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'uk'));
  }

  /** Власники авто під управлінням: їхня частка прибутку. */
  function ownerLedger(trips, payouts, rates) {
    const L = ledger(trips, payouts, rates, {
      kind: 'owner',
      partyOf: (t) => (t.managed && ownerKey(t.ownerName) ? { key: ownerKey(t.ownerName), name: t.ownerName } : null),
      amountOf: (c) => c.carOwnerShare,
      monthFields: (c) => ({ pool: c.pool, my: c.netProfit }),
    });
    // Сумісність: carOwnerShare у місяцях
    for (const o of L) for (const r of o.months) r.carOwnerShare = r.amount;
    return L;
  }

  /** Компаньйон: його відсоток з кожного рейсу. Завжди одна сторона «Компаньйон». */
  function partnerLedger(trips, payouts, rates, name) {
    return ledger(trips, payouts, rates, {
      kind: 'partner',
      partyOf: (t, c) => (c.partnerShare ? { key: 'partner', name: name || 'Компаньйон' } : null),
      amountOf: (c) => c.partnerShare,
      monthFields: (c) => ({ net: c.netProfit }),
    });
  }

  /** Водії: ЗП + добові з кожного рейсу. */
  function driverLedger(trips, payouts, rates) {
    return ledger(trips, payouts, rates, {
      kind: 'driver',
      partyOf: (t) => { const key = driverKeyOf(t); return key ? { key, name: t.driverName } : null; },
      amountOf: (c) => c.driverPay + c.perDiem,
      monthFields: (c) => ({ pay: c.driverPay, perDiem: c.perDiem }),
    });
  }

  /**
   * Порівняння авто за набір рейсів: що заробило кожне авто.
   * Ключ — id авто, або назва (якщо авто видалено з довідника).
   */
  function carStats(trips, rates) {
    const map = new Map();
    for (const t of trips || []) {
      const key = t.carId ? String(t.carId) : t.carName ? 'n:' + ownerKey(t.carName) : '';
      if (!key) continue;
      const c = calcTrip(t, rates);
      if (!map.has(key)) map.set(key, { key, carId: t.carId || '', carName: t.carName || '', managed: false, count: 0, km: 0, days: 0, fuelLiters: 0, freight: 0, fuelCost: 0, repair: 0, sto: 0, driverPay: 0, netProfit: 0, ownerProfit: 0, carOwnerShare: 0 });
      const a = map.get(key);
      a.count++;
      if (c.managed) a.managed = true;
      for (const k of ['km', 'days', 'fuelLiters', 'freight', 'fuelCost', 'repair', 'sto', 'driverPay', 'netProfit', 'ownerProfit', 'carOwnerShare']) a[k] += c[k];
    }
    const out = Array.from(map.values());
    for (const a of out) {
      for (const k of Object.keys(a)) if (typeof a[k] === 'number' && k !== 'count') a[k] = round2(a[k]);
      a.pricePerKm = a.km > 0 ? round2(a.freight / a.km) : 0;
      a.profitPerKm = a.km > 0 ? round2(a.netProfit / a.km) : 0;
      a.fuelPer100 = a.km > 0 ? round2((a.fuelLiters / a.km) * 100) : 0;
      a.repairPerKm = a.km > 0 ? round2(a.repair / a.km) : 0;
      a.margin = a.freight > 0 ? round2((a.netProfit / a.freight) * 100) : 0;
    }
    return out.sort((a, b) => b.netProfit - a.netProfit);
  }

  /** Поточний пробіг авто: найбільший кінцевий одометр у його рейсах (або вписаний вручну, якщо більший). */
  function carOdometer(car, trips) {
    let max = num(car && car.odoManual);
    for (const t of trips || []) if (t.carId === car.id) max = Math.max(max, num(t.odoEnd));
    return max;
  }

  /** Скільки днів до дати (від today, обидві «РРРР-ММ-ДД»). */
  function daysUntil(date, today) {
    const a = Date.parse(String(today) + 'T00:00:00Z');
    const b = Date.parse(String(date) + 'T00:00:00Z');
    if (Number.isNaN(a) || Number.isNaN(b)) return null;
    return Math.round((b - a) / 86400000);
  }

  const DOCS = [
    { field: 'insuranceUntil', type: 'insurance', label: 'Страховка' },
    { field: 'inspectionUntil', type: 'inspection', label: 'Техогляд' },
    { field: 'tachoUntil', type: 'tacho', label: 'Тахограф' },
  ];

  /**
   * Нагадування по авто: ТО за пробігом, страховка / техогляд / тахограф за датою.
   * level: 'overdue' — прострочено, 'soon' — скоро (≤ 30 днів або ≤ max(1000 км, 10% інтервалу)).
   */
  function carReminders(cars, trips, today) {
    const out = [];
    for (const car of cars || []) {
      const every = num(car.serviceEveryKm);
      const lastStr = car.serviceLastOdo;
      if (every > 0 && lastStr !== undefined && lastStr !== '' && lastStr !== null) {
        const odo = carOdometer(car, trips);
        const next = num(lastStr) + every;
        const left = round2(next - odo);
        const warn = Math.max(1000, every * 0.1);
        if (left <= warn) out.push({ carId: car.id, plate: car.plate || '', type: 'service', label: 'ТО', level: left < 0 ? 'overdue' : 'soon', km: left, next, odo });
      }
      for (const d of DOCS) {
        if (!car[d.field]) continue;
        const days = daysUntil(car[d.field], today);
        if (days === null) continue;
        if (days <= 30) out.push({ carId: car.id, plate: car.plate || '', type: d.type, label: d.label, level: days < 0 ? 'overdue' : 'soon', days, date: car[d.field] });
      }
    }
    // Спершу прострочені, потім найближчі
    const urgency = (x) => (x.level === 'overdue' ? -1e9 : 0) + (x.type === 'service' ? x.km / 50 : x.days);
    return out.sort((a, b) => urgency(a) - urgency(b));
  }

  /** Записи витрат бізнесу за період (рік / місяць як у фільтрі: 'all' або '2026' / '03'). */
  function expensesInPeriod(expenses, year, month) {
    return (expenses || []).filter((e) => {
      const m = monthOf(e.date);
      if (!m) return false;
      const [y, mm] = m.split('-');
      return (year === 'all' || !year || y === year) && (month === 'all' || !month || mm === month);
    });
  }

  const api = {
    DEFAULTS, num, daysBetween, calcTrip, summarize, ownerKey, monthOf,
    ledger, ownerLedger, partnerLedger, driverLedger, payoutKind, payoutParty, driverKeyOf,
    carStats, carOdometer, carReminders, daysUntil, expensesInPeriod,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Calc = api;
})(typeof window !== 'undefined' ? window : globalThis);
