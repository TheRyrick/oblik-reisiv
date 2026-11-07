/*
 * Автотести розрахунків (js/calc.js). Запуск: npm test
 * Працюють на вбудованому в Node тест-раннері — без додаткових пакетів.
 * Netlify запускає їх перед кожною викладкою: якщо хоч один тест падає — сайт не оновлюється.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/calc.js');

// Типовий рейс: фрахт 60 000, 2 доби, 1000 км
const base = Object.freeze({
  startDate: '2026-10-01', endDate: '2026-10-03', odoStart: 0, odoEnd: 1000,
  fuelLiters: 300, fuelPrice: 55, fuelPriceActual: 53,
  cash: 10000, bank: 50000, card: 0, dispatch: 0,
  repairExpenses: 2000, otherExpenses: 500,
  perDiem: 200, stoRate: 330, taxRate: 8, driverRate: 25, partnerRate: 25, logistRate: 10,
});
const trip = (extra) => Object.assign({}, base, extra || {});
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.011, `${msg || ''} очікували ${b}, отримали ${a}`);

/** Усі частини фрахту разом мають дорівнювати фрахту — жодна гривня не губиться. */
function sumOfParts(c) {
  return c.fuelCost + c.perDiem + c.other + c.driverPay + c.logistPay + c.tax + c.sto + c.repair + c.netProfit + c.carOwnerShare;
}

test('базові дрібниці: числа, доби', () => {
  assert.equal(C.num('1 234,5'), 1234.5);
  assert.equal(C.num(''), 0);
  assert.equal(C.num('abc'), 0);
  assert.equal(C.daysBetween('2026-05-01', '2026-05-03'), 2);
  assert.equal(C.daysBetween('2026-05-01', '2026-05-01'), 1);
  assert.equal(C.daysBetween('2026-05-03', '2026-05-01'), 0);
});

test('своє авто: повний розрахунок рейсу', () => {
  const c = C.calcTrip(trip());
  assert.equal(c.freight, 60000);
  assert.equal(c.days, 2);
  assert.equal(c.km, 1000);
  assert.equal(c.fuelCostDriver, 16500);
  assert.equal(c.fuelCost, 15900);
  assert.equal(c.fuelDiscount, 600);
  assert.equal(c.tax, 4000);           // 8% від безналу 50 000
  assert.equal(c.sto, 660);
  assert.equal(c.perDiem, 400);
  assert.equal(c.carProfit, 42600);    // 60000 − 16500 − 400 − 500 (ремонт НЕ віднімається)
  assert.equal(c.driverPay, 10650);    // 25% від прибутку авто
  assert.equal(c.logistPay, 6000);     // 10% від фрахту
  assert.equal(c.netProfit, 19890);
  near(c.partnerShare, 4972.5);
  near(c.ownerProfit, 14917.5);
  assert.equal(c.carOwnerShare, 0);
  near(sumOfParts(c), c.freight, 'сума частин');
});

test('ремонт не впливає на ЗП водія, лише на прибуток', () => {
  const a = C.calcTrip(trip({ repairExpenses: 0 }));
  const b = C.calcTrip(trip({ repairExpenses: 5000 }));
  assert.equal(a.driverPay, b.driverPay);
  assert.equal(a.netProfit - b.netProfit, 5000);
});

test('диспетчерські віднімаються від фрахту', () => {
  const c = C.calcTrip(trip({ dispatch: 1000 }));
  assert.equal(c.received, 60000);
  assert.equal(c.freight, 59000);
});

test('збитковий рейс: ЗП водія і частка компаньйона — 0', () => {
  const c = C.calcTrip(trip({ cash: 0, bank: 5000 }));
  assert.ok(c.carProfit < 0);
  assert.equal(c.driverPay, 0);
  assert.equal(c.partnerShare, 0);
  assert.ok(c.ownerProfit < 0);
});

test('авто під управлінням: усе після витрат ділиться 30/70', () => {
  const own = C.calcTrip(trip());
  const m = C.calcTrip(trip({ managed: true, mgmtShare: 30, ownerName: 'Іван' }));
  assert.equal(m.driverPay, own.driverPay, 'ЗП водія та сама');
  assert.equal(m.pool, own.netProfit, 'до розподілу = чистий прибуток як у свого авто');
  near(m.netProfit, 5967);             // 30%
  near(m.carOwnerShare, 13923);        // 70%
  near(m.partnerShare, 1491.75);       // 25% від ваших 30%
  near(m.ownerProfit, 4475.25);
  near(sumOfParts(m), m.freight, 'сума частин');
});

