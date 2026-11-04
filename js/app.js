/* Облік рейсів — основна логіка інтерфейсу */
(function () {
  'use strict';

  const { calcTrip, summarize, DEFAULTS, num } = window.Calc;

  const TRIPS_KEY = 'truck-ledger.trips.v1';
  const SETTINGS_KEY = 'truck-ledger.settings.v1';
  const MONTHS = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];
  const MONTHS_SHORT = ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру'];

  // ---------- Стан ----------
  const DRIVERS_KEY = 'truck-ledger.drivers.v1';
  const CARS_KEY = 'truck-ledger.cars.v1';

  let trips = loadJSON(TRIPS_KEY, []);
  let drivers = loadJSON(DRIVERS_KEY, []);
  let cars = loadJSON(CARS_KEY, []);
  let settings = Object.assign({}, DEFAULTS, loadJSON(SETTINGS_KEY, {}));
  let filter = { year: 'all', month: 'all', driver: 'all', car: 'all' };
  let query = '';
  let editingId = null;
  let formSource = null;
  let chart = null;

  // ---------- Утиліти ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function saveTrips() { localStorage.setItem(TRIPS_KEY, JSON.stringify(trips)); }
  function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
  function saveRefs() {
    localStorage.setItem(DRIVERS_KEY, JSON.stringify(drivers));
    localStorage.setItem(CARS_KEY, JSON.stringify(cars));
  }

  // ---------- Водії та авто ----------
  const driverLabel = (d) => `${d.lastName} ${d.firstName}`.trim();
  const carLabel = (c) => [c.plate, c.brand].filter(Boolean).join(' · ');
  const sortByLabel = (fn) => (a, b) => fn(a).localeCompare(fn(b), 'uk');

  /** Ім'я водія рейсу: з довідника, або збережене в рейсі (якщо водія вже видалено). */
  function tripDriver(t) {
    const d = t.driverId && drivers.find((x) => x.id === t.driverId);
    return d ? driverLabel(d) : t.driverName || '';
  }
  function tripCar(t) {
    const c = t.carId && cars.find((x) => x.id === t.carId);
    return c ? carLabel(c) : t.carName || '';
  }
  /** Держ. номер і марка авто рейсу окремо (для крупного відображення номера). */
  function tripPlate(t) {
    const c = t.carId && cars.find((x) => x.id === t.carId);
    if (c) return { plate: c.plate || '', brand: c.brand || '' };
    const [plate = '', ...rest] = (t.carName || '').split(' · ');
    return { plate, brand: rest.join(' · ') };
  }
  /** Заголовок рейсу: крупний держ. номер + марка; якщо авто не вказано — дати. */
  function tripHeading(t, cls = '') {
    const { plate, brand } = tripPlate(t);
    if (!plate) return `<div class="plate ${cls}">${fmtDate(t.startDate)} — ${fmtDate(t.endDate)}</div>`;
    return `<div class="plate ${cls}"><span>${escapeHtml(plate)}</span>${brand ? `<span class="plate-brand">${escapeHtml(brand)}</span>` : ''}</div>`;
  }
  const tripDates = (t) => `${fmtDate(t.startDate)} — ${fmtDate(t.endDate)}`;

  const fmtMoney = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 });
  const fmtDec = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtInt = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 });
  const fmtL = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 });

  const uah = (n) => fmtMoney.format(Math.round(n)) + ' ₴';
  const uah2 = (n) => fmtDec.format(n) + ' ₴';

  function fmtDate(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.${y}`;
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const profitClass = (n) => (n > 0 ? 'text-emerald-400' : n < 0 ? 'text-rose-400' : 'text-slate-300');

  function refreshIcons() { if (window.lucide) window.lucide.createIcons(); }

  function toast(msg, type = 'ok') {
    const icon = type === 'ok' ? 'check-circle-2' : type === 'err' ? 'alert-circle' : 'info';
    const color = type === 'ok' ? 'text-emerald-400' : type === 'err' ? 'text-rose-400' : 'text-sky-400';
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<i data-lucide="${icon}" class="h-4 w-4 ${color}"></i><span>${escapeHtml(msg)}</span>`;
    $('#toasts').appendChild(el);
    refreshIcons();
    setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; }, 2600);
    setTimeout(() => el.remove(), 3000);
  }

  // ---------- Фільтрація ----------
  function filteredTrips() {
    const q = query.trim().toLowerCase();
    return trips
      .filter((t) => {
        const [y, m] = (t.startDate || '').split('-');
        if (filter.year !== 'all' && y !== filter.year) return false;
        if (filter.month !== 'all' && m !== filter.month) return false;
        if (filter.driver !== 'all' && (t.driverId || '') !== filter.driver) return false;
        if (filter.car !== 'all' && (t.carId || '') !== filter.car) return false;
        if (q && !(`${t.route || ''} ${t.note || ''} ${tripDriver(t)} ${tripCar(t)}`.toLowerCase().includes(q))) return false;
        return true;
      })
      .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || '') || (b.createdAt || 0) - (a.createdAt || 0));
  }

  function renderFilters() {
    const years = Array.from(new Set(trips.map((t) => (t.startDate || '').slice(0, 4)).filter(Boolean))).sort().reverse();
    if (filter.year !== 'all' && !years.includes(filter.year)) filter.year = 'all';

    $('#yearFilter').innerHTML =
      `<option value="all">Усі роки</option>` +
      years.map((y) => `<option value="${y}" ${filter.year === y ? 'selected' : ''}>${y}</option>`).join('');

    $('#monthFilter').innerHTML =
      `<option value="all">Усі місяці</option>` +
      MONTHS.map((name, i) => {
        const v = String(i + 1).padStart(2, '0');
        return `<option value="${v}" ${filter.month === v ? 'selected' : ''}>${name}</option>`;
      }).join('');

    // Водії/авто: з довідника + ті, що лишилися у рейсах після видалення з довідника
    const refOptions = (list, labelFn, idKey, nameKey) => {
      const map = new Map(list.map((x) => [x.id, labelFn(x)]));
      for (const t of trips) if (t[idKey] && !map.has(t[idKey])) map.set(t[idKey], (t[nameKey] || '—') + ' (видалено)');
      return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'uk'));
    };
    const drv = refOptions(drivers, driverLabel, 'driverId', 'driverName');
    const crs = refOptions(cars, carLabel, 'carId', 'carName');
    if (filter.driver !== 'all' && !drv.some((o) => o.id === filter.driver)) filter.driver = 'all';
    if (filter.car !== 'all' && !crs.some((o) => o.id === filter.car)) filter.car = 'all';
    const opts = (list, cur) => list.map((o) => `<option value="${escapeHtml(o.id)}" ${cur === o.id ? 'selected' : ''}>${escapeHtml(o.name)}</option>`).join('');
    $('#driverFilter').innerHTML = `<option value="all">Усі водії</option>` + opts(drv, filter.driver);
    $('#carFilter').innerHTML = `<option value="all">Усі авто</option>` + opts(crs, filter.car);

    let label = 'Усі рейси';
    if (filter.year !== 'all' && filter.month !== 'all') label = `${MONTHS[+filter.month - 1]} ${filter.year}`;
    else if (filter.year !== 'all') label = `${filter.year} рік`;
    else if (filter.month !== 'all') label = `${MONTHS[+filter.month - 1]} (усі роки)`;
    const extra = [];
    if (filter.driver !== 'all') extra.push(drv.find((o) => o.id === filter.driver).name);
    if (filter.car !== 'all') extra.push(crs.find((o) => o.id === filter.car).name);
    $('#periodLabel').textContent = [label, ...extra].join(' · ');
  }

  // ---------- KPI ----------
  function renderKpis(s) {
    const main = [
      { label: '1. Чистий прибуток бізнесу', value: uah(s.netProfit), sub: s.freight > 0 ? `рентабельність ${fmtL.format((s.netProfit / s.freight) * 100)}%` + (s.monthlyExpenses ? ` · з урахуванням щомісячних ${uah(s.monthlyExpenses)}` : '') : '—', icon: 'trending-up', color: 'text-emerald-300 bg-emerald-500/15', glow: 'rgba(16,185,129,.22)', valueClass: profitClass(s.netProfit) },
      { label: '2. Компаньйону', value: uah(s.partnerShare), sub: (s.netProfit + s.monthlyExpenses) > 0 ? `${fmtL.format((s.partnerShare / (s.netProfit + s.monthlyExpenses)) * 100)}% від чистого прибутку` + (s.monthlyExpenses ? ' (без щомісячних)' : '') : 'від чистого прибутку бізнесу', icon: 'handshake', color: 'text-pink-300 bg-pink-500/15', glow: 'rgba(236,72,153,.2)' },
      { label: '3. Ваш прибуток', value: uah(s.ownerProfit), sub: s.monthlyExpenses ? 'після компаньйону та щомісячних витрат' : 'чистий прибуток бізнесу після компаньйону', icon: 'piggy-bank', color: 'text-lime-300 bg-lime-500/15', glow: 'rgba(132,204,22,.2)', valueClass: profitClass(s.ownerProfit) },
    ];
    const items = [
      { label: 'Сума фрахту', value: uah(s.freight), sub: `${s.count} ${plural(s.count, 'рейс', 'рейси', 'рейсів')}`, icon: 'wallet', color: 'text-indigo-300 bg-indigo-500/15', glow: 'rgba(99,102,241,.22)' },
      { label: 'ЗП водія', value: uah(s.driverPay), sub: `+ добові ${uah(s.perDiem)}`, icon: 'user-round', color: 'text-amber-300 bg-amber-500/15', glow: 'rgba(245,158,11,.2)' },
      { label: 'ЗП логіста', value: uah(s.logistPay), sub: (s.freight > 0 ? `${fmtL.format((s.logistPay / s.freight) * 100)}% від фрахту` : 'від суми фрахту') + ' · входить у чистий прибуток', icon: 'headset', color: 'text-fuchsia-300 bg-fuchsia-500/15', glow: 'rgba(217,70,239,.2)' },
      { label: 'Щомісячні витрати', value: uah(s.monthlyExpenses), sub: s.monthlyRate ? `${uah(s.monthlyRate)} × ${s.months} ${plural(s.months, 'місяць', 'місяці', 'місяців')}` : 'вкажіть суму в «Ставках»', icon: 'calendar-check', color: 'text-slate-300 bg-slate-500/15', glow: 'rgba(100,116,139,.2)' },
      { label: 'Ціна за 1 км', value: uah2(s.pricePerKm), sub: `${fmtInt.format(s.km)} км пробігу`, icon: 'route', color: 'text-sky-300 bg-sky-500/15', glow: 'rgba(14,165,233,.2)' },
      { label: 'Паливо (фактично)', value: uah(s.fuelCost), sub: `${fmtL.format(s.fuelLiters)} л · ${fmtL.format(s.fuelPer100)} л/100км · знижка ${uah(s.fuelDiscount)}`, icon: 'fuel', color: 'text-orange-300 bg-orange-500/15', glow: 'rgba(249,115,22,.2)' },
      { label: 'СТО', value: uah(s.sto), sub: `за ${fmtInt.format(s.days)} ${plural(s.days, 'доба', 'доби', 'діб')} у рейсах`, icon: 'hammer', color: 'text-yellow-300 bg-yellow-500/15', glow: 'rgba(234,179,8,.18)' },
      { label: 'Ремонт', value: uah(s.repair), sub: s.km > 0 ? `${fmtDec.format(s.repair / s.km)} ₴ на 1 км` : '—', icon: 'wrench', color: 'text-cyan-300 bg-cyan-500/15', glow: 'rgba(6,182,212,.2)' },
      { label: 'Податок', value: uah(s.tax), sub: `від безналу ${uah(s.bank)}`, icon: 'landmark', color: 'text-rose-300 bg-rose-500/15', glow: 'rgba(244,63,94,.18)' },
      { label: 'Діб у рейсах', value: fmtInt.format(s.days), sub: `добові ${uah(s.perDiem)}`, icon: 'calendar-clock', color: 'text-violet-300 bg-violet-500/15', glow: 'rgba(139,92,246,.2)' },
      { label: 'Прибуток авто', value: uah(s.carProfit), sub: 'база для ЗП (без СТО і податку)', icon: 'truck', color: 'text-teal-300 bg-teal-500/15', glow: 'rgba(20,184,166,.2)', valueClass: profitClass(s.carProfit) },
      { label: 'Усі витрати', value: uah(s.totalExpenses), sub: 'паливо, податок, добові, СТО, ремонт, ЗП, щомісячні', icon: 'receipt', color: 'text-slate-300 bg-slate-500/15', glow: 'rgba(100,116,139,.2)' },
    ];
    const card = (k, big) => `
      <div class="kpi ${big ? 'kpi-main' : ''}" style="--glow:${k.glow}">
        <div class="flex items-start justify-between gap-2">
          <div class="${big ? 'text-sm font-semibold text-slate-300 sm:text-base' : 'text-xs font-medium text-slate-400 sm:text-sm'}">${k.label}</div>
          <div class="kpi-icon ${k.color}"><i data-lucide="${k.icon}" class="${big ? 'h-5 w-5' : 'h-4 w-4'}"></i></div>
        </div>
        <div class="kpi-value mt-2 ${k.valueClass || ''}">${k.value}</div>
        <div class="mt-1 truncate text-xs text-slate-500">${k.sub}</div>
      </div>`;
    $('#kpiMain').innerHTML = main.map((k) => card(k, true)).join('');
    $('#kpis').innerHTML = items.map((k) => card(k, false)).join('');
  }

  // ---------- Структура ----------
  function renderStructure(s) {
    const base = s.freight || 1;
    const rows = [
      { label: 'Паливо', v: s.fuelCost, c: '#f97316' },
      { label: 'Податок', v: s.tax, c: '#f43f5e' },
      { label: 'Добові', v: s.perDiem, c: '#8b5cf6' },
      { label: 'СТО', v: s.sto, c: '#eab308' },
      { label: 'Ремонт', v: s.repair, c: '#06b6d4' },
      { label: 'ЗП водія', v: s.driverPay, c: '#f59e0b' },
      { label: 'ЗП логіста', v: s.logistPay, c: '#d946ef' },
      { label: 'Інші витрати', v: s.other, c: '#64748b' },
      { label: 'Щомісячні витрати', v: s.monthlyExpenses, c: '#94a3b8' },
      { label: 'Компаньйону', v: s.partnerShare, c: '#ec4899' },
      { label: 'Ваш прибуток', v: s.ownerProfit, c: '#10b981' },
    ];
    $('#structure').innerHTML = rows.map((r) => {
      const pct = s.freight > 0 ? (r.v / base) * 100 : 0;
      return `
        <div>
          <div class="mb-1.5 flex items-center justify-between text-sm">
            <span class="flex items-center gap-2 text-slate-300"><span class="h-2.5 w-2.5 rounded-full" style="background:${r.c}"></span>${r.label}</span>
            <span class="num font-semibold ${r.v < 0 ? 'text-rose-400' : 'text-white'}">${uah(r.v)} <span class="ml-1 text-xs font-normal text-slate-500">${fmtL.format(pct)}%</span></span>
          </div>
          <div class="bar"><i style="width:${Math.max(0, Math.min(100, pct))}%;background:${r.c}"></i></div>
        </div>`;
    }).join('');

    const pays = [
      { label: 'Готівка', v: s.cash, icon: 'banknote', c: 'text-emerald-400' },
      { label: 'Безнал', v: s.bank, icon: 'landmark', c: 'text-sky-400' },
      { label: 'Карта', v: s.card, icon: 'credit-card', c: 'text-violet-400' },
    ];
    $('#payments').innerHTML = pays.map((p) => `
      <div class="flex items-center justify-between text-sm">
        <span class="flex items-center gap-2 text-slate-400"><i data-lucide="${p.icon}" class="h-4 w-4 ${p.c}"></i>${p.label}</span>
        <span class="num font-semibold text-white">${uah(p.v)}</span>
      </div>`).join('');
  }

  // ---------- Графік ----------
  function renderChart(list) {
    const canvas = $('#monthlyChart');
    const empty = $('#chartEmpty');
    if (!window.Chart) { empty.textContent = 'Графік недоступний (немає інтернету)'; empty.style.display = 'grid'; return; }

    const groups = new Map();
    for (const t of list) {
      const key = (t.startDate || '').slice(0, 7);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    }
    const keys = Array.from(groups.keys()).sort().slice(-12);
    empty.style.display = keys.length ? 'none' : 'grid';

    const sums = keys.map((k) => summarize(groups.get(k), settings));
    const labels = keys.map((k) => { const [y, m] = k.split('-'); return `${MONTHS_SHORT[+m - 1]} ${y.slice(2)}`; });

    const data = {
      labels,
      datasets: [
        { type: 'bar', label: 'Фрахт', data: sums.map((s) => s.freight), backgroundColor: 'rgba(99,102,241,.75)', borderRadius: 8, maxBarThickness: 34, order: 2 },
        { type: 'bar', label: 'Витрати', data: sums.map((s) => s.totalExpenses), backgroundColor: 'rgba(244,63,94,.55)', borderRadius: 8, maxBarThickness: 34, order: 3 },
        { type: 'line', label: 'Чистий прибуток', data: sums.map((s) => s.netProfit), borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,.15)', pointBackgroundColor: '#10b981', pointRadius: 4, tension: .35, fill: true, order: 1 },
        { type: 'line', label: 'Ваш прибуток', data: sums.map((s) => s.ownerProfit), borderColor: '#a3e635', borderDash: [5, 4], pointBackgroundColor: '#a3e635', pointRadius: 3, tension: .35, fill: false, order: 0 },
      ],
    };

    if (chart) { chart.data = data; chart.update(); return; }

    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
    chart = new Chart(canvas, {
      data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 16 } },
          tooltip: {
            backgroundColor: '#0d1328', borderColor: 'rgba(255,255,255,.1)', borderWidth: 1, padding: 12,
            callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${uah(ctx.parsed.y)}` },
          },
        },
        scales: {
          x: { grid: { display: false }, border: { display: false } },
          y: {
            grid: { color: 'rgba(255,255,255,.05)' }, border: { display: false },
            ticks: { callback: (v) => (Math.abs(v) >= 1000 ? fmtL.format(v / 1000) + 'к' : v) },
          },
        },
      },
    });
  }

  // ---------- Список рейсів ----------
  function tripActions(id) {
    return `
      <button class="icon-btn" data-edit="${id}" title="Редагувати"><i data-lucide="pencil" class="h-4 w-4"></i></button>
      <button class="icon-btn" data-copy="${id}" title="Дублювати"><i data-lucide="copy" class="h-4 w-4"></i></button>
      <button class="icon-btn danger" data-del="${id}" title="Видалити"><i data-lucide="trash-2" class="h-4 w-4"></i></button>`;
  }

  function renderTrips(list, s) {
    $('#tripsCount').textContent = `${list.length} ${plural(list.length, 'рейс', 'рейси', 'рейсів')}` + (list.length !== trips.length ? ` із ${trips.length}` : '');
    const isEmpty = list.length === 0;
    $('#emptyState').style.display = isEmpty ? 'flex' : 'none';
    if (isEmpty && trips.length) {
      $('#emptyState h3').textContent = 'Нічого не знайдено';
      $('#emptyState p').textContent = 'Змініть період або пошуковий запит.';
    } else {
      $('#emptyState h3').textContent = 'Ще немає рейсів';
      $('#emptyState p').textContent = 'Додайте перший рейс — усі показники (км, паливо, податок, добові, ЗП водія, прибуток) порахуються автоматично.';
    }

    const rows = list.map((t) => ({ t, c: calcTrip(t, settings) }));

    // Під номером авто: дати, маршрут, водій
    const tripInfo = (t) => {
      const d = tripDriver(t);
      const hasPlate = !!tripPlate(t).plate;
      return `
        ${hasPlate ? `<div class="mt-0.5 inline-flex items-center gap-1 text-xs text-slate-300"><i data-lucide="calendar" class="h-3 w-3 text-slate-500"></i>${tripDates(t)}</div>` : ''}
        <div class="max-w-[260px] truncate text-xs text-slate-500">${escapeHtml(t.route || t.note || 'Без маршруту')}</div>
        ${d ? `<div class="mt-0.5 inline-flex items-center gap-1 text-xs text-slate-400"><i data-lucide="user-round" class="h-3 w-3 text-amber-300"></i>${escapeHtml(d)}</div>` : ''}`;
    };

    $('#tripsTable').innerHTML = rows.map(({ t, c }) => `
      <tr class="row-hover row-click" data-open="${t.id}" title="Відкрити рейс">
        <td class="td">
          ${tripHeading(t)}
          <div class="flex flex-col">${tripInfo(t)}</div>
        </td>
        <td class="td text-right">${c.days}</td>
        <td class="td text-right">${fmtInt.format(c.km)}</td>
        <td class="td text-right">
          <div>${uah(c.fuelCost)}</div>
          <div class="text-xs text-slate-500">${fmtL.format(c.fuelLiters)} л · водій ${fmtDec.format(c.fuelPrice)}</div>
          ${c.fuelPriceActual !== c.fuelPrice ? `<div class="text-xs text-emerald-400/80">факт ${fmtDec.format(c.fuelPriceActual)}</div>` : ''}
        </td>
        <td class="td text-right font-semibold text-white">${uah(c.freight)}</td>
        <td class="td text-right">${fmtDec.format(c.pricePerKm)}</td>
        <td class="td text-right text-rose-300">${uah(c.tax)}</td>
        <td class="td text-right">${uah(c.perDiem)}</td>
        <td class="td text-right text-yellow-300">${uah(c.sto)}</td>
        <td class="td text-right text-cyan-300">${uah(c.repair)}</td>
        <td class="td text-right text-amber-300">${uah(c.driverPay)}</td>
        <td class="td text-right text-fuchsia-300">${uah(c.logistPay)}</td>
        <td class="td text-right font-semibold ${profitClass(c.netProfit)}">${uah(c.netProfit)}</td>
        <td class="td text-right text-pink-300">${uah(c.partnerShare)}</td>
        <td class="td text-right font-bold ${profitClass(c.ownerProfit)}">${uah(c.ownerProfit)}</td>
        <td class="td"><div class="flex justify-end gap-0.5">${tripActions(t.id)}</div></td>
      </tr>`).join('');

    $('#tripsTotal').innerHTML = isEmpty ? '' : `
      <tr>
        <td class="td">Разом</td>
        <td class="td text-right">${s.days}</td>
        <td class="td text-right">${fmtInt.format(s.km)}</td>
        <td class="td text-right">${uah(s.fuelCost)}</td>
        <td class="td text-right">${uah(s.freight)}</td>
        <td class="td text-right">${fmtDec.format(s.pricePerKm)}</td>
        <td class="td text-right">${uah(s.tax)}</td>
        <td class="td text-right">${uah(s.perDiem)}</td>
        <td class="td text-right">${uah(s.sto)}</td>
        <td class="td text-right">${uah(s.repair)}</td>
        <td class="td text-right">${uah(s.driverPay)}</td>
        <td class="td text-right">${uah(s.logistPay)}</td>
        <td class="td text-right ${profitClass(s.netProfit)}">${uah(s.netProfit)}</td>
        <td class="td text-right">${uah(s.partnerShare)}</td>
        <td class="td text-right ${profitClass(s.ownerProfit)}">${uah(s.ownerProfit)}</td>
        <td class="td"></td>
      </tr>`;

    $('#tripsCards').innerHTML = rows.map(({ t, c }) => `
      <article class="row-click rounded-2xl border border-white/5 bg-white/[0.02] p-4 transition hover:border-white/15" data-open="${t.id}">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            ${tripHeading(t, 'text-lg')}
            <div class="flex flex-col">${tripInfo(t)}</div>
          </div>
          <div class="flex shrink-0">${tripActions(t.id)}</div>
        </div>
        <div class="mt-3 flex flex-wrap gap-1.5">
          <span class="badge bg-violet-500/10 text-violet-300"><i data-lucide="calendar" class="h-3 w-3"></i>${c.days} ${plural(c.days, 'доба', 'доби', 'діб')}</span>
          <span class="badge bg-sky-500/10 text-sky-300"><i data-lucide="route" class="h-3 w-3"></i>${fmtInt.format(c.km)} км</span>
          <span class="badge bg-indigo-500/10 text-indigo-300">${fmtDec.format(c.pricePerKm)} ₴/км</span>
        </div>
        <dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          <dt class="text-slate-400">Фрахт</dt><dd class="num text-right font-semibold text-white">${uah(c.freight)}</dd>
          <dt class="text-slate-400">Паливо</dt><dd class="num text-right">${uah(c.fuelCost)}</dd>
          <dt class="text-slate-400">Податок</dt><dd class="num text-right">${uah(c.tax)}</dd>
          <dt class="text-slate-400">Добові</dt><dd class="num text-right">${uah(c.perDiem)}</dd>
          <dt class="text-slate-400">СТО</dt><dd class="num text-right text-yellow-300">${uah(c.sto)}</dd>
          ${c.repair ? `<dt class="text-slate-400">Ремонт</dt><dd class="num text-right text-cyan-300">${uah(c.repair)}</dd>` : ''}
          <dt class="text-slate-400">ЗП водія</dt><dd class="num text-right text-amber-300">${uah(c.driverPay)}</dd>
          <dt class="text-slate-400">ЗП логіста</dt><dd class="num text-right text-fuchsia-300">${uah(c.logistPay)}</dd>
          <dt class="text-slate-400">Чистий прибуток</dt><dd class="num text-right font-semibold ${profitClass(c.netProfit)}">${uah(c.netProfit)}</dd>
          <dt class="text-slate-400">Компаньйону</dt><dd class="num text-right text-pink-300">${uah(c.partnerShare)}</dd>
        </dl>
        <div class="mt-3 flex items-center justify-between rounded-xl bg-white/[0.03] px-3 py-2">
          <span class="text-sm text-slate-400">Ваш прибуток</span>
          <span class="num text-lg font-bold ${profitClass(c.ownerProfit)}">${uah(c.ownerProfit)}</span>
        </div>
      </article>`).join('');
  }

  /** Короткий список останніх рейсів на панелі. */
  function renderRecent(list) {
    const items = list.slice(0, 5);
    $('#recentTrips').innerHTML = items.length
      ? items.map((t) => {
        const c = calcTrip(t, settings);
        const meta = [tripPlate(t).plate ? tripDates(t) : '', t.route || t.note || 'Без маршруту', tripDriver(t)].filter(Boolean).map(escapeHtml).join(' · ');
        return `
        <div class="row-hover row-click flex items-center gap-4 px-4 py-3 sm:px-5" data-open="${t.id}">
          <div class="min-w-0 flex-1">
            ${tripHeading(t)}
            <div class="truncate text-xs text-slate-500">${meta}</div>
          </div>
          <div class="hidden text-right text-sm sm:block">
            <div class="num text-white">${uah(c.freight)}</div>
            <div class="text-xs text-slate-500">${fmtInt.format(c.km)} км</div>
          </div>
          <div class="w-28 text-right">
            <div class="num font-bold ${profitClass(c.ownerProfit)}">${uah(c.ownerProfit)}</div>
            <div class="text-xs text-slate-500">ваш прибуток</div>
          </div>
          <i data-lucide="chevron-right" class="h-4 w-4 shrink-0 text-slate-600"></i>
        </div>`;
      }).join('')
      : `<div class="px-5 py-10 text-center text-sm text-slate-500">${trips.length ? 'Немає рейсів за вибраний період' : 'Ще немає рейсів'} ·
           <button class="text-indigo-300 underline" data-action="add">додати рейс</button></div>`;
  }

  function renderAll() {
    renderFilters();
    const list = filteredTrips();
    const s = summarize(list, settings);
    renderKpis(s);
    renderStructure(s);
    renderChart(list);
    renderRecent(list);
    renderTrips(list, s);
    if (!$('#viewModal').classList.contains('hidden')) renderTripView();
    refreshIcons();
  }

  // ---------- Вкладки (Панель / Рейси) ----------
  function currentView() { return location.hash === '#trips' ? 'trips' : 'dashboard'; }

  function applyView() {
    const v = currentView();
    $('#dashboardView').classList.toggle('hidden', v !== 'dashboard');
    $('#tripsView').classList.toggle('hidden', v !== 'trips');
    // Рейси — на всю ширину монітора
    $$('.app-container').forEach((el) => el.classList.toggle('max-w-7xl', v !== 'trips'));
    $$('[data-tab]').forEach((el) => el.classList.toggle('active', el.dataset.tab === v));
    $('#viewTitle').textContent = v === 'trips' ? 'Рейси' : 'Фінансова панель';
    document.title = (v === 'trips' ? 'Рейси' : 'Облік рейсів') + ' — вантажні перевезення';
    if (v === 'dashboard' && chart) setTimeout(() => chart.resize(), 0);
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', applyView);

  // ---------- Перегляд рейсу ----------
  let viewingId = null;
  let returnToView = false;

  function openTripView(id) {
    if (!trips.some((t) => t.id === id)) return;
    viewingId = id;
    renderTripView();
    refreshIcons();
    openModal($('#viewModal'));
  }

  function renderTripView() {
    const t = trips.find((x) => x.id === viewingId);
    if (!t) { closeModal($('#viewModal')); return; }
    const c = calcTrip(t, settings);
    const { plate, brand } = tripPlate(t);
    $('#viewTitleTrip').innerHTML = plate
      ? `<span class="plate !text-xl">${escapeHtml(plate)}${brand ? `<span class="plate-brand !text-sm">${escapeHtml(brand)}</span>` : ''}</span>`
      : escapeHtml(tripDates(t));
    $('#viewSubtitle').textContent = (plate ? tripDates(t) + ' · ' : '') + (t.route || 'Без маршруту');

    const row = (label, value, cls = '') => `<div class="preview-row"><dt>${label}</dt><dd class="${cls}">${value}</dd></div>`;
    const block = (icon, title, body) => `<section class="view-block"><h4><i data-lucide="${icon}" class="h-4 w-4"></i>${title}</h4><dl class="text-sm">${body}</dl></section>`;
    const sep = '<div class="preview-sep"></div>';

    $('#viewBody').innerHTML = `
      <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        ${block('users', 'Водій та авто',
          row('Водій', escapeHtml(tripDriver(t) || '—')) +
          row('Авто', escapeHtml(tripCar(t) || '—')) +
          row('Нотатка', escapeHtml(t.note || '—'), 'font-normal text-slate-300'))}
        ${block('gauge', 'Пробіг',
          row('Діб у рейсі', c.days) +
          row('Одометр початок', fmtInt.format(num(t.odoStart)) + ' км') +
          row('Одометр кінець', fmtInt.format(num(t.odoEnd)) + ' км') +
          row('Км за рейс', fmtInt.format(c.km) + ' км', 'text-sky-300'))}
        ${block('fuel', 'Паливо',
          row('Витрата', fmtL.format(c.fuelLiters) + ' л · ' + fmtL.format(c.fuelPer100) + ' л/100км') +
          row('Ціна для водія', uah2(c.fuelPrice) + '/л') +
          row('Фактична ціна', uah2(c.fuelPriceActual) + '/л', 'text-emerald-300') +
          sep +
          row('Сума для водія', uah2(c.fuelCostDriver)) +
          row('Сума фактична', uah2(c.fuelCost), 'text-orange-300') +
          row('Знижка (економія)', uah2(c.fuelDiscount), profitClass(c.fuelDiscount)))}
        ${block('wallet', 'Фрахт',
          row('Готівка', uah2(c.cash)) +
          row('Безнал', uah2(c.bank)) +
          row('Карта', uah2(c.card)) +
          sep +
          row('Сума фрахту', uah2(c.freight), 'text-white') +
          row('Ціна за 1 км', uah2(c.pricePerKm), 'text-indigo-300'))}
        ${block('receipt', 'Витрати',
          row('Паливо (фактично)', uah2(c.fuelCost), 'text-orange-300') +
          row(`Податок ${fmtL.format(c.rates.taxRate)}%`, uah2(c.tax), 'text-rose-300') +
          row(`Добові ${fmtInt.format(c.rates.perDiem)} × ${c.days}`, uah2(c.perDiem), 'text-violet-300') +
          row(`СТО ${fmtInt.format(c.rates.stoRate)} × ${c.days}`, uah2(c.sto), 'text-yellow-300') +
          row('Ремонт', uah2(c.repair), 'text-cyan-300') +
          row('Інші витрати', uah2(c.other)) +
          row(`ЗП водія ${fmtL.format(c.rates.driverRate)}%`, uah2(c.driverPay), 'text-amber-300') +
          row(`ЗП логіста ${fmtL.format(c.rates.logistRate)}% від фрахту`, uah2(c.logistPay), 'text-fuchsia-300') +
          sep +
          row('Усього витрат', uah2(c.totalExpenses), 'text-white'))}
        ${block('pie-chart', 'Прибуток',
          row('Прибуток авто (база ЗП)', uah2(c.carProfit), profitClass(c.carProfit)) +
          (c.fuelDiscount ? row('Знижка на паливо', (c.fuelDiscount > 0 ? '+ ' : '− ') + uah2(Math.abs(c.fuelDiscount)), profitClass(c.fuelDiscount)) : '') +
          row(`Податок ${fmtL.format(c.rates.taxRate)}%`, '− ' + uah2(c.tax), 'text-rose-300') +
          row(`СТО ${fmtInt.format(c.rates.stoRate)} × ${c.days}`, '− ' + uah2(c.sto), 'text-yellow-300') +
          row(`ЗП водія ${fmtL.format(c.rates.driverRate)}%`, '− ' + uah2(c.driverPay), 'text-amber-300') +
          row(`ЗП логіста ${fmtL.format(c.rates.logistRate)}%`, '− ' + uah2(c.logistPay), 'text-fuchsia-300') +
          row('Чистий прибуток бізнесу', uah2(c.netProfit), 'font-semibold ' + profitClass(c.netProfit)) +
          row(`Компаньйону ${fmtL.format(c.rates.partnerRate)}%`, '− ' + uah2(c.partnerShare), 'text-pink-300') +
          `<div class="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3">
             <div class="text-xs text-emerald-200/80">Ваш прибуток</div>
             <div class="num text-2xl font-extrabold ${profitClass(c.ownerProfit)}">${uah2(c.ownerProfit)}</div>
             <div class="text-xs text-slate-400">чистий бізнесу ${fmtDec.format(c.profitPerKm)} ₴ з кожного км</div>
           </div>`)}
      </div>`;
  }

  $('#viewEdit').addEventListener('click', () => {
    const id = viewingId;
    closeModal($('#viewModal'));
    returnToView = true;
    openTripForm(id);
  });
  $('#viewCopy').addEventListener('click', () => {
    const id = viewingId;
    closeModal($('#viewModal'));
    openTripForm(id, { copy: true });
  });
  $('#viewDelete').addEventListener('click', () => {
    const t = trips.find((x) => x.id === viewingId);
    if (t && confirm(`Видалити рейс ${fmtDate(t.startDate)} — ${fmtDate(t.endDate)}?`)) {
      trips = trips.filter((x) => x.id !== t.id);
      closeModal($('#viewModal'));
      saveTrips(); renderAll(); toast('Рейс видалено', 'info');
    }
  });

  // ---------- Модалки ----------
  function openModal(el) {
    el.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
  function closeModal(el) {
    if (!el || el.classList.contains('hidden')) return;
    el.classList.add('hidden');
    // Після редагування з картки перегляду — повертаємось до неї
    if (el.id === 'tripModal' && returnToView) {
      returnToView = false;
      if (viewingId && trips.some((t) => t.id === viewingId)) { openTripView(viewingId); return; }
    }
    if ($$('.modal:not(.hidden)').length === 0) document.body.style.overflow = '';
  }

  const tripForm = $('#tripForm');
  const FIELDS = ['driverId', 'carId', 'startDate', 'endDate', 'route', 'odoStart', 'odoEnd', 'fuelLiters', 'fuelPrice', 'fuelPriceActual', 'cash', 'bank', 'card', 'repairExpenses', 'otherExpenses', 'note', 'perDiem', 'stoRate', 'taxRate', 'driverRate', 'partnerRate', 'logistRate'];
  const TEXT_FIELDS = ['driverId', 'carId', 'startDate', 'endDate', 'route', 'note'];

  /** Списки водіїв/авто у формі рейсу. Якщо в рейсі вказано вже видаленого — показуємо його окремо. */
  function renderTripSelects(t) {
    const build = (list, labelFn, curId, curName, empty) => {
      const items = list.slice().sort(sortByLabel(labelFn)).map((x) => ({ id: x.id, name: labelFn(x) }));
      if (curId && !items.some((x) => x.id === curId)) items.push({ id: curId, name: (curName || '—') + ' (видалено)' });
      return `<option value="">${empty}</option>` +
        items.map((x) => `<option value="${escapeHtml(x.id)}">${escapeHtml(x.name)}</option>`).join('');
    };
    tripForm.elements.driverId.innerHTML = build(drivers, driverLabel, t.driverId, t.driverName, '— Не вибрано —');
    tripForm.elements.carId.innerHTML = build(cars, carLabel, t.carId, t.carName, '— Не вибрано —');
    $('#refsHint').classList.toggle('hidden', drivers.length > 0 && cars.length > 0);
  }

  function readForm() {
    const data = {};
    for (const f of FIELDS) {
      const v = tripForm.elements[f].value.trim();
      data[f] = TEXT_FIELDS.includes(f) ? v : v === '' ? '' : num(v);
    }
    return data;
  }

  function fillForm(t) {
    renderTripSelects(t);
    for (const f of FIELDS) tripForm.elements[f].value = t[f] ?? '';
  }

  function lastTrip() {
    return trips.slice().sort((a, b) => (b.endDate || '').localeCompare(a.endDate || '') || num(b.odoEnd) - num(a.odoEnd))[0];
  }

  function openTripForm(id, { copy = false } = {}) {
    clearErrors();
    const existing = id ? trips.find((t) => t.id === id) : null;
    editingId = existing && !copy ? existing.id : null;
    formSource = existing;

    if (existing) {
      fillForm(existing);
      if (copy) {
        const prev = lastTrip();
        tripForm.elements.startDate.value = '';
        tripForm.elements.endDate.value = '';
        tripForm.elements.odoStart.value = prev ? prev.odoEnd : '';
        tripForm.elements.odoEnd.value = '';
        tripForm.elements.fuelLiters.value = '';
        tripForm.elements.repairExpenses.value = '';
      }
    } else {
      const prev = lastTrip();
      const today = new Date().toISOString().slice(0, 10);
      // Водій/авто — як у попередньому рейсі (якщо вони ще є в довіднику), або єдиний у списку
      const pick = (list, id) => (id && list.some((x) => x.id === id) ? id : list.length === 1 ? list[0].id : '');
      fillForm({
        driverId: pick(drivers, prev && prev.driverId),
        carId: pick(cars, prev && prev.carId),
        startDate: today, endDate: today,
        odoStart: prev ? prev.odoEnd : '',
        fuelPrice: prev ? prev.fuelPrice : '',
        fuelPriceActual: prev ? prev.fuelPriceActual ?? '' : '',
        perDiem: settings.perDiem, stoRate: settings.stoRate, taxRate: settings.taxRate, driverRate: settings.driverRate, partnerRate: settings.partnerRate, logistRate: settings.logistRate,
      });
    }
    $('#tripModalTitle').textContent = editingId ? 'Редагування рейсу' : copy ? 'Новий рейс (копія)' : 'Новий рейс';
    updatePreview();
    openModal($('#tripModal'));
    setTimeout(() => tripForm.elements[editingId ? 'cash' : 'startDate'].focus({ preventScroll: true }), 50);
  }

  function updatePreview() {
    const d = readForm();
    const c = calcTrip(d, settings);
    const row = (label, value, cls = '') => `<div class="preview-row"><dt>${label}</dt><dd class="${cls}">${value}</dd></div>`;
    $('#preview').innerHTML = [
      row('Діб у рейсі', c.days),
      row('Км за рейс', fmtInt.format(c.km) + ' км'),
      row('Середня витрата', fmtL.format(c.fuelPer100) + ' л/100км'),
      '<div class="preview-sep"></div>',
      row('Сума фрахту', uah2(c.freight), 'text-white'),
      row('Ціна за 1 км', uah2(c.pricePerKm), 'text-indigo-300'),
      '<div class="preview-sep"></div>',
      row('Паливо (ціна для водія)', '− ' + uah2(c.fuelCostDriver), 'text-orange-300'),
      row(`Добові ${fmtInt.format(c.rates.perDiem)} × ${c.days}`, '− ' + uah2(c.perDiem), 'text-violet-300'),
      c.repair ? row('Ремонт', '− ' + uah2(c.repair), 'text-cyan-300') : '',
      c.other ? row('Інші витрати', '− ' + uah2(c.other), 'text-slate-300') : '',
      '<div class="preview-sep"></div>',
      row('Прибуток авто (база ЗП)', uah2(c.carProfit), profitClass(c.carProfit)),
      row(`ЗП водія ${fmtL.format(c.rates.driverRate)}%`, '− ' + uah2(c.driverPay), 'text-amber-300'),
      row(`Податок ${fmtL.format(c.rates.taxRate)}% (безнал)`, '− ' + uah2(c.tax), 'text-rose-300'),
      row(`СТО ${fmtInt.format(c.rates.stoRate)} × ${c.days}`, '− ' + uah2(c.sto), 'text-yellow-300'),
      c.fuelDiscount ? row(`Знижка на паливо (факт ${fmtDec.format(c.fuelPriceActual)})`, (c.fuelDiscount > 0 ? '+ ' : '− ') + uah2(Math.abs(c.fuelDiscount)), profitClass(c.fuelDiscount)) : '',
      row(`ЗП логіста ${fmtL.format(c.rates.logistRate)}% від фрахту`, '− ' + uah2(c.logistPay), 'text-fuchsia-300'),
      '<div class="preview-sep"></div>',
      row('Чистий прибуток бізнесу', uah2(c.netProfit), 'font-semibold ' + profitClass(c.netProfit)),
      row(`Компаньйону ${fmtL.format(c.rates.partnerRate)}%`, '− ' + uah2(c.partnerShare), 'text-pink-300'),
      `<div class="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3">
         <div class="text-xs text-emerald-200/80">Ваш прибуток</div>
         <div class="num text-2xl font-extrabold ${profitClass(c.ownerProfit)}">${uah2(c.ownerProfit)}</div>
         <div class="text-xs text-slate-400">чистий бізнесу ${fmtDec.format(c.profitPerKm)} ₴ з кожного км</div>
       </div>`,
    ].join('');
  }

  function clearErrors() {
    $$('.input.invalid', tripForm).forEach((el) => el.classList.remove('invalid'));
    $('#formError').classList.add('hidden');
  }

  function validate(d) {
    const errors = [];
    const mark = (name) => tripForm.elements[name].classList.add('invalid');
    if (!d.startDate) { errors.push('Вкажіть дату початку рейсу.'); mark('startDate'); }
    if (!d.endDate) { errors.push('Вкажіть дату кінця рейсу.'); mark('endDate'); }
    if (d.startDate && d.endDate && d.endDate < d.startDate) { errors.push('Дата кінця не може бути раніше дати початку.'); mark('endDate'); }
    if (d.odoStart === '') { errors.push('Вкажіть початковий одометр.'); mark('odoStart'); }
    if (d.odoEnd === '') { errors.push('Вкажіть кінцевий одометр.'); mark('odoEnd'); }
    if (d.odoStart !== '' && d.odoEnd !== '' && d.odoEnd < d.odoStart) { errors.push('Кінцевий одометр менший за початковий.'); mark('odoEnd'); }
    for (const f of ['fuelLiters', 'fuelPrice', 'fuelPriceActual', 'cash', 'bank', 'card', 'repairExpenses', 'otherExpenses', 'perDiem', 'stoRate', 'taxRate', 'driverRate', 'partnerRate', 'logistRate']) {
      if (d[f] !== '' && d[f] < 0) { errors.push('Значення не можуть бути відʼємними.'); mark(f); break; }
    }
    return errors;
  }

  tripForm.addEventListener('input', (e) => {
    if (e.target.classList.contains('invalid')) e.target.classList.remove('invalid');
    updatePreview();
  });

  tripForm.addEventListener('submit', (e) => {
    e.preventDefault();
    clearErrors();
    const d = readForm();
    const errors = validate(d);
    if (errors.length) {
      const box = $('#formError');
      box.innerHTML = errors.map(escapeHtml).join('<br>');
      box.classList.remove('hidden');
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    // Порожні ставки — беремо з налаштувань, щоб рейс зберіг свою ставку
    if (d.perDiem === '') d.perDiem = settings.perDiem;
    if (d.stoRate === '') d.stoRate = settings.stoRate;
    if (d.taxRate === '') d.taxRate = settings.taxRate;
    if (d.driverRate === '') d.driverRate = settings.driverRate;
    if (d.partnerRate === '') d.partnerRate = settings.partnerRate;
    if (d.logistRate === '') d.logistRate = settings.logistRate;
    // Запамʼятовуємо імʼя водія та номер авто — щоб рейс зберіг їх, навіть якщо їх видалять із довідника
    const drv = drivers.find((x) => x.id === d.driverId);
    const car = cars.find((x) => x.id === d.carId);
    const src = formSource || {}; // рейс, з якого відкрито форму (редагування/копія)
    d.driverName = drv ? driverLabel(drv) : d.driverId && d.driverId === src.driverId ? src.driverName || '' : '';
    d.carName = car ? carLabel(car) : d.carId && d.carId === src.carId ? src.carName || '' : '';

    if (editingId) {
      const i = trips.findIndex((t) => t.id === editingId);
      trips[i] = Object.assign({}, trips[i], d, { updatedAt: Date.now() });
      toast('Рейс оновлено');
    } else {
      trips.push(Object.assign({ id: uid(), createdAt: Date.now() }, d));
      toast('Рейс додано');
    }
    saveTrips();
    closeModal($('#tripModal'));
    renderAll();
  });

  // ---------- Налаштування ----------
  const settingsForm = $('#settingsForm');
  $('#settingsBtn').addEventListener('click', () => {
    settingsForm.elements.perDiem.value = settings.perDiem;
    settingsForm.elements.stoRate.value = settings.stoRate;
    settingsForm.elements.taxRate.value = settings.taxRate;
    settingsForm.elements.driverRate.value = settings.driverRate;
    settingsForm.elements.partnerRate.value = settings.partnerRate;
    settingsForm.elements.logistRate.value = settings.logistRate;
    settingsForm.elements.monthlyExpenses.value = settings.monthlyExpenses || '';
    openModal($('#settingsModal'));
  });
  settingsForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const read = (n, def) => { const v = settingsForm.elements[n].value.trim(); return v === '' ? def : Math.max(0, num(v)); };
    settings = {
      perDiem: read('perDiem', DEFAULTS.perDiem),
      stoRate: read('stoRate', DEFAULTS.stoRate),
      taxRate: read('taxRate', DEFAULTS.taxRate),
      driverRate: read('driverRate', DEFAULTS.driverRate),
      partnerRate: read('partnerRate', DEFAULTS.partnerRate),
      logistRate: read('logistRate', DEFAULTS.logistRate),
      monthlyExpenses: read('monthlyExpenses', DEFAULTS.monthlyExpenses),
    };
    saveSettings();
    closeModal($('#settingsModal'));
    renderAll();
    toast('Ставки збережено');
  });

  // ---------- Довідник: водії та авто ----------
  const driverForm = $('#driverForm');
  const carForm = $('#carForm');

  function renderRefs() {
    const tripsWith = (key, id) => trips.filter((t) => t[key] === id).length;
    const item = (id, kind, title, sub, icon, color, count) => `
      <li class="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2">
        <div class="grid h-8 w-8 shrink-0 place-items-center rounded-lg ${color}"><i data-lucide="${icon}" class="h-4 w-4"></i></div>
        <div class="min-w-0 flex-1">
          <div class="truncate font-medium text-white">${escapeHtml(title)}</div>
          <div class="truncate text-xs text-slate-500">${escapeHtml(sub)}${sub ? ' · ' : ''}${count} ${plural(count, 'рейс', 'рейси', 'рейсів')}</div>
        </div>
        <button type="button" class="icon-btn danger" data-del-${kind}="${escapeHtml(id)}" title="Видалити"><i data-lucide="trash-2" class="h-4 w-4"></i></button>
      </li>`;
    const empty = (txt) => `<li class="rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-sm text-slate-500">${txt}</li>`;

    $('#driversList').innerHTML = drivers.length
      ? drivers.slice().sort(sortByLabel(driverLabel)).map((d) => item(d.id, 'driver', driverLabel(d), '', 'user-round', 'bg-amber-500/15 text-amber-300', tripsWith('driverId', d.id))).join('')
      : empty('Водіїв ще немає');
    $('#carsList').innerHTML = cars.length
      ? cars.slice().sort(sortByLabel(carLabel)).map((c) => item(c.id, 'car', c.plate, c.brand, 'truck', 'bg-sky-500/15 text-sky-300', tripsWith('carId', c.id))).join('')
      : empty('Авто ще немає');
    refreshIcons();
  }

  function openRefs() {
    renderRefs();
    openModal($('#refsModal'));
    setTimeout(() => driverForm.elements.lastName.focus({ preventScroll: true }), 50);
  }

  /** Після змін у довіднику — оновити форму рейсу (якщо відкрита) і панель. */
  function afterRefsChange() {
    saveRefs();
    renderRefs();
    if (!$('#tripModal').classList.contains('hidden')) {
      const cur = { driverId: tripForm.elements.driverId.value, carId: tripForm.elements.carId.value };
      const src = formSource || {};
      renderTripSelects({ driverId: cur.driverId, carId: cur.carId, driverName: src.driverName, carName: src.carName });
      tripForm.elements.driverId.value = cur.driverId;
      tripForm.elements.carId.value = cur.carId;
    }
    renderAll();
  }

  const normPlate = (s) => s.toUpperCase().replace(/\s+/g, '');

  driverForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const lastName = driverForm.elements.lastName.value.trim();
    const firstName = driverForm.elements.firstName.value.trim();
    driverForm.elements.lastName.classList.toggle('invalid', !lastName);
    driverForm.elements.firstName.classList.toggle('invalid', !firstName);
    if (!lastName || !firstName) return toast('Вкажіть прізвище та імʼя водія', 'err');
    const label = `${lastName} ${firstName}`.toLowerCase();
    if (drivers.some((d) => driverLabel(d).toLowerCase() === label)) return toast('Такий водій уже є', 'err');
    const d = { id: uid(), lastName, firstName };
    drivers.push(d);
    driverForm.reset();
    afterRefsChange();
    // Якщо додаємо з відкритої форми рейсу і водія ще не вибрано — одразу підставляємо
    if (!$('#tripModal').classList.contains('hidden') && !tripForm.elements.driverId.value) tripForm.elements.driverId.value = d.id;
    driverForm.elements.lastName.focus();
    toast('Водія додано');
  });

  carForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const plate = normPlate(carForm.elements.plate.value);
    const brand = carForm.elements.brand.value.trim();
    carForm.elements.plate.classList.toggle('invalid', !plate);
    carForm.elements.brand.classList.toggle('invalid', !brand);
    if (!plate || !brand) return toast('Вкажіть держ. номер та марку авто', 'err');
    if (cars.some((c) => normPlate(c.plate) === plate)) return toast('Авто з таким номером уже є', 'err');
    const c = { id: uid(), plate, brand };
    cars.push(c);
    carForm.reset();
    afterRefsChange();
    if (!$('#tripModal').classList.contains('hidden') && !tripForm.elements.carId.value) tripForm.elements.carId.value = c.id;
    carForm.elements.plate.focus();
    toast('Авто додано');
  });

  [driverForm, carForm].forEach((f) => f.addEventListener('input', (e) => e.target.classList.remove('invalid')));

  function deleteDriver(id) {
    const d = drivers.find((x) => x.id === id);
    if (!d || !confirm(`Видалити водія «${driverLabel(d)}»? У збережених рейсах імʼя залишиться.`)) return;
    // Фіксуємо імʼя у рейсах (на випадок старих записів без нього)
    for (const t of trips) if (t.driverId === id) t.driverName = driverLabel(d);
    drivers = drivers.filter((x) => x.id !== id);
    saveTrips();
    afterRefsChange();
    toast('Водія видалено', 'info');
  }

  function deleteCar(id) {
    const c = cars.find((x) => x.id === id);
    if (!c || !confirm(`Видалити авто «${carLabel(c)}»? У збережених рейсах номер залишиться.`)) return;
    for (const t of trips) if (t.carId === id) t.carName = carLabel(c);
    cars = cars.filter((x) => x.id !== id);
    saveTrips();
    afterRefsChange();
    toast('Авто видалено', 'info');
  }

  $('#refsBtn').addEventListener('click', openRefs);

  // ---------- Експорт / імпорт ----------
  function download(name, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function exportCSV() {
    const list = filteredTrips();
    if (!list.length) return toast('Немає рейсів для експорту', 'info');
    const head = ['Дата початку', 'Дата кінця', 'Водій', 'Авто', 'Маршрут', 'Одометр поч.', 'Одометр кін.', 'Км', 'Діб', 'Паливо, л', 'Ціна палива для водія', 'Фактична ціна палива', 'Паливо для водія, грн', 'Паливо фактично, грн', 'Знижка на паливо', 'Готівка', 'Безнал', 'Карта', 'Фрахт всього', 'Грн/км', 'Податок', 'Добові', 'СТО', 'Ремонт', 'Інші витрати', 'Прибуток авто', 'ЗП водія', 'ЗП логіста', 'Чистий прибуток бізнесу', 'Компаньйону', 'Ваш прибуток', 'Нотатка'];
    const cell = (v) => {
      const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? '');
      return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [head.join(';')];
    for (const t of list) {
      const c = calcTrip(t, settings);
      lines.push([fmtDate(t.startDate), fmtDate(t.endDate), tripDriver(t), tripCar(t), t.route, num(t.odoStart), num(t.odoEnd), c.km, c.days, c.fuelLiters, c.fuelPrice, c.fuelPriceActual, c.fuelCostDriver, c.fuelCost, c.fuelDiscount, c.cash, c.bank, c.card, c.freight, c.pricePerKm, c.tax, c.perDiem, c.sto, c.repair, c.other, c.carProfit, c.driverPay, c.logistPay, c.netProfit, c.partnerShare, c.ownerProfit, t.note].map(cell).join(';'));
    }
    download(`reisy_${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
    toast('CSV збережено — відкривається в Excel');
  }

  function exportJSON() {
    const payload = { app: 'truck-ledger', version: 2, exportedAt: new Date().toISOString(), settings, drivers, cars, trips };
    download(`reisy_backup_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2), 'application/json');
    toast('Резервну копію збережено');
  }

  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const list = Array.isArray(data) ? data : data.trips;
      if (!Array.isArray(list)) throw new Error('bad format');
      const clean = list.filter((t) => t && typeof t === 'object' && t.startDate).map((t) => Object.assign({}, t, { id: t.id || uid() }));
      if (!confirm(`Знайдено рейсів: ${clean.length}. Замінити поточні дані (${trips.length})?`)) return;
      trips = clean;
      if (data.settings) settings = Object.assign({}, DEFAULTS, data.settings);
      if (Array.isArray(data.drivers)) drivers = data.drivers.filter((d) => d && d.id && (d.lastName || d.firstName));
      if (Array.isArray(data.cars)) cars = data.cars.filter((c) => c && c.id && c.plate);
      saveTrips(); saveSettings(); saveRefs(); renderAll();
      toast('Дані відновлено');
    } catch (err) {
      toast('Не вдалося прочитати файл', 'err');
    }
  });

  function addDemo() {
    const base = new Date();
    const mk = (monthsAgo, day, len, km, liters, price, cash, bank, card, route, other = 0) => {
      const s = new Date(Date.UTC(base.getFullYear(), base.getMonth() - monthsAgo, day));
      const e = new Date(s.getTime() + (len - 1) * 86400000);
      return { startDate: s.toISOString().slice(0, 10), endDate: e.toISOString().slice(0, 10), km, liters, price, cash, bank, card, route, other };
    };
    const demo = [
      mk(5, 3, 4, 1850, 520, 54.9, 8000, 42000, 0, 'Київ → Львів → Київ'),
      mk(4, 10, 6, 2700, 760, 55.4, 0, 61000, 5000, 'Дніпро → Одеса → Київ', 1200),
      mk(3, 2, 3, 1200, 340, 55.9, 12000, 18000, 3000, 'Київ → Вінниця'),
      mk(2, 14, 7, 3100, 880, 56.2, 5000, 72000, 0, 'Київ → Ужгород → Харків', 2500),
      mk(1, 5, 5, 2300, 650, 56.5, 10000, 45000, 4000, 'Полтава → Львів'),
      mk(0, 1, 4, 1700, 480, 56.9, 6000, 38000, 2000, 'Київ → Рівне → Київ', 800),
    ];
    // Якщо довідник порожній — додаємо демо-водіїв та авто
    if (!drivers.length) drivers.push({ id: uid(), lastName: 'Коваленко', firstName: 'Олег' }, { id: uid(), lastName: 'Шевчук', firstName: 'Андрій' });
    if (!cars.length) cars.push({ id: uid(), plate: 'AA1234BB', brand: 'MAN TGX' });
    const repairs = [0, 3500, 0, 0, 7800, 0];
    let odo = Math.max(250000, ...trips.map((t) => num(t.odoEnd)));
    demo.forEach((d, i) => {
      const odoStart = odo;
      odo += d.km;
      const drv = drivers[i % drivers.length];
      const car = cars[i % cars.length];
      trips.push({
        id: uid(), createdAt: Date.now(), startDate: d.startDate, endDate: d.endDate, route: d.route,
        driverId: drv.id, driverName: driverLabel(drv), carId: car.id, carName: carLabel(car),
        odoStart, odoEnd: odo, fuelLiters: d.liters, fuelPrice: d.price, fuelPriceActual: Math.round((d.price - 1.5 - (i % 3) * 0.4) * 100) / 100,
        cash: d.cash, bank: d.bank, card: d.card, repairExpenses: repairs[i], otherExpenses: d.other, note: 'Демо',
        perDiem: settings.perDiem, stoRate: settings.stoRate, taxRate: settings.taxRate, driverRate: settings.driverRate, partnerRate: settings.partnerRate, logistRate: settings.logistRate,
      });
    });
    saveTrips(); saveRefs(); renderAll();
    toast('Додано 6 демо-рейсів');
  }

  // ---------- Події ----------
  $('#addTripBtn').addEventListener('click', () => openTripForm());

  const menu = $('#menu');
  $('#menuBtn').addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); });
  document.addEventListener('click', (e) => { if (!$('#menuWrap').contains(e.target)) menu.classList.add('hidden'); });

  document.addEventListener('click', (e) => {
    const closer = e.target.closest('[data-close]');
    if (closer) { closeModal(closer.closest('.modal')); return; }

    const action = e.target.closest('[data-action]');
    if (action) {
      menu.classList.add('hidden');
      switch (action.dataset.action) {
        case 'add': openTripForm(); break;
        case 'export-csv': exportCSV(); break;
        case 'export-json': exportJSON(); break;
        case 'import-json': $('#importFile').click(); break;
        case 'demo': addDemo(); break;
        case 'refs': openRefs(); break;
        case 'clear':
          if (trips.length && confirm('Видалити ВСІ рейси? Рекомендуємо спершу зробити резервну копію.')) {
            trips = []; saveTrips(); renderAll(); toast('Усі дані видалено', 'info');
          }
          break;
      }
      return;
    }

    const delDriver = e.target.closest('[data-del-driver]');
    if (delDriver) return deleteDriver(delDriver.dataset.delDriver);
    const delCar = e.target.closest('[data-del-car]');
    if (delCar) return deleteCar(delCar.dataset.delCar);

    const edit = e.target.closest('[data-edit]');
    if (edit) return openTripForm(edit.dataset.edit);
    const copy = e.target.closest('[data-copy]');
    if (copy) return openTripForm(copy.dataset.copy, { copy: true });
    const del = e.target.closest('[data-del]');
    if (del) {
      const t = trips.find((x) => x.id === del.dataset.del);
      if (t && confirm(`Видалити рейс ${fmtDate(t.startDate)} — ${fmtDate(t.endDate)}?`)) {
        trips = trips.filter((x) => x.id !== t.id);
        saveTrips(); renderAll(); toast('Рейс видалено', 'info');
      }
      return;
    }
    // Клік по рядку/картці рейсу — відкрити перегляд
    const open = e.target.closest('[data-open]');
    if (open) openTripView(open.dataset.open);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { const open = $$('.modal:not(.hidden)'); if (open.length) closeModal(open[open.length - 1]); }
  });

  $('#yearFilter').addEventListener('change', (e) => { filter.year = e.target.value; renderAll(); });
  $('#monthFilter').addEventListener('change', (e) => { filter.month = e.target.value; renderAll(); });
  $('#driverFilter').addEventListener('change', (e) => { filter.driver = e.target.value; renderAll(); });
  $('#carFilter').addEventListener('change', (e) => { filter.car = e.target.value; renderAll(); });
  $('#search').addEventListener('input', (e) => { query = e.target.value; renderAll(); });

  applyView();
  renderAll();
})();
