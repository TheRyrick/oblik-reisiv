/*
 * Тестовий «вхід» для браузерних автотестів: підміняє js/auth.js.
 * Дані — лише в памʼяті вкладки (справжня база Supabase не використовується).
 */
(function () {
  'use strict';
  const t = (id, extra) => Object.assign({
    id, driverId: 'd1', driverName: 'Коваленко Олег', carId: 'c1', carName: 'AA1234BB · MAN TGX',
    startDate: '2026-10-01', endDate: '2026-10-03', route: 'Київ → Львів',
    odoStart: 100000, odoEnd: 101000, fuelLiters: 300, fuelPrice: 55, fuelPriceActual: 53,
    cash: 10000, bank: 50000, card: 0, repairExpenses: 2000, otherExpenses: 500,
    perDiem: 200, stoRate: 330, taxRate: 8, driverRate: 25, partnerRate: 25, logistRate: 10, createdAt: 1,
  }, extra || {});
  const data = {
    drivers: [{ id: 'd1', lastName: 'Коваленко', firstName: 'Олег' }, { id: 'd2', lastName: 'Шевчук', firstName: 'Андрій' }],
    cars: [
      { id: 'c1', plate: 'AA1234BB', brand: 'MAN TGX', serviceEveryKm: 15000, serviceLastOdo: 87000, insuranceUntil: '2020-01-01' },
      { id: 'c2', plate: 'BC7777AK', brand: 'Renault Master', managed: true, ownerName: 'Петренко Іван', mgmtShare: 30 },
    ],
    trips: [
      t('t1'),
      t('t2', { carId: 'c2', carName: 'BC7777AK · Renault Master', driverId: 'd2', driverName: 'Шевчук Андрій', startDate: '2026-10-05', endDate: '2026-10-07', managed: true, ownerName: 'Петренко Іван', mgmtShare: 30, odoStart: 50000, odoEnd: 51000 }),
      t('t3', { carId: 'c2', carName: 'BC7777AK · Renault Master', driverId: 'd2', driverName: 'Шевчук Андрій', startDate: '2026-11-02', endDate: '2026-11-03', managed: true, ownerName: 'Петренко Іван', mgmtShare: 30, odoStart: 51000, odoEnd: 52000, note: '<img src=x onerror="window.__xss=1">' }),
    ],
    settings: {
      payouts: [
        { id: 'p1', owner: 'Петренко Іван', date: '2026-10-31', amount: 10000, note: 'за жовтень', createdAt: 1 },
        { id: 'p2', kind: 'partner', party: 'partner', name: 'Компаньйон', date: '2026-10-31', amount: 3000, createdAt: 2 },
      ],
      expenses: [
        { id: 'e1', date: '2026-10-10', category: 'Бухгалтер', amount: 3000, createdAt: 1 },
        { id: 'e2', date: '2026-11-03', category: 'Телефон і звʼязок', amount: 400, createdAt: 2 },
      ],
    },
  };
  const cache = JSON.parse(JSON.stringify(window.__E2E_DATA || data));
  window.__saved = [];
  window.Cloud = {
    get: (k, f) => (k in cache ? JSON.parse(JSON.stringify(cache[k])) : f),
    set: (k, v) => { cache[k] = JSON.parse(JSON.stringify(v)); window.__saved.push(k); },
    has: (k) => k in cache, flush: async () => {}, token: async () => 'test', refresh: async () => {}, status: () => 'saved', on: () => {},
    _cache: cache,
  };
  // Діалоги підтвердження в тестах — завжди «ОК»
  window.confirm = () => true;
  const load = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.body.appendChild(s); });
  document.documentElement.classList.remove('auth-locked');
  // Привітання навчалки не заважає іншим перевіркам (окремо тестується через Guide.welcome)
  try { localStorage.setItem('oblik.guide.v1', 'seen'); } catch (e) { /* без сховища */ }
  (async () => { for (const s of ['js/calc.js', 'js/brands.js', 'js/report.js', 'js/app.js', 'js/fx.js', 'js/guide.js']) await load(s); window.__ready = true; })();
})();