test('авто під управлінням: ремонт ділиться за частками', () => {
  const a = C.calcTrip(trip({ managed: true, mgmtShare: 30, repairExpenses: 0 }));
  const b = C.calcTrip(trip({ managed: true, mgmtShare: 30, repairExpenses: 10000 }));
  near(a.netProfit - b.netProfit, 3000);
  near(a.carOwnerShare - b.carOwnerShare, 7000);
  assert.equal(a.driverPay, b.driverPay);
});

test('авто під управлінням: збиток ділиться так само', () => {
  const m = C.calcTrip(trip({ managed: true, mgmtShare: 30, cash: 0, bank: 20000 }));
  assert.ok(m.pool < 0);
  near(m.netProfit, m.pool * 0.3);
  near(m.carOwnerShare, m.pool * 0.7);
  assert.equal(m.partnerShare, 0);
});

test('частка поза межами 0–100 обрізається; порожня — з налаштувань', () => {
  assert.equal(C.calcTrip(trip({ managed: true, mgmtShare: 150 })).mgmtShare, 100);
  assert.equal(C.calcTrip(trip({ managed: true, mgmtShare: -5 })).mgmtShare, 0);
  assert.equal(C.calcTrip(trip({ managed: true, mgmtShare: '' }), { mgmtShare: 40 }).mgmtShare, 40);
});

test('підсумок: свої + керовані, щомісячні та витрати бізнесу', () => {
  const trips = [trip(), trip({ managed: true, mgmtShare: 30, ownerName: 'Іван', startDate: '2026-11-02', endDate: '2026-11-03' })];
  const s = C.summarize(trips, { monthlyExpenses: 1000 }, { expenses: [
    { date: '2026-10-05', category: 'Бухгалтер', amount: 3000 },
    { date: '2026-10-07', category: 'Телефон', amount: 500 },
    { date: '2026-11-07', category: 'Бухгалтер', amount: 3000 },
  ] });
  assert.equal(s.count, 2);
  assert.equal(s.ownCount, 1);
  assert.equal(s.mgmtCount, 1);
  assert.equal(s.months, 2);
  assert.equal(s.monthlyFlat, 2000);
  assert.equal(s.bizEntries, 6500);
  assert.equal(s.monthlyExpenses, 8500);
  assert.deepEqual(s.bizByCat.map((x) => x.category), ['Бухгалтер', 'Телефон']);
  const before = trips.map((t) => C.calcTrip(t)).reduce((a, c) => a + c.netProfit, 0);
  near(s.netProfit, before - 8500);
  // Витрати бізнесу не зменшують частку компаньйона
  const partner = trips.map((t) => C.calcTrip(t)).reduce((a, c) => a + c.partnerShare, 0);
  near(s.partnerShare, partner);
  near(s.ownerProfit, s.netProfit - s.partnerShare);
  // Чистий прибуток розкладається на свої + керовані − витрати бізнесу
  near(s.netProfit, s.ownNet + s.mgmtNet - s.monthlyExpenses);
});

test('витрати за період: фільтр рік/місяць і захист від сміття в датах', () => {
  const ex = [
    { date: '2026-10-05', amount: 1 }, { date: '2026-11-05', amount: 2 },
    { date: '2025-10-05', amount: 4 }, { date: '<img>', amount: 8 }, { amount: 16 },
  ];
  assert.equal(C.expensesInPeriod(ex, 'all', 'all').length, 3);
  assert.equal(C.expensesInPeriod(ex, '2026', 'all').length, 2);
  assert.equal(C.expensesInPeriod(ex, 'all', '10').length, 2);
  assert.equal(C.expensesInPeriod(ex, '2026', '11')[0].amount, 2);
});

test('власники авто: нараховано, виплати, борг, «після розрахунку»', () => {
  const trips = [
    trip({ managed: true, mgmtShare: 30, ownerName: ' Іван  Петренко ' }),
    trip({ managed: true, mgmtShare: 30, ownerName: 'іван петренко', startDate: '2026-11-02', endDate: '2026-11-03' }),
    trip(), // своє авто — не враховується
  ];
  const payouts = [
    { id: 'a', owner: 'ІВАН ПЕТРЕНКО', date: '2026-10-31', amount: 10000 },   // старий запис без kind = власник
    { id: 'b', kind: 'partner', date: '2026-10-31', amount: 999 },          // інший вид — не враховується
  ];
  const L = C.ownerLedger(trips, payouts);
  assert.equal(L.length, 1);
  const o = L[0];
  assert.equal(o.trips.length, 2);
  const one = C.calcTrip(trips[0]).carOwnerShare;
  const two = C.calcTrip(trips[1]).carOwnerShare;
  near(o.accrued, one + two);
  assert.equal(o.paid, 10000);
  near(o.balance, one + two - 10000);
  assert.equal(o.last.id, 'a');
  assert.equal(o.sinceCount, 1);
  near(o.sinceLast, two);
  assert.deepEqual(o.months.map((r) => r.month), ['2026-11', '2026-10']);
  near(o.months[1].carOwnerShare, one);
});

