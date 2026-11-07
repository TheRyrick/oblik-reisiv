/*
 * Тестові дані для відео-навчалки (tools/video-capture.js підставляє їх замість бази).
 * Вигадані водії, авто, замовники й суми — щоб у кадрі були і аналітика, і борги, і календар.
 */
(function () {
  'use strict';
  const D = { d1: 'Коваленко Олег', d2: 'Шевчук Андрій', d3: 'Бондар Ігор' };
  const C = {
    c1: { name: 'AA1234BB · MAN TGX', km: 0.31 },
    c2: { name: 'BC7777AK · Renault Master', km: 0.12 },
    c3: { name: 'AE5555KC · DAF XF', km: 0.3 },
  };
  // маршрут, замовник, км, діб, сума, оплата, через скільки днів заплатили (null — ще чекаємо), авто, водій
  const R = [
    ['Дніпро → Одеса', 'ТОВ «Агро-Схід»', 470, 2, 32000, 'bank', 6, 'c1', 'd1'],
    ['Одеса → Київ', 'Нова Логістика', 480, 1, 28000, 'cash', 0, 'c3', 'd3'],
    ['Київ → Львів', 'ТОВ «Агро-Схід»', 540, 2, 30000, 'bank', 18, 'c1', 'd1'],
    ['Житомир → Рівне', 'Мілкіс', 190, 1, 11000, 'bank', 25, 'c2', 'd2'],
    ['Львів → Полтава', 'ФОП Іваненко', 860, 3, 34000, 'card', 0, 'c3', 'd3'],
    ['Полтава → Дніпро', 'Нова Логістика', 200, 1, 9000, 'cash', 0, 'c1', 'd1'],
    ['Київ → Вінниця', 'Мілкіс', 270, 1, 14000, 'bank', 27, 'c2', 'd2'],
    ['Одеса → Вінниця', 'ТОВ «Агро-Схід»', 420, 2, 31000, 'bank', 9, 'c3', 'd3'],
    ['Дніпро → Харків', 'Нова Логістика', 220, 1, 13000, 'cash', 0, 'c1', 'd1'],
    ['Харків → Полтава', 'ФОП Іваненко', 145, 2, 6000, 'cash', 0, 'c3', 'd3'],
    ['Полтава → Одеса', 'ТОВ «Агро-Схід»', 600, 2, 36000, 'bank', 12, 'c1', 'd1'],
    ['Вінниця → Київ', 'Мілкіс', 270, 1, 13500, 'bank', null, 'c2', 'd2'],
    ['Одеса → Івано-Франківськ', 'Мілкіс', 750, 3, 33000, 'bank', null, 'c3', 'd3'],
    ['Київ → Дніпро', 'ТОВ «Агро-Схід»', 480, 1, 27000, 'bank', null, 'c1', 'd1'],
  ];
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const day0 = Date.UTC(2026, 7, 18);
  const odo = { c1: 186000, c2: 51000, c3: 240000 };
  let day = day0;
  const trips = R.map(([route, customer, km, days, sum, method, wait, car, drv], i) => {
    const start = iso(day); day += days * 86400000; const end = iso(day); day += 86400000 * (i % 3 === 0 ? 4 : 3);
    const managed = car === 'c2';
    const t = {
      id: 'v' + i, driverId: drv, driverName: D[drv], carId: car, carName: C[car].name,
      startDate: start, endDate: end, route, customer, odoStart: odo[car], odoEnd: odo[car] + km,
      fuelLiters: Math.round(km * C[car].km), fuelPrice: 56, fuelPriceActual: 53.5,
      cash: 0, bank: 0, card: 0, repairExpenses: i === 4 ? 4000 : 0, otherExpenses: 300,
      perDiem: 200, stoRate: 330, taxRate: 8, driverRate: 25, partnerRate: 25, logistRate: 10, createdAt: i + 1,
    };
    if (managed) Object.assign(t, { managed: true, ownerName: 'Петренко Іван', mgmtShare: 30 });
    odo[car] += km + 40;
    t[method] = sum;
    const p = { id: 'p' + i, amount: sum, method };
    if (wait === null) Object.assign(p, { received: false, waited: true });
    else if (wait > 0) Object.assign(p, { received: true, waited: true, receivedDate: iso(Date.parse(end) + wait * 86400000) });
    else Object.assign(p, { received: true, receivedDate: end });
    t.payments = [p];
    t.payStatus = p.received ? 'paid' : 'waiting';
    if (!p.received) t.payDue = iso(Date.parse(end) + 10 * 86400000);
    return t;
  });
  window.__E2E_DATA = {
    drivers: [{ id: 'd1', lastName: 'Коваленко', firstName: 'Олег' }, { id: 'd2', lastName: 'Шевчук', firstName: 'Андрій' }, { id: 'd3', lastName: 'Бондар', firstName: 'Ігор' }],
    cars: [
      { id: 'c1', plate: 'AA1234BB', brand: 'MAN TGX', volume: 86, capacityKg: 20000, serviceEveryKm: 15000, serviceLastOdo: 174000, insuranceUntil: '2026-11-20' },
      { id: 'c2', plate: 'BC7777AK', brand: 'Renault Master', volume: 20, capacityKg: 1500, managed: true, ownerName: 'Петренко Іван', mgmtShare: 30 },
      { id: 'c3', plate: 'AE5555KC', brand: 'DAF XF', volume: 90, capacityKg: 22000, inspectionUntil: '2026-12-01' },
    ],
    trips,
    settings: {
      monthlyExpenses: 12000,
      payouts: [
        { id: 'o1', owner: 'Петренко Іван', date: '2026-10-31', amount: 2000, note: 'за жовтень', createdAt: 1 },
        { id: 'o2', kind: 'partner', party: 'partner', name: 'Компаньйон', date: '2026-10-31', amount: 15000, createdAt: 2 },
      ],
      expenses: [
        { id: 'e1', date: '2026-10-10', category: 'Бухгалтер', amount: 3000, createdAt: 1 },
        { id: 'e2', date: '2026-11-03', category: 'Телефон і звʼязок', amount: 400, createdAt: 2 },
      ],
    },
  };
})();
