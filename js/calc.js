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

  /**
   * Сумарні показники за набір рейсів.
   * Щомісячні витрати (rates.monthlyExpenses, грн) віднімаються від чистого прибутку бізнесу
   * один раз за кожен місяць, у якому є рейси (за датою початку рейсу).
   */
  function summarize(trips, rates) {
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
      const m = (t.startDate || '').slice(0, 7);
      if (m) months.add(m);
    }
    // Щомісячні витрати бізнесу — зменшують чистий прибуток бізнесу та ваш прибуток,
    // але НЕ впливають на частку компаньйона (вона рахується з прибутку до щомісячних витрат)
    s.months = months.size;
    s.monthlyRate = num(r.monthlyExpenses);
    s.monthlyExpenses = s.months * s.monthlyRate;
    s.netProfit -= s.monthlyExpenses;
    s.ownerProfit = s.netProfit - s.partnerShare;
    for (const k of Object.keys(s)) s[k] = round2(s[k]);
    s.pricePerKm = s.km > 0 ? round2(s.freight / s.km) : 0;
    s.fuelPer100 = s.km > 0 ? round2((s.fuelLiters / s.km) * 100) : 0;
    s.totalExpenses = round2(s.fuelCost + s.tax + s.perDiem + s.sto + s.other + s.repair + s.driverPay + s.logistPay + s.monthlyExpenses);
    return s;
  }

  /** Ключ власника авто: імʼя без зайвих пробілів і без різниці великих/малих літер. */
  function ownerKey(name) {
    return String(name || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('uk');
  }

  /**
   * Розрахунки з власниками авто під управлінням.
   * Нараховано — сума «Власнику авто» по всіх його рейсах; виплати вносяться вручну, коли розраховуєтесь.
   * payout.amount > 0 — ви виплатили власнику; < 0 — власник повернув вам.
   * Повертає масив { key, name, trips[], payouts[], accrued, paid, balance, months[] }.
   * balance > 0 — ви винні власнику; < 0 — власник винен вам.
   */
  function ownerLedger(trips, payouts, rates) {
    const map = new Map();
    const get = (name) => {
      const key = ownerKey(name);
      if (!key) return null;
      if (!map.has(key)) map.set(key, { key, name: String(name).trim().replace(/\s+/g, ' '), trips: [], payouts: [], accrued: 0, paid: 0, balance: 0, months: [] });
      return map.get(key);
    };
    const monthsMap = new Map();
    for (const t of trips || []) {
      if (!t.managed) continue;
      const o = get(t.ownerName);
      if (!o) continue;
      const c = calcTrip(t, rates);
      o.trips.push({ t, c });
      o.accrued += c.carOwnerShare;
      const m = (t.startDate || '').slice(0, 7);
      const mk = o.key + '|' + m;
      if (!monthsMap.has(mk)) {
        const row = { month: m, count: 0, freight: 0, pool: 0, my: 0, carOwnerShare: 0 };
        monthsMap.set(mk, row);
        o.months.push(row);
      }
      const row = monthsMap.get(mk);
      row.count++; row.freight += c.freight; row.pool += c.pool; row.my += c.netProfit;
      row.carOwnerShare += c.carOwnerShare;
    }
    for (const p of payouts || []) {
      const o = get(p.owner);
      if (!o) continue;
      o.payouts.push(p);
      o.paid += num(p.amount);
    }
    const out = Array.from(map.values());
    for (const o of out) {
      o.accrued = round2(o.accrued);
      o.paid = round2(o.paid);
      o.balance = round2(o.accrued - o.paid);
      o.months.sort((a, b) => b.month.localeCompare(a.month));
      for (const r of o.months) for (const k of ['freight', 'pool', 'my', 'carOwnerShare']) r[k] = round2(r[k]);
      o.payouts.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
      o.trips.sort((a, b) => (b.t.startDate || '').localeCompare(a.t.startDate || ''));
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'uk'));
  }

  const api = { DEFAULTS, num, daysBetween, calcTrip, summarize, ownerKey, ownerLedger };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Calc = api;
})(typeof window !== 'undefined' ? window : globalThis);