test('компаньйон: його % з кожного рейсу, повернення від нього', () => {
  const trips = [trip(), trip({ managed: true, mgmtShare: 30 })];
  const L = C.partnerLedger(trips, [
    { id: 'p1', kind: 'partner', date: '2026-10-10', amount: 5000 },
    { id: 'p2', kind: 'partner', date: '2026-10-12', amount: -1000 }, // повернув
  ]);
  assert.equal(L.length, 1);
  const p = L[0];
  assert.equal(p.key, 'partner');
  near(p.accrued, 4972.5 + 1491.75);
  assert.equal(p.paid, 4000);
  near(p.balance, 4972.5 + 1491.75 - 4000);
});

test('водії: ЗП + добові, окремо по кожному водію', () => {
  const trips = [
    trip({ driverId: 'd1', driverName: 'Коваленко Олег' }),
    trip({ driverId: 'd1', driverName: 'Коваленко Олег', startDate: '2026-11-01', endDate: '2026-11-02' }),
    trip({ driverId: 'd2', driverName: 'Шевчук Андрій' }),
    trip({ driverName: 'Видалений Водій' }), // без id — за імʼям
  ];
  const L = C.driverLedger(trips, [{ id: 'x', kind: 'driver', party: 'd1', name: 'Коваленко Олег', date: '2026-10-20', amount: 11050 }]);
  assert.equal(L.length, 3);
  const d1 = L.find((d) => d.key === 'd1');
  const c1 = C.calcTrip(trips[0]);
  const c2 = C.calcTrip(trips[1]);
  near(d1.accrued, c1.driverPay + c1.perDiem + c2.driverPay + c2.perDiem);
  assert.equal(d1.paid, 11050);
  near(d1.months.find((r) => r.month === '2026-10').pay, c1.driverPay);
  near(d1.months.find((r) => r.month === '2026-10').perDiem, c1.perDiem);
  assert.ok(L.some((d) => d.key === 'n:видалений водій'));
});

test('порівняння авто: сортування за прибутком, показники на км', () => {
  const trips = [
    trip({ carId: 'a', carName: 'AA1111AA' }),
    trip({ carId: 'a', carName: 'AA1111AA', repairExpenses: 20000 }),
    trip({ carId: 'b', carName: 'BB2222BB', cash: 30000 }),
  ];
  const S = C.carStats(trips);
  assert.deepEqual(S.map((x) => x.carId), ['b', 'a']);
  const a = S.find((x) => x.carId === 'a');
  assert.equal(a.count, 2);
  assert.equal(a.km, 2000);
  assert.equal(a.repair, 22000);
  assert.equal(a.repairPerKm, 11);
  assert.equal(a.fuelPer100, 30);
  near(a.profitPerKm, a.netProfit / 2000);
});

test('нагадування: ТО за пробігом і документи за датою', () => {
  const cars = [
    { id: 'a', plate: 'AA1111AA', serviceEveryKm: 15000, serviceLastOdo: 100000, insuranceUntil: '2026-11-20', tachoUntil: '2027-06-01' },
    { id: 'b', plate: 'BB2222BB', serviceEveryKm: 15000, serviceLastOdo: 100000, inspectionUntil: '2026-11-01' },
    { id: 'c', plate: 'CC3333CC', serviceEveryKm: 15000, serviceLastOdo: '' }, // ТО не налаштоване
  ];
  const trips = [
    { carId: 'a', odoEnd: 114200 }, // до ТО 800 км → скоро
    { carId: 'b', odoEnd: 116000 }, // перепробіг 1000 км → прострочено
    { carId: 'c', odoEnd: 999999 },
  ];
  const R = C.carReminders(cars, trips, '2026-11-06');
  const by = (car, type) => R.find((r) => r.carId === car && r.type === type);
  assert.equal(by('a', 'service').km, 800);
  assert.equal(by('a', 'service').level, 'soon');
  assert.equal(by('b', 'service').level, 'overdue');
  assert.equal(by('b', 'service').km, -1000);
  assert.equal(by('a', 'insurance').days, 14);
  assert.equal(by('b', 'inspection').level, 'overdue');
  assert.equal(by('a', 'tacho'), undefined, 'далеко — без нагадування');
  assert.equal(R.filter((r) => r.carId === 'c').length, 0);
  assert.equal(R[0].level, 'overdue', 'прострочені — першими');
  assert.equal(C.carOdometer({ id: 'a', odoManual: 200000 }, trips), 200000);
});

