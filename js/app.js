/* Облік рейсів — основна логіка інтерфейсу */
(function () {
  'use strict';

  const { calcTrip, summarize, DEFAULTS, num } = window.Calc;

  const Cloud = window.Cloud;
  const MONTHS = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];
  const MONTHS_SHORT = ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру'];

  // ---------- Стан (дані з хмари, див. js/cloud.js) ----------
  let trips, drivers, cars, settings;
  function loadState() {
    trips = Cloud.get('trips', []);
    drivers = Cloud.get('drivers', []);
    cars = Cloud.get('cars', []);
    settings = Object.assign({}, DEFAULTS, Cloud.get('settings', {}));
  }
  loadState();
  let filter = { year: 'all', month: 'all', driver: 'all', car: 'all' };
  let query = '';
  let editingId = null;
  let formSource = null;
  let chart = null;

  // ---------- Утиліти ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function saveTrips() { Cloud.set('trips', trips); }
  function saveSettings() { Cloud.set('settings', settings); }
  function saveRefs() {
    Cloud.set('drivers', drivers);
    Cloud.set('cars', cars);
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
    if (!plate) return `<div class="trip-dates ${cls}">${fmtDate(t.startDate)} — ${fmtDate(t.endDate)}</div>`;
    return `<div class="plate-line ${cls}">${plateHtml(plate)}${brand ? `<span class="plate-brand">${escapeHtml(brand)}</span>` : ''}</div>`;
  }
  /** Держ. номер у вигляді українського номерного знака (синя смужка UA зліва). */
  function plateHtml(plate) {
    return `<span class="plate"><span class="plate-ua" aria-hidden="true">UA</span><span class="plate-num">${escapeHtml(plate)}</span></span>`;
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
  const profitClass = (n) => (n > 0 ? 'text-profit' : n < 0 ? 'text-loss' : 'text-slate-300');

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
  function filteredTrips(ignorePeriod = false) {
    const q = query.trim().toLowerCase();
    return trips
      .filter((t) => {
        const [y, m] = (t.startDate || '').split('-');
        if (!ignorePeriod && filter.year !== 'all' && y !== filter.year) return false;
        if (!ignorePeriod && filter.month !== 'all' && m !== filter.month) return false;
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
      { key: 'net', label: '1. Чистий прибуток бізнесу', value: uah(s.netProfit), sub: s.freight > 0 ? `рентабельність ${fmtL.format((s.netProfit / s.freight) * 100)}%` + (s.monthlyExpenses ? ` · з урахуванням щомісячних ${uah(s.monthlyExpenses)}` : '') : '—', icon: 'trending-up', color: 'text-emerald-300 bg-emerald-500/15', glow: 'rgba(16,185,129,.22)', valueClass: profitClass(s.netProfit) },
      { key: 'partner', label: '2. Компаньйону', value: uah(s.partnerShare), sub: (s.netProfit + s.monthlyExpenses) > 0 ? `${fmtL.format((s.partnerShare / (s.netProfit + s.monthlyExpenses)) * 100)}% від чистого прибутку` + (s.monthlyExpenses ? ' (без щомісячних)' : '') : 'від чистого прибутку бізнесу', icon: 'handshake', color: 'text-pink-300 bg-pink-500/15', glow: 'rgba(236,72,153,.2)' },
      { key: 'owner', label: '3. Ваш прибуток', value: uah(s.ownerProfit), sub: s.monthlyExpenses ? 'після компаньйону та щомісячних витрат' : 'чистий прибуток бізнесу після компаньйону', icon: 'piggy-bank', color: 'text-lime-300 bg-lime-500/15', glow: 'rgba(132,204,22,.2)', valueClass: profitClass(s.ownerProfit) },
    ];
    const items = [
      { key: 'freight', label: 'Сума фрахту', value: uah(s.freight), sub: `${s.count} ${plural(s.count, 'рейс', 'рейси', 'рейсів')}` + (s.dispatch ? ` · без диспетчерських ${uah(s.dispatch)}` : ''), icon: 'wallet', color: 'text-indigo-300 bg-indigo-500/15', glow: 'rgba(99,102,241,.22)' },
      { key: 'driverPay', label: 'ЗП водія', value: uah(s.driverPay), sub: `+ добові ${uah(s.perDiem)}`, icon: 'user-round', color: 'text-amber-300 bg-amber-500/15', glow: 'rgba(245,158,11,.2)' },
      { key: 'logistPay', label: 'ЗП логіста', value: uah(s.logistPay), sub: (s.freight > 0 ? `${fmtL.format((s.logistPay / s.freight) * 100)}% від фрахту` : 'від суми фрахту') + ' · входить у чистий прибуток', icon: 'headset', color: 'text-fuchsia-300 bg-fuchsia-500/15', glow: 'rgba(217,70,239,.2)' },
      { key: 'monthly', label: 'Щомісячні витрати', value: uah(s.monthlyExpenses), sub: s.monthlyRate ? `${uah(s.monthlyRate)} × ${s.months} ${plural(s.months, 'місяць', 'місяці', 'місяців')}` : 'вкажіть суму в «Ставках»', icon: 'calendar-check', color: 'text-slate-300 bg-slate-500/15', glow: 'rgba(100,116,139,.2)' },
      { key: 'pricePerKm', label: 'Ціна за 1 км', value: uah2(s.pricePerKm), sub: `${fmtInt.format(s.km)} км пробігу`, icon: 'route', color: 'text-sky-300 bg-sky-500/15', glow: 'rgba(14,165,233,.2)' },
      { key: 'fuel', label: 'Паливо (фактично)', value: uah(s.fuelCost), sub: `${fmtL.format(s.fuelLiters)} л · ${fmtL.format(s.fuelPer100)} л/100км · знижка ${uah(s.fuelDiscount)}`, icon: 'fuel', color: 'text-orange-300 bg-orange-500/15', glow: 'rgba(249,115,22,.2)' },
      { key: 'sto', label: 'СТО', value: uah(s.sto), sub: `за ${fmtInt.format(s.days)} ${plural(s.days, 'доба', 'доби', 'діб')} у рейсах`, icon: 'hammer', color: 'text-yellow-300 bg-yellow-500/15', glow: 'rgba(234,179,8,.18)' },
      { key: 'repair', label: 'Ремонт', value: uah(s.repair), sub: s.km > 0 ? `${fmtDec.format(s.repair / s.km)} ₴ на 1 км` : '—', icon: 'wrench', color: 'text-cyan-300 bg-cyan-500/15', glow: 'rgba(6,182,212,.2)' },
      { key: 'tax', label: 'Податок', value: uah(s.tax), sub: `від безналу ${uah(s.bank)}`, icon: 'landmark', color: 'text-rose-300 bg-rose-500/15', glow: 'rgba(244,63,94,.18)' },
      { key: 'days', label: 'Діб у рейсах', value: fmtInt.format(s.days), sub: `добові ${uah(s.perDiem)}`, icon: 'calendar-clock', color: 'text-violet-300 bg-violet-500/15', glow: 'rgba(139,92,246,.2)' },
      { key: 'carProfit', label: 'Прибуток авто', value: uah(s.carProfit), sub: 'база для ЗП (без СТО і податку)', icon: 'truck', color: 'text-teal-300 bg-teal-500/15', glow: 'rgba(20,184,166,.2)', valueClass: profitClass(s.carProfit) },
      { key: 'totalExpenses', label: 'Усі витрати', value: uah(s.totalExpenses), sub: 'паливо, податок, добові, СТО, ремонт, ЗП, щомісячні', icon: 'receipt', color: 'text-slate-300 bg-slate-500/15', glow: 'rgba(100,116,139,.2)' },
    ];
    const card = (k, big) => `
      <div class="kpi ${big ? 'kpi-main' : ''}" data-kpi="${k.key}" role="button" tabindex="0" title="Як рахується">
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

  // ---------- Кольори графіків ----------
  // Палітра перевірена скілом dataviz (validate_palette.js, темний фон #222830):
  // усі 5 перевірок PASS, зокрема розрізнення для дальтоніків між сусідніми кольорами.
  // Колір закріплений за групою грошей і не змінюється від фільтрів.
  const VIZ = {
    trip: '#3987e5',    // витрати на рейс
    pay: '#199e70',     // зарплати
    partner: '#9085e9', // компаньйону
    owner: '#c98500',   // ваш прибуток
    loss: '#ef6a5b',    // збиток (статус)
    surface: '#232931',
    muted: '#7a828b',
    accent: '#efba18',
    text2: '#c3c5c4',
  };
  /** Розкладає суму фрахту на 4 групи: разом вони дорівнюють фрахту. */
  function moneyGroups(s) {
    return {
      trip: s.fuelCost + s.tax + s.sto + s.repair + s.other + s.monthlyExpenses,
      pay: s.driverPay + s.logistPay + s.perDiem,
      partner: s.partnerShare,
      owner: s.ownerProfit,
    };
  }
  const GROUP_NAMES = { trip: 'Витрати на рейс', pay: 'Зарплати', partner: 'Компаньйону', owner: 'Ваш прибуток' };
  const shortMoney = (v) => (Math.abs(v) >= 1000 ? fmtL.format(v / 1000) + 'к' : fmtInt.format(Math.round(v)));
  /** Текст поверх кольору: темний або білий — що контрастніше. */
  function inkOn(hex) {
    const c = hex.replace('#', '').match(/../g).map((x) => { const v = parseInt(x, 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    const L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    return (L + 0.05) / 0.05 > 1.05 / (L + 0.05) ? '#14171c' : '#ffffff';
  }

  /** Помісячний ряд (до 12 місяців підряд) для графіка і міні-трендів.
      Враховує фільтри водія/авто/пошуку, але не періоду — щоб було видно тренд. */
  function monthTrend() {
    const groups = new Map();
    for (const t of filteredTrips(true)) {
      const k = (t.startDate || '').slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(k)) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    }
    if (!groups.size) return { keys: [], sums: [], sel: [] };
    const sorted = Array.from(groups.keys()).sort();
    const all = [];
    let [y, m] = sorted[0].split('-').map(Number);
    const [ly, lm] = sorted[sorted.length - 1].split('-').map(Number);
    while (y < ly || (y === ly && m <= lm)) {
      all.push(`${y}-${String(m).padStart(2, '0')}`);
      m++; if (m > 12) { m = 1; y++; }
    }
    const isSel = (k) => { const [yy, mm] = k.split('-'); return (filter.year === 'all' || filter.year === yy) && (filter.month === 'all' || filter.month === mm); };
    // Показуємо останні 12 місяців; вікно зсувається назад, лише якщо вибраний період у них не влазить
    let end = all.length;
    if (filter.year !== 'all' || filter.month !== 'all') {
      let lastSel = -1;
      for (let i = all.length - 1; i >= 0; i--) if (isSel(all[i])) { lastSel = i; break; }
      if (lastSel >= 0 && lastSel < all.length - 12) end = lastSel + 1;
    }
    const keys = all.slice(Math.max(0, end - 12), end);
    return { keys, sums: keys.map((k) => summarize(groups.get(k) || [], settings)), sel: keys.map(isSel) };
  }
  const monthLabel = (k, long) => { const [y, m] = k.split('-'); return long ? `${MONTHS[+m - 1]} ${y}` : `${MONTHS_SHORT[+m - 1]} ${y.slice(2)}`; };

  // ---------- Структура: куди йдуть гроші ----------
  function renderStructure(s) {
    const g = moneyGroups(s);
    const base = s.freight;
    const pct = (v) => (base > 0 ? (v / base) * 100 : 0);
    const groups = [
      { id: 'trip', items: [
        { key: 'fuel', label: 'Паливо', v: s.fuelCost }, { key: 'tax', label: 'Податок', v: s.tax },
        { key: 'sto', label: 'СТО', v: s.sto }, { key: 'repair', label: 'Ремонт', v: s.repair },
        { key: 'other', label: 'Інші витрати', v: s.other },
        ...(s.monthlyExpenses ? [{ key: 'monthly', label: 'Щомісячні витрати', v: s.monthlyExpenses }] : []),
      ] },
      { id: 'pay', items: [
        { key: 'driverPay', label: 'ЗП водія', v: s.driverPay }, { key: 'logistPay', label: 'ЗП логіста', v: s.logistPay },
        { key: 'perDiem', label: 'Добові', v: s.perDiem },
      ] },
      { id: 'partner', key: 'partner', items: [] },
      { id: 'owner', key: 'owner', items: [] },
    ];

    // Висока сегментована смужка: весь фрахт, порізаний на 4 частини
    const parts = groups.filter((x) => g[x.id] > 0);
    const whole = parts.reduce((a, x) => a + g[x.id], 0) || 1;
    $('#structBar').innerHTML = parts.map((x) => {
      const share = pct(g[x.id]);
      const tip = `${GROUP_NAMES[x.id]}: ${uah(g[x.id])} (${fmtL.format(share)}% фрахту)`;
      return `<div class="seg" data-w="${(g[x.id] / whole) * 100}" style="width:${(g[x.id] / whole) * 100}%;background:${VIZ[x.id]};color:${inkOn(VIZ[x.id])}" title="${tip}" aria-label="${tip}" tabindex="0"
          ${x.key ? `data-kpi="${x.key}" role="button"` : 'role="img"'}><span>${fmtL.format(share)}%</span></div>`;
    }).join('');
    $('#structBar').setAttribute('aria-label', 'Куди йде фрахт: ' + parts.map((x) => `${GROUP_NAMES[x.id]} ${fmtL.format(pct(g[x.id]))}%`).join(', '));
    $('#structLoss').innerHTML = g.owner < 0
      ? `<i data-lucide="alert-circle" class="h-4 w-4"></i><span>Збиток ${uah(-g.owner)}: витрати й зарплати перевищили фрахт</span>`
      : '';
    $('#structLoss').classList.toggle('hidden', g.owner >= 0);
    $('#structLegend').innerHTML = groups.map((x) => `<span class="lg-item"><i class="lg-sw" style="background:${VIZ[x.id]}"></i>${GROUP_NAMES[x.id]}</span>`).join('');

    // Список по групах
    $('#structure').innerHTML = groups.map((x) => {
      const head = `
        <div class="sg-head ${x.key ? 'struct-row' : ''}" ${x.key ? `data-kpi="${x.key}" role="button" tabindex="0" title="Як рахується"` : ''}>
          <span class="flex min-w-0 items-center gap-2"><i class="lg-sw" style="background:${VIZ[x.id]}"></i><span class="truncate">${GROUP_NAMES[x.id]}</span></span>
          <span class="num shrink-0 font-semibold ${g[x.id] < 0 ? 'text-loss' : 'text-white'}">${uah(g[x.id])}<span class="ml-1.5 text-xs font-normal text-slate-500">${fmtL.format(pct(g[x.id]))}%</span></span>
        </div>`;
      const items = x.items.map((r) => `
        <div class="sg-item struct-row" data-kpi="${r.key}" role="button" tabindex="0" title="Як рахується">
          <div class="flex items-center justify-between gap-3 text-sm">
            <span class="text-slate-300">${r.label}</span>
            <span class="num text-slate-200">${uah(r.v)}<span class="ml-1.5 inline-block w-11 text-right text-xs text-slate-500">${fmtL.format(pct(r.v))}%</span></span>
          </div>
          <div class="bar"><i style="width:${Math.max(0, Math.min(100, pct(r.v)))}%;background:${VIZ[x.id]}"></i></div>
        </div>`).join('');
      return `<div class="sg">${head}${items}</div>`;
    }).join('');

    const pays = [
      { label: 'Готівка', v: s.cash, icon: 'banknote' },
      { label: 'Безнал', v: s.bank, icon: 'landmark' },
      { label: 'Карта', v: s.card, icon: 'credit-card' },
      ...(s.dispatch ? [{ label: 'Диспетчерські', v: -s.dispatch, icon: 'hand-coins' }] : []),
    ];
    $('#payments').innerHTML = pays.map((p) => `
      <div class="flex items-center justify-between text-sm">
        <span class="flex items-center gap-2 text-slate-400"><i data-lucide="${p.icon}" class="h-4 w-4 text-slate-400"></i>${p.label}</span>
        <span class="num font-semibold text-white">${p.v < 0 ? '− ' + uah(-p.v) : uah(p.v)}</span>
      </div>`).join('');
    requestAnimationFrame(fitSegLabels);
  }

  /** Підпис усередині сегмента — лише якщо він повністю влазить. */
  function fitSegLabels() {
    // Ширину беремо «кінцеву» (data-w), бо смужки можуть ще рости в анімації
    const barW = $('#structBar').clientWidth;
    $$('#structBar .seg').forEach((seg) => {
      const label = seg.firstElementChild;
      if (!label) return;
      const w = (parseFloat(seg.dataset.w) / 100) * barW;
      label.style.visibility = !barW || label.scrollWidth + 16 > w ? 'hidden' : '';
    });
  }
  let fitTimer = 0;
  window.addEventListener('resize', () => { clearTimeout(fitTimer); fitTimer = setTimeout(fitSegLabels, 150); });

  // ---------- Графік: куди пішов фрахт по місяцях ----------
  // Підпис суми «ваш прибуток» над кожним стовпчиком
  const capLabels = {
    id: 'capLabels',
    afterDatasetsDraw(c) {
      const meta = c.getDatasetMeta(0);
      if (!meta.data.length) return;
      const slot = c.chartArea.width / meta.data.length;
      if (slot < 36) return;
      const { ctx } = c;
      const y = c.scales.y;
      ctx.save();
      ctx.font = '600 11px Onest, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      meta.data.forEach((bar, i) => {
        const vals = c.data.datasets.map((d) => d.data[i] || 0);
        const top = vals.reduce((a, v) => a + Math.max(0, v), 0);
        const owner = vals[3];
        ctx.fillStyle = owner < 0 ? VIZ.loss : (c.$sel && !c.$sel[i] ? VIZ.muted : VIZ.text2);
        ctx.fillText(shortMoney(owner), bar.x, y.getPixelForValue(top) - 6);
      });
      ctx.restore();
    },
  };

  function renderChart() {
    const canvas = $('#monthlyChart');
    const empty = $('#chartEmpty');
    if (!window.Chart) { empty.textContent = 'Графік недоступний (немає інтернету)'; empty.style.display = 'grid'; return; }

    const trend = monthTrend();
    const { keys, sums, sel } = trend;
    empty.style.display = keys.length ? 'none' : 'grid';
    const G = sums.map(moneyGroups);
    const anySel = filter.year !== 'all' || filter.month !== 'all';
    const dim = (hex, i) => (anySel && !sel[i] ? hex + '59' : hex); // невибрані місяці — блідіші

    const ds = (id, extra = {}) => ({
      label: GROUP_NAMES[id], data: G.map((x) => x[id]), stack: 'f',
      backgroundColor: (ctx) => {
        const v = ctx.raw;
        return dim(id === 'owner' && v < 0 ? VIZ.loss : VIZ[id], ctx.dataIndex);
      },
      borderColor: VIZ.surface, borderSkipped: false, maxBarThickness: 24, categoryPercentage: .7, barPercentage: .9,
      ...extra,
    });
    const data = {
      labels: keys.map((k) => monthLabel(k)),
      datasets: [
        ds('trip', { borderWidth: 0, borderRadius: 0 }),
        ds('pay', { borderWidth: { bottom: 2 }, borderRadius: 0 }),
        ds('partner', { borderWidth: { bottom: 2 }, borderRadius: 0 }),
        ds('owner', {
          borderWidth: (ctx) => (ctx.raw < 0 ? { top: 2 } : { bottom: 2 }),
          borderRadius: (ctx) => (ctx.raw < 0 ? { bottomLeft: 4, bottomRight: 4 } : { topLeft: 4, topRight: 4 }),
        }),
      ],
    };

    renderChartTable(keys, sums, G);

    if (chart) { chart.$sel = sel; chart.$keys = keys; chart.$sums = sums; chart.data = data; chart.update(); return; }

    Chart.defaults.color = VIZ.muted;
    Chart.defaults.font.family = 'Onest, system-ui, sans-serif';
    chart = new Chart(canvas, {
      type: 'bar',
      data,
      plugins: [capLabels],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 22 } },
        interaction: { mode: 'index', intersect: false },
        onClick: (evt, els, c) => {
          const hit = c.getElementsAtEventForMode(evt, 'index', { intersect: false }, false)[0];
          if (!hit) return;
          const [yy, mm] = c.$keys[hit.index].split('-');
          if (filter.year === yy && filter.month === mm) { filter.year = 'all'; filter.month = 'all'; }
          else { filter.year = yy; filter.month = mm; }
          renderAll();
        },
        onHover: (evt, els, c) => { c.canvas.style.cursor = c.getElementsAtEventForMode(evt, 'index', { intersect: false }, false).length ? 'pointer' : 'default'; },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#2a313a', borderColor: 'rgba(242,240,234,.14)', borderWidth: 1, padding: 12,
            titleColor: '#f2f0ea', bodyColor: '#dcdbd5', footerColor: '#f2f0ea',
            titleFont: { weight: '600' }, footerFont: { weight: '600' }, boxPadding: 4, usePointStyle: true,
            itemSort: (a, b) => b.datasetIndex - a.datasetIndex,
            callbacks: {
              title: (items) => monthLabel(chart.$keys[items[0].dataIndex], true),
              label: (ctx) => ` ${ctx.dataset.label}: ${uah(ctx.parsed.y)}`,
              labelColor: (ctx) => { const col = ctx.raw < 0 && ctx.datasetIndex === 3 ? VIZ.loss : VIZ[['trip', 'pay', 'partner', 'owner'][ctx.datasetIndex]]; return { borderColor: col, backgroundColor: col }; },
              footer: (items) => `Фрахт: ${uah(chart.$sums[items[0].dataIndex].freight)}\nНатисніть, щоб вибрати місяць`,
            },
          },
        },
        scales: {
          x: { stacked: true, grid: { display: false }, border: { display: false }, ticks: { color: VIZ.muted, maxRotation: 0, autoSkipPadding: 6 } },
          y: {
            stacked: true,
            grid: { color: 'rgba(242,240,234,.07)', lineWidth: 1 }, border: { display: false },
            ticks: { color: VIZ.muted, maxTicksLimit: 6, callback: (v) => (Math.abs(v) >= 1000 ? fmtL.format(v / 1000) + 'к' : v) },
          },
        },
      },
    });
    chart.$sel = sel; chart.$keys = keys; chart.$sums = sums;
    chart.update('none');
  }

  /** Таблиця — те саме, що й графік, для точних цифр. */
  function renderChartTable(keys, sums, G) {
    $('#chartTable').innerHTML = keys.length ? `
      <table class="w-full text-sm">
        <thead><tr class="text-left text-xs text-slate-400">
          <th class="py-2 pr-3 font-medium">Місяць</th><th class="py-2 pr-3 text-right font-medium">Фрахт</th>
          ${['trip', 'pay', 'partner', 'owner'].map((id) => `<th class="py-2 pr-3 text-right font-medium"><i class="lg-sw mr-1.5" style="background:${VIZ[id]}"></i>${GROUP_NAMES[id]}</th>`).join('')}
        </tr></thead>
        <tbody class="divide-y divide-white/5">
          ${keys.map((k, i) => `<tr>
            <td class="py-2 pr-3 text-slate-300">${monthLabel(k, true)}</td>
            <td class="num py-2 pr-3 text-right text-white">${uah(sums[i].freight)}</td>
            ${['trip', 'pay', 'partner', 'owner'].map((id) => `<td class="num py-2 pr-3 text-right ${G[i][id] < 0 ? 'text-loss' : 'text-slate-200'}">${uah(G[i][id])}</td>`).join('')}
          </tr>`).join('')}
        </tbody>
      </table>` : '<p class="py-6 text-center text-sm text-slate-500">Немає даних</p>';
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
    if (!$('#kpiModal').classList.contains('hidden')) renderKpiInfo();
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
    if (v === 'dashboard') setTimeout(() => { if (chart) chart.resize(); fitSegLabels(); }, 0);
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
      ? `<span class="plate-line plate-lg">${plateHtml(plate)}${brand ? `<span class="plate-brand">${escapeHtml(brand)}</span>` : ''}</span>`
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
          (c.dispatch ? sep + row('Отримано всього', uah2(c.received)) + row('Диспетчерські', '− ' + uah2(c.dispatch), 'text-orange-300') : '') +
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
  const FIELDS = ['driverId', 'carId', 'startDate', 'endDate', 'route', 'odoStart', 'odoEnd', 'fuelLiters', 'fuelPrice', 'fuelPriceActual', 'cash', 'bank', 'card', 'dispatch', 'repairExpenses', 'otherExpenses', 'note', 'perDiem', 'stoRate', 'taxRate', 'driverRate', 'partnerRate', 'logistRate'];
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
    resetReport();
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
        for (const f of ['cash', 'bank', 'card', 'dispatch']) tripForm.elements[f].value = '';
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
      c.dispatch ? row('Отримано всього', uah2(c.received)) : '',
      c.dispatch ? row('Диспетчерські', '− ' + uah2(c.dispatch), 'text-orange-300') : '',
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

  // ---------- Звіт логіста з Телеграму ----------
  const reportInput = $('#reportInput');
  const reportResult = $('#reportResult');

  function resetReport() {
    reportInput.value = '';
    reportResult.className = 'mt-2 hidden rounded-xl border px-3 py-2 text-xs';
    reportResult.innerHTML = '';
  }

  function applyReport() {
    const text = reportInput.value.trim();
    if (!text) { resetReport(); return; }
    const r = window.Report.parse(text);
    const el = tripForm.elements;
    const got = r.cash + r.bank + r.card;
    const notes = [];

    if (r.startDate) {
      el.startDate.value = r.startDate;
      // Кінець рейсу — зі звіту, або той самий день (далі уточнюється вручну)
      el.endDate.value = r.endDate || r.startDate;
    }
    if (r.route) el.route.value = r.route;
    if (got > 0 || r.dispatch > 0) {
      el.cash.value = r.cash || '';
      el.bank.value = r.bank || '';
      el.card.value = r.card || '';
      el.dispatch.value = r.dispatch || '';
    }

    const ok = got > 0;
    if (ok) {
      const parts = [
        `<b>${r.orders} ${plural(r.orders, 'замовлення', 'замовлення', 'замовлень')}</b>`,
        r.cash ? `готівка ${uah(r.cash)}` : '',
        r.bank ? `безнал ${uah(r.bank)}` : '',
        r.card ? `карта ${uah(r.card)}` : '',
        r.dispatch ? `диспетчерські − ${uah(r.dispatch)}` : 'диспетчерських у звіті не знайдено',
      ].filter(Boolean);
      notes.push('✓ Розпізнано: ' + parts.join(' · ') + ` → фрахт <b>${uah(got - r.dispatch)}</b>`);
      if (!r.startDate) notes.push('Дату не знайдено — вкажіть вручну.');
      else if (!r.endDate) notes.push('Дату кінця поставив таку ж, як початок — виправте, якщо рейс був довший.');
    } else {
      notes.push('Не вдалося знайти суми. Рядки мають виглядати так: «12000грн / безнал», «7000грн / наличка», «-1000грн / диспетчерских».');
    }
    if (r.remainders.length) notes.push('Залишок після диспетчерських (не рахується повторно): ' + r.remainders.map((l) => `«${escapeHtml(l)}»`).join(', '));
    if (r.unknown.length) notes.push('Не зрозумів, як оплачено (пропущено): ' + r.unknown.map((l) => `«${escapeHtml(l)}»`).join(', '));

    reportResult.className = 'mt-2 rounded-xl border px-3 py-2 text-xs leading-relaxed space-y-1 ' + (ok && !r.unknown.length
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
      : 'border-amber-500/30 bg-amber-500/10 text-amber-200');
    reportResult.innerHTML = notes.map((n) => `<div>${n}</div>`).join('');
    clearErrors();
    updatePreview();
  }

  reportInput.addEventListener('input', (e) => {
    e.stopPropagation();
    applyReport();
  });

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
    for (const f of ['fuelLiters', 'fuelPrice', 'fuelPriceActual', 'cash', 'bank', 'card', 'dispatch', 'repairExpenses', 'otherExpenses', 'perDiem', 'stoRate', 'taxRate', 'driverRate', 'partnerRate', 'logistRate']) {
      if (d[f] !== '' && d[f] < 0) { errors.push('Значення не можуть бути відʼємними.'); mark(f); break; }
    }
    if (num(d.dispatch) > num(d.cash) + num(d.bank) + num(d.card)) { errors.push('Диспетчерські більші за отриману суму.'); mark('dispatch'); }
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

    const i = editingId ? trips.findIndex((t) => t.id === editingId) : -1;
    if (i >= 0) {
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
    const head = ['Дата початку', 'Дата кінця', 'Водій', 'Авто', 'Маршрут', 'Одометр поч.', 'Одометр кін.', 'Км', 'Діб', 'Паливо, л', 'Ціна палива для водія', 'Фактична ціна палива', 'Паливо для водія, грн', 'Паливо фактично, грн', 'Знижка на паливо', 'Готівка', 'Безнал', 'Карта', 'Диспетчерські', 'Фрахт (без диспетчерських)', 'Грн/км', 'Податок', 'Добові', 'СТО', 'Ремонт', 'Інші витрати', 'Прибуток авто', 'ЗП водія', 'ЗП логіста', 'Чистий прибуток бізнесу', 'Компаньйону', 'Ваш прибуток', 'Нотатка'];
    const cell = (v) => {
      const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? '');
      return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [head.join(';')];
    for (const t of list) {
      const c = calcTrip(t, settings);
      lines.push([fmtDate(t.startDate), fmtDate(t.endDate), tripDriver(t), tripCar(t), t.route, num(t.odoStart), num(t.odoEnd), c.km, c.days, c.fuelLiters, c.fuelPrice, c.fuelPriceActual, c.fuelCostDriver, c.fuelCost, c.fuelDiscount, c.cash, c.bank, c.card, c.dispatch, c.freight, c.pricePerKm, c.tax, c.perDiem, c.sto, c.repair, c.other, c.carProfit, c.driverPay, c.logistPay, c.netProfit, c.partnerShare, c.ownerProfit, t.note].map(cell).join(';'));
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

  // ---------- Пояснення показників (клік по блоку панелі) ----------
  let kpiOpenKey = null;
  const pctF = (n) => fmtL.format(n) + '%';

  /** Однакова ставка в усіх рейсах — повертає її, інакше null. */
  function sameRate(cs, key) {
    if (!cs.length) return num(settings[key]);
    const v = cs[0].c.rates[key];
    return cs.every((x) => x.c.rates[key] === v) ? v : null;
  }

  /** Опис кожного показника: що це, рядки розрахунку, примітки, значення по рейсах. */
  function kpiInfo(key, s, cs) {
    const posSum = (f) => cs.reduce((a, x) => a + Math.max(0, f(x.c)), 0);
    const rateRow = (op, label, rk, hint, money) => {
      const r = sameRate(cs, rk);
      return { op, label, hint, value: r === null ? 'різна в рейсах' : money ? uah(r) + ' / доба' : pctF(r) };
    };
    const monthlyRow = {
      op: '−', label: 'Щомісячні витрати', value: s.monthlyExpenses, kpi: 'monthly',
      hint: s.monthlyRate ? `${uah(s.monthlyRate)} × ${s.months} ${plural(s.months, 'місяць', 'місяці', 'місяців')}` : 'не задані в «Ставках»',
    };
    const I = {
      net: {
        title: 'Чистий прибуток бізнесу', icon: 'trending-up', total: s.netProfit,
        what: 'Скільки заробив бізнес після палива, податку, СТО, ремонту і всіх зарплат — але до виплати компаньйону.',
        rows: [
          { label: 'Прибуток авто', hint: 'фрахт мінус паливо (ціна для водія), добові, ремонт, інші', value: s.carProfit, kpi: 'carProfit' },
          { op: '+', label: 'Знижка на паливо', hint: 'різниця між ціною для водія і фактичною', value: s.fuelDiscount, kpi: 'fuel' },
          { op: '−', label: 'Податок', hint: 'від безналу', value: s.tax, kpi: 'tax' },
          { op: '−', label: 'СТО', hint: 'за кожну добу в рейсі', value: s.sto, kpi: 'sto' },
          { op: '−', label: 'ЗП водія', value: s.driverPay, kpi: 'driverPay' },
          { op: '−', label: 'ЗП логіста', value: s.logistPay, kpi: 'logistPay' },
          monthlyRow,
        ],
        notes: [
          s.freight > 0 ? `Рентабельність ${pctF((s.netProfit / s.freight) * 100)} — стільки з кожної гривні фрахту лишається бізнесу.` : null,
          'Щомісячні витрати віднімаються лише в сумі за період, тому в списку рейсів нижче їх немає.',
        ],
        perTrip: (c) => c.netProfit,
      },
      partner: {
        title: 'Компаньйону', icon: 'handshake', total: s.partnerShare,
        what: 'Частка компаньйона — відсоток від чистого прибутку кожного рейсу.',
        rows: [
          { label: 'Чистий прибуток прибуткових рейсів', hint: 'збиткові рейси не враховуються', value: posSum((c) => c.netProfit) },
          rateRow('×', 'Ставка компаньйона', 'partnerRate', 'змінюється в «Ставках»'),
        ],
        notes: ['Якщо рейс збитковий, компаньйону з нього 0 ₴.', 'Щомісячні витрати на частку компаньйона не впливають — їх покриває ваш прибуток.'],
        perTrip: (c) => c.partnerShare,
      },
      owner: {
        title: 'Ваш прибуток', icon: 'piggy-bank', total: s.ownerProfit,
        what: 'Що лишається вам: чистий прибуток бізнесу після виплати компаньйону.',
        rows: [
          { label: 'Чистий прибуток бізнесу', hint: s.monthlyExpenses ? 'уже з урахуванням щомісячних витрат' : null, value: s.netProfit, kpi: 'net' },
          { op: '−', label: 'Компаньйону', value: s.partnerShare, kpi: 'partner' },
        ],
        notes: s.freight > 0 ? [`З кожної гривні фрахту вам лишається ${fmtDec.format(s.ownerProfit / s.freight)} ₴.`] : [],
        perTrip: (c) => c.ownerProfit,
      },
      freight: {
        title: 'Сума фрахту', icon: 'wallet', total: s.freight,
        what: 'Скільки реально заробили рейси: усі гроші від замовників мінус диспетчерські посереднику.',
        rows: [
          { label: 'Готівка', hint: 'поле «Готівка» у рейсі', value: s.cash },
          { op: '+', label: 'Безнал', hint: 'поле «Безнал» — з нього рахується податок', value: s.bank, kpi: 'tax' },
          { op: '+', label: 'Карта', hint: 'поле «Карта»', value: s.card },
          { op: '−', label: 'Диспетчерські', hint: 'віддали посереднику за замовлення', value: s.dispatch },
        ],
        notes: [`Усього отримано ${uah(s.received)} за ${s.count} ${plural(s.count, 'рейс', 'рейси', 'рейсів')}.`, 'Від фрахту рахуються ЗП логіста, ЗП водія і весь прибуток.'],
        perTrip: (c) => c.freight,
      },
      driverPay: {
        title: 'ЗП водія', icon: 'user-round', total: s.driverPay,
        what: 'Зарплата водія — відсоток від прибутку авто кожного рейсу.',
        rows: [
          { label: 'Прибуток авто прибуткових рейсів', hint: 'збиткові рейси не враховуються', value: posSum((c) => c.carProfit), kpi: 'carProfit' },
          rateRow('×', 'Ставка водія', 'driverRate'),
        ],
        notes: [`Добові (${uah(s.perDiem)}) платяться окремо і в цю суму не входять.`, 'Паливо для ЗП рахується за ціною для водія, а не фактичною.', 'СТО і податок на ЗП водія не впливають.'],
        perTrip: (c) => c.driverPay,
      },
      logistPay: {
        title: 'ЗП логіста', icon: 'headset', total: s.logistPay,
        what: 'Зарплата логіста — відсоток від суми фрахту.',
        rows: [
          { label: 'Фрахт', value: s.freight, kpi: 'freight' },
          rateRow('×', 'Ставка логіста', 'logistRate'),
        ],
        notes: ['На ЗП водія не впливає. Віднімається з чистого прибутку бізнесу.'],
        perTrip: (c) => c.logistPay,
      },
      monthly: {
        title: 'Щомісячні витрати', icon: 'calendar-check', total: s.monthlyExpenses,
        what: 'Постійні витрати бізнесу (бухгалтер, страховка тощо), які ви вказали в «Ставках».',
        rows: [
          { label: 'Сума на місяць', hint: 'поле в «Ставках»', value: s.monthlyRate },
          { op: '×', label: 'Місяців з рейсами', hint: 'місяць рахується за датою початку рейсу', value: `${s.months}` },
        ],
        notes: ['Віднімаються від чистого прибутку бізнесу і вашого прибутку. На частку компаньйона не впливають.'],
        perTrip: null,
      },
      pricePerKm: {
        title: 'Ціна за 1 км', icon: 'route', total: uah2(s.pricePerKm),
        what: 'Скільки фрахту приносить кожен кілометр пробігу.',
        rows: [
          { label: 'Фрахт', value: s.freight, kpi: 'freight' },
          { op: '÷', label: 'Пробіг', hint: 'кінцевий одометр мінус початковий', value: `${fmtInt.format(s.km)} км` },
        ],
        notes: [],
        perTrip: (c) => uah2(c.pricePerKm), sortBy: (c) => c.pricePerKm,
      },
      fuel: {
        title: 'Паливо (фактично)', icon: 'fuel', total: s.fuelCost,
        what: 'Скільки бізнес реально заплатив за паливо — за ціною зі знижкою.',
        rows: [
          { label: 'Літрів за всі рейси', hint: 'поле «Витрата палива»', value: `${fmtL.format(s.fuelLiters)} л` },
          { op: '×', label: 'Середня фактична ціна', hint: 'поле «Фактична ціна» (порожнє = ціна для водія); округлено до копійки', value: s.fuelLiters ? '≈ ' + uah2(s.fuelCost / s.fuelLiters) + ' / л' : '—' },
        ],
        notes: [
          `За ціною для водія вийшло б ${uah(s.fuelCostDriver)}. Різниця ${uah(s.fuelDiscount)} — ваша економія, вона додається до чистого прибутку.`,
          s.km > 0 ? `Середня витрата ${fmtL.format(s.fuelPer100)} л на 100 км.` : null,
        ],
        perTrip: (c) => c.fuelCost,
      },
      sto: {
        title: 'СТО', icon: 'hammer', total: s.sto,
        what: 'Гроші, які відкладаються на обслуговування авто за кожну добу в рейсі.',
        rows: [
          { label: 'Діб у рейсах', value: `${fmtInt.format(s.days)}`, kpi: 'days' },
          rateRow('×', 'Ставка СТО', 'stoRate', null, true),
        ],
        notes: ['Віднімається з чистого прибутку бізнесу. На ЗП водія не впливає.'],
        perTrip: (c) => c.sto,
      },
      repair: {
        title: 'Ремонт', icon: 'wrench', total: s.repair,
        what: 'Фактичні витрати на ремонт, які ви вписали в рейси.',
        rows: [{ label: 'Сума поля «Витрати на ремонт»', hint: 'з усіх рейсів за період', value: s.repair }],
        notes: [s.km > 0 ? `Це ${fmtDec.format(s.repair / s.km)} ₴ на кожен кілометр.` : null, 'Ремонт зменшує прибуток авто, тож трохи зменшує і ЗП водія.'],
        perTrip: (c) => c.repair,
      },
      tax: {
        title: 'Податок', icon: 'landmark', total: s.tax,
        what: 'Податок платиться лише з безготівкових надходжень.',
        rows: [
          { label: 'Безнал', hint: 'поле «Безнал» у рейсах', value: s.bank },
          rateRow('×', 'Ставка податку', 'taxRate'),
        ],
        notes: ['Готівка і карта податком не обкладаються.', 'Податок віднімається з чистого прибутку бізнесу, на ЗП водія не впливає.'],
        perTrip: (c) => c.tax,
      },
      days: {
        title: 'Діб у рейсах', icon: 'calendar-clock', total: `${fmtInt.format(s.days)} ${plural(s.days, 'доба', 'доби', 'діб')}`,
        what: 'Скільки діб авто було в дорозі за період.',
        rows: [{ label: 'Сума діб по рейсах', hint: 'дата кінця мінус дата початку; рейс в один день = 1 доба', value: `${fmtInt.format(s.days)}` }],
        notes: [`З діб рахуються добові водія (${uah(s.perDiem)}) і СТО (${uah(s.sto)}).`],
        perTrip: (c) => `${c.days} ${plural(c.days, 'доба', 'доби', 'діб')}`, sortBy: (c) => c.days,
      },
      perDiem: {
        title: 'Добові', icon: 'calendar-clock', total: s.perDiem,
        what: 'Добові водія — фіксована сума за кожну добу в рейсі, окремо від ЗП.',
        rows: [
          { label: 'Діб у рейсах', value: `${fmtInt.format(s.days)}`, kpi: 'days' },
          rateRow('×', 'Добові', 'perDiem', null, true),
        ],
        notes: ['Добові зменшують прибуток авто, з якого рахується ЗП водія.'],
        perTrip: (c) => c.perDiem,
      },
      other: {
        title: 'Інші витрати', icon: 'receipt', total: s.other,
        what: 'Дороги, стоянки та інші дрібні витрати в рейсах.',
        rows: [{ label: 'Сума поля «Інші витрати»', hint: 'з усіх рейсів за період', value: s.other }],
        notes: ['Зменшують прибуток авто, а отже і ЗП водія.'],
        perTrip: (c) => c.other,
      },
      carProfit: {
        title: 'Прибуток авто', icon: 'truck', total: s.carProfit,
        what: 'Скільки заробило авто до зарплат, податку і СТО. З цієї суми рахується ЗП водія.',
        rows: [
          { label: 'Фрахт', value: s.freight, kpi: 'freight' },
          { op: '−', label: 'Паливо за ціною для водія', hint: 'літри × ціна для водія', value: s.fuelCostDriver, kpi: 'fuel' },
          { op: '−', label: 'Добові', value: s.perDiem, kpi: 'perDiem' },
          { op: '−', label: 'Інші витрати', value: s.other, kpi: 'other' },
          { op: '−', label: 'Ремонт', value: s.repair, kpi: 'repair' },
        ],
        notes: ['СТО і податок тут не віднімаються — щоб не зменшувати ЗП водія.'],
        perTrip: (c) => c.carProfit,
      },
      totalExpenses: {
        title: 'Усі витрати', icon: 'receipt', total: s.totalExpenses,
        what: 'Усе, що пішло з фрахту, крім частки компаньйона і вашого прибутку.',
        rows: [
          { label: 'Паливо (фактично)', value: s.fuelCost, kpi: 'fuel' },
          { op: '+', label: 'Податок', value: s.tax, kpi: 'tax' },
          { op: '+', label: 'Добові', value: s.perDiem, kpi: 'perDiem' },
          { op: '+', label: 'СТО', value: s.sto, kpi: 'sto' },
          { op: '+', label: 'Ремонт', value: s.repair, kpi: 'repair' },
          { op: '+', label: 'Інші витрати', value: s.other, kpi: 'other' },
          { op: '+', label: 'ЗП водія', value: s.driverPay, kpi: 'driverPay' },
          { op: '+', label: 'ЗП логіста', value: s.logistPay, kpi: 'logistPay' },
          Object.assign({}, monthlyRow, { op: '+' }),
        ],
        notes: ['Частка компаньйона сюди не входить — це розподіл прибутку, а не витрата.'],
        perTrip: (c) => c.totalExpenses,
      },
    };
    return I[key] || null;
  }

  function renderKpiInfo() {
    const key = kpiOpenKey;
    const list = filteredTrips();
    const s = summarize(list, settings);
    const cs = list.map((t) => ({ t, c: calcTrip(t, settings) }));
    const info = kpiInfo(key, s, cs);
    if (!info) return;
    const money = (v) => (typeof v === 'number' ? uah(v) : escapeHtml(v));
    const isNeg = (v) => typeof v === 'number' && v < 0;
    const totalTxt = money(info.total);

    $('#kpiTitle').textContent = info.title;
    $('#kpiPeriod').textContent = $('#periodLabel').textContent;
    $('#kpiIcon').innerHTML = `<i data-lucide="${info.icon}" class="h-5 w-5"></i>`;

    const rows = info.rows.map((r, i) => {
      const label = r.kpi && r.kpi !== key
        ? `<button type="button" class="kx-link" data-kpi="${r.kpi}" title="Як рахується «${escapeHtml(r.label)}»">${escapeHtml(r.label)}<i data-lucide="chevron-right" class="h-3.5 w-3.5"></i></button>`
        : `<span>${escapeHtml(r.label)}</span>`;
      return `<div class="kx-row" style="--i:${i}">
          <span class="kx-op">${r.op || ''}</span>
          <span class="kx-label">${label}${r.hint ? `<small>${escapeHtml(r.hint)}</small>` : ''}</span>
          <span class="kx-val num ${isNeg(r.value) ? 'text-loss' : ''}">${money(r.value)}</span>
        </div>`;
    }).join('');

    const notes = (info.notes || []).filter(Boolean);
    let tripsHtml = '';
    if (info.perTrip && cs.length) {
      const sortVal = info.sortBy || info.perTrip;
      const items = cs.slice().sort((a, b) => sortVal(b.c) - sortVal(a.c)).slice(0, 50);
      tripsHtml = `
        <section class="mt-7">
          <h4 class="kx-h">З яких рейсів складається <span class="font-normal text-slate-500">${cs.length}</span></h4>
          <div class="kx-trips">${items.map(({ t, c }) => {
            const v = info.perTrip(c);
            return `<button type="button" class="kx-trip" data-open="${escapeHtml(t.id)}">
                <span class="min-w-0">${tripHeading(t)}<span class="mt-1 block truncate text-xs text-slate-500">${escapeHtml(tripDates(t))} · ${escapeHtml(t.route || 'Без маршруту')}</span></span>
                <span class="num shrink-0 font-semibold ${isNeg(v) ? 'text-loss' : 'text-white'}">${money(v)}</span>
              </button>`;
          }).join('')}</div>
          ${cs.length > 50 ? '<p class="mt-2 text-xs text-slate-500">Показано 50 найбільших.</p>' : ''}
        </section>`;
    }

    $('#kpiBody').innerHTML = `
      <div class="kx-hero">
        <div class="kx-total num ${isNeg(info.total) ? 'text-loss' : ''}">${totalTxt}</div>
        <p class="kx-what">${escapeHtml(info.what)}</p>
      </div>
      <section class="mt-6">
        <h4 class="kx-h">Як рахується</h4>
        <div class="kx-calc">
          ${rows}
          <div class="kx-row kx-result" style="--i:${info.rows.length}">
            <span class="kx-op">=</span>
            <span class="kx-label"><span>${escapeHtml(info.title)}</span></span>
            <span class="kx-val num ${isNeg(info.total) ? 'text-loss' : ''}">${totalTxt}</span>
          </div>
        </div>
      </section>
      ${notes.length ? `<ul class="kx-notes">${notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>` : ''}
      ${!cs.length ? '<p class="mt-6 text-sm text-slate-500">За вибраний період рейсів немає — змініть фільтр угорі.</p>' : ''}
      ${tripsHtml}`;
    $('#kpiBody').scrollTop = 0;
    refreshIcons();
  }

  function openKpiInfo(key) {
    kpiOpenKey = key;
    renderKpiInfo();
    openModal($('#kpiModal'));
  }

  $('#chartViewBtn').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const table = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(table));
    btn.querySelector('span').textContent = table ? 'Графік' : 'Таблиця';
    btn.querySelector('i, .ic').outerHTML = `<i data-lucide="${table ? 'bar-chart-3' : 'list'}" class="h-4 w-4"></i>`;
    $('#chartBox').classList.toggle('hidden', table);
    $('#chartLegend').classList.toggle('hidden', table);
    $('#chartTable').classList.toggle('hidden', !table);
    refreshIcons();
  });

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
        case 'settings': $('#settingsBtn').click(); break;
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
    // Клік по блоку показника — вікно «як рахується»
    const kpi = e.target.closest('[data-kpi]');
    if (kpi) { openKpiInfo(kpi.dataset.kpi); return; }
    // Клік по рядку/картці рейсу — відкрити перегляд
    const open = e.target.closest('[data-open]');
    if (open) {
      if (open.closest('#kpiModal')) closeModal($('#kpiModal'));
      openTripView(open.dataset.open);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { const open = $$('.modal:not(.hidden)'); if (open.length) closeModal(open[open.length - 1]); }
    // Enter / пробіл на блоці показника
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[role="button"][data-kpi]')) {
      e.preventDefault();
      openKpiInfo(e.target.dataset.kpi);
    }
  });

  $('#yearFilter').addEventListener('change', (e) => { filter.year = e.target.value; renderAll(); });
  $('#monthFilter').addEventListener('change', (e) => { filter.month = e.target.value; renderAll(); });
  $('#driverFilter').addEventListener('change', (e) => { filter.driver = e.target.value; renderAll(); });
  $('#carFilter').addEventListener('change', (e) => { filter.car = e.target.value; renderAll(); });
  $('#search').addEventListener('input', (e) => { query = e.target.value; renderAll(); });

  // ---------- Синхронізація з хмарою ----------
  Cloud.on('error', () => toast('Не вдалося зберегти в хмару. Повторимо автоматично…', 'err'));
  // Дані змінено на іншому пристрої — оновлюємо стан і екран
  // (відкрита форма рейсу не скидається: її значення лишаються в полях)
  Cloud.on('remote', () => {
    loadState();
    renderAll();
    toast('Дані оновлено з хмари', 'info');
  });

  applyView();
  renderAll();
})();