test('нагадування про ТО: з 2 500 км до ТО', () => {
  const car = (id) => ({ id, plate: id, serviceEveryKm: 15000, serviceLastOdo: 100000 });
  const R = C.carReminders([car('a'), car('b'), car('c')], [
    { carId: 'a', odoEnd: 112400 }, // до ТО 2600 км — ще рано
    { carId: 'b', odoEnd: 112500 }, // рівно 2500 км — нагадуємо
    { carId: 'c', odoEnd: 112600 }, // 2400 км — нагадуємо
  ], '2026-11-06');
  assert.deepEqual(R.map((r) => r.carId).sort(), ['b', 'c']);
  assert.equal(R.find((r) => r.carId === 'b').km, 2500);
});

test('захист: сміття в даних не ламає розрахунок', () => {
  const c = C.calcTrip({ startDate: '<img src=x>', cash: 'abc', bank: null, managed: 'yes', mgmtShare: 'xx' });
  assert.equal(c.freight, 0);
  assert.equal(Number.isFinite(c.netProfit), true);
  const L = C.ownerLedger([{ managed: true, ownerName: '' }], [{ owner: '', amount: 5 }, null].filter(Boolean));
  assert.equal(L.length, 0);
});

test('борги замовників: лише «чекаємо», прострочка, групування', () => {
  const T = [
    trip({ id: '1', customer: 'ТОВ Альфа', payStatus: 'waiting', payDue: '2026-11-01' }), // прострочено 5 дн
    trip({ id: '2', customer: ' тов  альфа ', payStatus: 'waiting', payDue: '2026-11-20' }), // та сама фірма
    trip({ id: '3', customer: 'Бета', payStatus: 'waiting', startDate: '2026-11-01', endDate: '2026-11-02' }), // без строку, чекаємо 4 дні
    trip({ id: '4', customer: 'Бета', payStatus: 'paid' }),
    trip({ id: '5', customer: 'Бета' }),                                                    // старий рейс — оплачений
  ];
  const D = C.customerDebts(T, {}, '2026-11-06');
  assert.equal(D.count, 3);
  assert.equal(D.total, 180000);
  assert.equal(D.overdue, 60000);
  assert.equal(D.overdueCount, 1);
  assert.equal(D.customers.length, 2);
  const a = D.customers[0];
  assert.equal(a.key, 'тов альфа');
  assert.equal(a.items.length, 2);
  assert.equal(a.items[0].daysLeft, -5);
  assert.equal(a.items[0].isOverdue, true);
  assert.equal(D.customers[1].items[0].daysLeft, null);
});

test('прогноз місяця: темп і скільки треба для покриття витрат', () => {
  const t = trip({ startDate: '2026-11-02', endDate: '2026-11-04' });
  const c = C.calcTrip(t);
  const F = C.monthForecast([t, trip({ startDate: '2026-10-05', endDate: '2026-10-06' })], { monthlyExpenses: 10000 },
    [{ id: 'e', date: '2026-11-03', amount: 1e6 }, { id: 'f', date: '2026-10-03', amount: 999 }], '2026-11-10');
  assert.equal(F.month, '2026-11');
  assert.equal(F.daysInMonth, 30);
  assert.equal(F.count, 1);
  near(F.owner, c.ownerProfit);
  assert.equal(F.bizExpenses, 1010000);
  near(F.projOwner, c.ownerProfit * 3);
  near(F.needMore, 1010000 - c.ownerProfit);
  assert.equal(F.covered, false);
  assert.ok(F.freightNeeded > F.needMore, 'фрахту треба більше, ніж прибутку');
  assert.equal(F.prevMonth, '2026-10');
  assert.equal(F.prevCount, 1);
  // Без витрат — покрито, догоняти нічого
  const G = C.monthForecast([t], {}, [], '2026-11-30');
  assert.equal(G.covered, true);
  assert.equal(G.needMore, 0);
  near(G.projOwner, c.ownerProfit);
  assert.equal(C.monthForecast([], {}, [], '2026-01-15').prevMonth, '2025-12');
});

test('календар авто: рейс, ремонт, простій, майбутнє', () => {
  const cars = [{ id: 'a', plate: 'AA1111AA' }, { id: 'b', plate: 'BB2222BB' }];
  const T = [{ id: 't', carId: 'a', startDate: '2026-10-30', endDate: '2026-11-03', route: 'Київ' }];
  const B = [{ id: 'r', carId: 'a', from: '2026-11-03', to: '2026-11-05' }, { id: 'x', carId: 'b', from: 'bad', to: '2026-11-05' }];
  const K = C.carCalendar(cars, T, B, '2026-11', '2026-11-06');
  assert.equal(K.daysInMonth, 30);
  const a = K.rows[0];
  assert.equal(a.days[0].state, 'trip');
  assert.equal(a.days[2].state, 'trip', 'рейс важливіший за ремонт');
  assert.equal(a.days[3].state, 'repair');
  assert.equal(a.days[5].state, 'idle');
  assert.equal(a.days[6].state, 'future');
  assert.equal(a.tripDays, 3);
  assert.equal(a.repairDays, 2);
  assert.equal(a.idleDays, 1);
  assert.equal(K.rows[1].idleDays, 6, 'зіпсований запис ремонту ігнорується');
  assert.equal(C.daysInMonth('2028-02'), 29);
});

test('документи: ліцензія і дозвіл у нагадуваннях', () => {
  const R = C.carReminders([{ id: 'a', plate: 'A', licenseUntil: '2026-11-10', permitUntil: '2026-10-01' }], [], '2026-11-06');
  assert.equal(R.length, 2);
  assert.equal(R[0].type, 'permit');
  assert.equal(R[0].level, 'overdue');
  assert.equal(R[1].label, 'Ліцензія');
});

test('щоденне нагадування для Telegram', () => {
  const data = {
    cars: [{ id: 'a', plate: 'AA1111AA', insuranceUntil: '2026-11-08' }],
    trips: [trip({ customer: 'Альфа', payStatus: 'waiting', payDue: '2026-11-01', route: 'Київ → Львів' }), trip({ customer: 'Бета', payStatus: 'waiting', payDue: '2026-12-01' })],
    settings: {},
  };
  const txt = C.dailyDigest(data, '2026-11-06');
  assert.match(txt, /AA1111AA — Страховка: ще 2 дн\. \(до 08\.11\.2026\)/);
  assert.match(txt, /Альфа — 60 000 ₴, прострочено 5 дн\./);
  assert.doesNotMatch(txt, /Бета/, 'не прострочений борг не турбує');
  assert.equal(C.dailyDigest({ cars: [], trips: [] }, '2026-11-06'), '');
  assert.match(C.dailyDigest({}, '2026-11-06', { always: true }), /Усе гаразд/);
});

test('борги по рядках оплат: лише не отримані, без замовника — за рейсом, «чекаємо» понад 14 днів', () => {
  const pays = [
    { id: 'a', amount: 7000, method: 'card', received: true },
    { id: 'b', amount: 6000, method: 'bank', note: 'в день выгрузки', received: false },
    { id: 'c', amount: 1000, method: 'bank', note: 'по оригиналам', order: 3, received: false },
    { id: 'x', amount: 500, method: 'evil', received: false },
  ];
  const T = [
    trip({ id: 'r1', payments: pays, payStatus: 'waiting', startDate: '2026-10-01', endDate: '2026-10-05' }), // без замовника, 32 дні
    trip({ id: 'r2', customer: 'Гама', payments: [{ id: 'd', amount: 3000, method: 'cash', received: false }], endDate: '2026-11-05', startDate: '2026-11-04' }),
    trip({ id: 'r3', customer: 'Гама', payments: [{ id: 'e', amount: 3000, method: 'cash', received: true }], payStatus: 'waiting' }),
  ];
  assert.equal(C.tripPayments(T[0]).length, 3, 'зіпсований рядок відкинуто');
  const D = C.customerDebts(T, {}, '2026-11-06');
  assert.equal(D.count, 3);
  assert.equal(D.total, 10000);
  assert.equal(D.overdue, 7000, 'рейс r1 чекає 32 дні — прострочено');
  const r1 = D.customers.find((g) => g.tripId === 'r1');
  assert.equal(r1.name, '');
  assert.equal(r1.items.length, 2);
  assert.equal(r1.items[0].isLate, true);
  assert.equal(r1.items[0].waitingDays, 32);
  assert.equal(D.customers.find((g) => g.key === 'гама').total, 3000, 'усі рядки отримано — рейс r3 не борг, хоч payStatus і «waiting»');
  const txt = C.dailyDigest({ trips: T }, '2026-11-06');
  assert.match(txt, /рейс 01\.10\.2026 — 1 000 ₴ \(№3, безнал, по оригиналам\), чекаємо 32 дн\./);
  assert.doesNotMatch(txt, /Гама/, 'свіжий борг не турбує');
});
