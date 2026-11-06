/* Облік рейсів — основна логіка інтерфейсу */
(function () {
  'use strict';

  const { calcTrip, summarize, DEFAULTS, num, ownerKey, ownerLedger } = window.Calc;

  const Cloud = window.Cloud;
  const MONTHS = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];
  const MONTHS_SHORT = ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру'];

  // ---------- Стан (дані з хмари, див. js/cloud.js) ----------
  // payouts — виплати власникам авто під управлінням. Зберігаються всередині settings
  // (рядок «settings» у хмарі), щоб не міняти схему бази даних.
  let trips, drivers, cars, settings, payouts;
  function loadState() {
    trips = Cloud.get('trips', []);
    drivers = Cloud.get('drivers', []);
    cars = Cloud.get('cars', []);
    settings = Object.assign({}, DEFAULTS, Cloud.get('settings', {}));
    payouts = Array.isArray(settings.payouts) ? settings.payouts.filter((p) => p && p.id && p.owner) : [];
  }
  loadState();
  let filter = { year: 'all', month: 'all', driver: 'all', car: 'all', kind: 'all' };
  let query = '';
  let editingId = null;
  let formSource = null;
  let chart = null;

  // ---------- Утиліти ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function saveTrips() { Cloud.set('trips', trips); }
  function saveSettings() { settings.payouts = payouts; Cloud.set('settings', settings); }
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

  // ---------- Авто під управлінням ----------
  const cleanName = (s) => String(s || '').trim().replace(/\s+/g, ' ');
  /** Чи є хоч одне авто/рейс під управлінням — тоді показуємо фільтр і блоки для власників. */
  const hasManaged = () => cars.some((c) => c.managed) || trips.some((t) => t.managed);
  /** Позначка «під управлінням» біля номера авто. */
  const mgmtBadge = (t) => (t.managed
    ? `<span class="badge mgmt-badge" title="Авто під управлінням · власник ${escapeHtml(t.ownerName || '—')}"><i data-lucide="key-round" class="h-3 w-3"></i>${escapeHtml(t.ownerName || 'не моє')} · ${fmtL.format(num(t.mgmtShare === '' || t.mgmtShare === undefined ? settings.mgmtShare : t.mgmtShare))}%</span>`
    : '');

  const fmtMoney = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 });
  const fmtDec = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtInt = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 });
  const fmtL = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 });

  const uah = (n) => fmtMoney.format(Math.round(n)) + ' ₴';
  const uah2 = (n) => fmtDec.format(n) + ' ₴';

  function fmtDate(iso) {
    if (!iso) return '—';
    const [y, m, d] = String(iso).split('-');
    return escapeHtml(`${d}.${m}.${y}`); // дата може прийти з файлу копії — екрануємо
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
        if (filter.kind === 'own' && t.managed) return false;
        if (filter.kind === 'managed' && !t.managed) return false;
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

    // Тип авто — лише коли є авто під управлінням
    const showKind = hasManaged();
    if (!showKind) filter.kind = 'all';
    $('#kindFilterWrap').style.display = showKind ? '' : 'none';
    $('#kindFilter').innerHTML = [['all', 'Мої + в управлінні'], ['own', 'Лише мої авто'], ['managed', 'Лише в управлінні']]
      .map(([v, n]) => `<option value="${v}" ${filter.kind === v ? 'selected' : ''}>${n}</option>`).join('');

    let label = 'Усі рейси';
    if (filter.year !== 'all' && filter.month !== 'all') label = `${MONTHS[+filter.month - 1]} ${filter.year}`;
    else if (filter.year !== 'all') label = `${filter.year} рік`;
    else if (filter.month !== 'all') label = `${MONTHS[+filter.month - 1]} (усі роки)`;
    const extra = [];
    if (filter.driver !== 'all') extra.push(drv.find((o) => o.id === filter.driver).name);
    if (filter.car !== 'all') extra.push(crs.find((o) => o.id === filter.car).name);
    if (filter.kind === 'own') extra.push('мої авто');
    if (filter.kind === 'managed') extra.push('авто в управлінні');
    $('#periodLabel').textContent = [label, ...extra].join(' · ');
  }

  // ---------- KPI ----------
  function renderKpis(s) {
    const main = [
      { key: 'net', label: '1. Чистий прибуток бізнесу', value: uah(s.netProfit), sub: s.freight > 0 ? `рентабельність ${fmtL.format((s.netProfit / s.freight) * 100)}%` + (s.monthlyExpenses ? ` · з урахуванням щомісячних ${uah(s.monthlyExpenses)}` : '') : '—', icon: 'trending-up', color: 'text-emerald-300 bg-emerald-500/15', glow: 'rgba(16,185,129,.22)', valueClass: profitClass(s.netProfit) },
      { key: 'partner', label: '2. Компаньйону', value: uah(s.partnerShare), sub: (s.netProfit + s.monthlyExpenses) > 0 ? `${fmtL.format((s.partnerShare / (s.netProfit + s.monthlyExpenses)) * 100)}% від чистого прибутку` + (s.monthlyExpenses ? ' (без щомісячних)' : '') : 'від чистого прибутку бізнесу', icon: 'handshake', color: 'text-pink-300 bg-pink-500/15', glow: 'rgba(236,72,153,.2)' },
      { key: 'owner', label: '3. Ваш прибуток', value: uah(s.ownerProfit), sub: s.monthlyExpenses ? 'після компаньйону та щомісячних витрат' : 'чистий прибуток бізнесу після компаньйону', icon: 'piggy-bank', color: 'text-lime-300 bg-lime-500/15', glow: 'rgba(132,204,22,.2)', valueClass: profitClass(s.ownerProfit) },
    ];
    // Є рейси авто під управлінням — показуємо, скільки з них ваше
    if (s.mgmtCount) main[0].sub = `мої авто ${uah(s.ownNet)} · в управлінні ${uah(s.mgmtNet)}`;
    const items = [
      { key: 'freight', label: 'Сума фрахту', value: uah(s.freight), sub: `${s.count} ${plural(s.count, 'рейс', 'рейси', 'рейсів')}` + (s.dispatch ? ` · без диспетчерських ${uah(s.dispatch)}` : ''), icon: 'wallet', color: 'text-indigo-300 bg-indigo-500/15', glow: 'rgba(99,102,241,.22)' },
      { key: 'driverPay', label: 'ЗП водія', value: uah(s.driverPay), sub: `+ добові ${uah(s.perDiem)}`, icon: 'user-round', color: 'text-amber-300 bg-amber-500/15', glow: 'rgba(245,158,11,.2)' },
      { key: 'logistPay', label: 'ЗП логіста', value: uah(s.logistPay), sub: (s.freight > 0 ? `${fmtL.format((s.logistPay / s.freight) * 100)}% від фрахту` : 'від суми фрахту') + ' · входить у чистий прибуток', icon: 'headset', color: 'text-fuchsia-300 bg-fuchsia-500/15', glow: 'rgba(217,70,239,.2)' },
      ...(s.mgmtCount ? [{ key: 'carOwner', label: 'Власникам авто', value: uah(s.carOwnerShare), sub: `нараховано за ${s.mgmtCount} ${plural(s.mgmtCount, 'рейс', 'рейси', 'рейсів')} · розрахунки у «Власники»`, icon: 'key-round', color: 'text-slate-200 bg-slate-400/15', glow: 'rgba(140,150,163,.2)', valueClass: s.carOwnerShare < 0 ? 'text-loss' : '' }] : []),
      { key: 'monthly', label: 'Щомісячні витрати', value: uah(s.monthlyExpenses), sub: s.monthlyRate ? `${uah(s.monthlyRate)} × ${s.months} ${plural(s.months, 'місяць', 'місяці', 'місяців')}` : 'вкажіть суму в «Ставках»', icon: 'calendar-check', color: 'text-slate-300 bg-slate-500/15', glow: 'rgba(100,116,139,.2)' },
      { key: 'pricePerKm', label: 'Ціна за 1 км', value: uah2(s.pricePerKm), sub: `${fmtInt.format(s.km)} км пробігу`, icon: 'route', color: 'text-sky-300 bg-sky-500/15', glow: 'rgba(14,165,233,.2)' },
      { key: 'fuel', label: 'Паливо (фактично)', value: uah(s.fuelCost), sub: `${fmtL.format(s.fuelLiters)} л · ${fmtL.format(s.fuelPer100)} л/100км · знижка ${uah(s.fuelDiscount)}`, icon: 'fuel', color: 'text-orange-300 bg-orange-500/15', glow: 'rgba(249,115,22,.2)' },
      { key: 'sto', label: 'СТО', value: uah(s.sto), sub: `за ${fmtInt.format(s.days)} ${plural(s.days, 'доба', 'доби', 'діб')} у рейсах`, icon: 'hammer', color: 'text-yellow-300 bg-yellow-500/15', glow: 'rgba(234,179,8,.18)' },
      { key: 'repair', label: 'Ремонт', value: uah(s.repair), sub: s.km > 0 ? `${fmtDec.format(s.repair / s.km)} ₴ на 1 км` : '—', icon: 'wrench', color: 'text-cyan-300 bg-cyan-500/15', glow: 'rgba(6,182,212,.2)' },
      { key: 'tax', label: 'Податок', value: uah(s.tax), sub: `від безналу ${uah(s.bank)}`, icon: 'landmark', color: 'text-rose-300 bg-rose-500/15', glow: 'rgba(244,63,94,.18)' },
      { key: 'days', label: 'Діб у рейсах', value: fmtInt.format(s.days), sub: `добові ${uah(s.perDiem)}`, icon: 'calendar-clock', color: 'text-violet-300 bg-violet-500/15', glow: 'rgba(139,92,246,.2)' },
      { key: 'carProfit', label: 'Прибуток авто', value: uah(s.carProfit), sub: 'база для ЗП (без СТО, податку, ремонту)', icon: 'truck', color: 'text-teal-300 bg-teal-500/15', glow: 'rgba(20,184,166,.2)', valueClass: profitClass(s.carProfit) },
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
    carOwner: '#8c96a3', // власникам авто під управлінням (нейтральний — «не ваші гроші»)
    owner: '#c98500',   // ваш прибуток
    loss: '#ef6a5b',    // збиток (статус)
    surface: '#232931',
    muted: '#7a828b',
    accent: '#efba18',
    text2: '#c3c5c4',
  };
  /** Розкладає суму фрахту на групи: разом вони дорівнюють фрахту. */
  function moneyGroups(s) {
    return {
      trip: s.fuelCost + s.tax + s.sto + s.repair + s.other + s.monthlyExpenses,
      pay: s.driverPay + s.logistPay + s.perDiem,
      partner: s.partnerShare,
      carOwner: s.carOwnerShare || 0,
      owner: s.ownerProfit,
    };
  }
  const GROUP_NAMES = { trip: 'Витрати на рейс', pay: 'Зарплати', partner: 'Компаньйону', carOwner: 'Власникам авто', owner: 'Ваш прибуток' };
  const GROUP_IDS = ['trip', 'pay', 'partner', 'carOwner', 'owner'];
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
      ...(s.mgmtCount ? [{ id: 'carOwner', key: 'carOwner', items: [] }] : []),
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
        const owner = vals[vals.length - 1]; // останній набір — «Ваш прибуток»
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
      id, label: GROUP_NAMES[id], data: G.map((x) => x[id]), stack: 'f',
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
        // Власникам авто — лише якщо в цих місяцях є рейси авто під управлінням
        ...(G.some((x) => x.carOwner) ? [ds('carOwner', { borderWidth: { bottom: 2 }, borderRadius: 0 })] : []),
        ds('owner', {
          borderWidth: (ctx) => (ctx.raw < 0 ? { top: 2 } : { bottom: 2 }),
          borderRadius: (ctx) => (ctx.raw < 0 ? { bottomLeft: 4, bottomRight: 4 } : { topLeft: 4, topRight: 4 }),
        }),
      ],
    };

    $('#chartLegendCarOwner').classList.toggle('hidden', !G.some((x) => x.carOwner));
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
              labelColor: (ctx) => { const col = ctx.raw < 0 && ctx.dataset.id === 'owner' ? VIZ.loss : VIZ[ctx.dataset.id]; return { borderColor: col, backgroundColor: col }; },
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
    const ids = G.some((x) => x.carOwner) ? GROUP_IDS : GROUP_IDS.filter((id) => id !== 'carOwner');
    $('#chartTable').innerHTML = keys.length ? `
      <table class="w-full text-sm">
        <thead><tr class="text-left text-xs text-slate-400">
          <th class="py-2 pr-3 font-medium">Місяць</th><th class="py-2 pr-3 text-right font-medium">Фрахт</th>
          ${ids.map((id) => `<th class="py-2 pr-3 text-right font-medium"><i class="lg-sw mr-1.5" style="background:${VIZ[id]}"></i>${GROUP_NAMES[id]}</th>`).join('')}
        </tr></thead>
        <tbody class="divide-y divide-white/5">
          ${keys.map((k, i) => `<tr>
            <td class="py-2 pr-3 text-slate-300">${monthLabel(k, true)}</td>
            <td class="num py-2 pr-3 text-right text-white">${uah(sums[i].freight)}</td>
            ${ids.map((id) => `<td class="num py-2 pr-3 text-right ${G[i][id] < 0 ? 'text-loss' : 'text-slate-200'}">${uah(G[i][id])}</td>`).join('')}
          </tr>`).join('')}
        </tbody>
      </table>` : '<p class="py-6 text-center text-sm text-slate-500">Немає даних</p>';
  }

  // ---------- Список рейсів ----------
  function tripActions(id) {
    return `
      <button class="icon-btn" data-edit="${escapeHtml(id)}" title="Редагувати"><i data-lucide="pencil" class="h-4 w-4"></i></button>
      <button class="icon-btn" data-xlsx="${escapeHtml(id)}" title="Скачати рейс в Excel" aria-label="Скачати рейс в Excel"><i data-lucide="file-spreadsheet" class="h-4 w-4"></i></button>
      <button class="icon-btn" data-copy="${escapeHtml(id)}" title="Дублювати"><i data-lucide="copy" class="h-4 w-4"></i></button>
      <button class="icon-btn danger" data-del="${escapeHtml(id)}" title="Видалити"><i data-lucide="trash-2" class="h-4 w-4"></i></button>`;
  }

  function renderTrips(list, s) {
    $('#tripsCount').textContent = `${list.length} ${plural(list.length, 'рейс', 'рейси', 'рейсів')}` + (list.length !== trips.length ? ` із ${trips.length}` : '');
    const isEmpty = list.length === 0;
    $('#emptyState').classList.toggle('hidden', !isEmpty);
    $('#emptyState').innerHTML = isEmpty ? (trips.length ? noResultsHtml() : welcomeHtml()) : '';

    const rows = list.map((t) => ({ t, c: calcTrip(t, settings) }));
    // Колонка «Власнику» — лише коли є авто під управлінням
    const showOwnerCol = hasManaged();
    $('#thCarOwner').classList.toggle('hidden', !showOwnerCol);
    const ownerTd = (v, isTrip) => (showOwnerCol ? `<td class="td text-right text-slate-300">${isTrip === false ? '—' : uah(v)}</td>` : '');

    // Під номером авто: дати, маршрут, водій
    const tripInfo = (t) => {
      const d = tripDriver(t);
      const hasPlate = !!tripPlate(t).plate;
      return `
        ${t.managed ? `<div class="mt-1">${mgmtBadge(t)}</div>` : ''}
        ${hasPlate ? `<div class="mt-0.5 inline-flex items-center gap-1 text-xs text-slate-300"><i data-lucide="calendar" class="h-3 w-3 text-slate-500"></i>${tripDates(t)}</div>` : ''}
        <div class="max-w-[260px] truncate text-xs text-slate-500">${escapeHtml(t.route || t.note || 'Без маршруту')}</div>
        ${d ? `<div class="mt-0.5 inline-flex items-center gap-1 text-xs text-slate-400"><i data-lucide="user-round" class="h-3 w-3 text-amber-300"></i>${escapeHtml(d)}</div>` : ''}`;
    };

    $('#tripsTable').innerHTML = rows.map(({ t, c }) => `
      <tr class="row-hover row-click" data-open="${escapeHtml(t.id)}" title="Відкрити рейс">
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
        ${ownerTd(c.carOwnerShare, c.managed)}
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
        ${ownerTd(s.carOwnerShare)}
        <td class="td text-right">${uah(s.partnerShare)}</td>
        <td class="td text-right ${profitClass(s.ownerProfit)}">${uah(s.ownerProfit)}</td>
        <td class="td"></td>
      </tr>`;

    $('#tripsCards').innerHTML = rows.map(({ t, c }) => `
      <article class="row-click rounded-2xl border border-white/5 bg-white/[0.02] p-4 transition hover:border-white/15" data-open="${escapeHtml(t.id)}">
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
          ${c.managed ? `<dt class="text-slate-400">До розподілу</dt><dd class="num text-right">${uah(c.pool)}</dd>
          <dt class="text-slate-400">Власнику авто</dt><dd class="num text-right text-slate-300">${uah(c.carOwnerShare)}</dd>` : ''}
          <dt class="text-slate-400">${c.managed ? `Ваша частка ${fmtL.format(c.mgmtShare)}%` : 'Чистий прибуток'}</dt><dd class="num text-right font-semibold ${profitClass(c.netProfit)}">${uah(c.netProfit)}</dd>
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
        <div class="row-hover row-click flex items-center gap-4 px-4 py-3 sm:px-5" data-open="${escapeHtml(t.id)}">
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

  // ---------- Порожні екрани ----------
  /** Перший вхід: три кроки до першого рейсу. */
  function welcomeHtml() {
    const refsDone = drivers.length > 0 || cars.length > 0;
    const step = (n, done, title, text, action, btn, icon) => `
      <li class="empty-step ${done ? 'is-done' : ''}">
        <span class="empty-num" aria-hidden="true">${done ? '<i data-lucide="check" class="h-4 w-4"></i>' : n}</span>
        <div class="min-w-0 flex-1">
          <div class="font-semibold text-white">${title}${done ? '<span class="sr-only"> — готово</span>' : ''}</div>
          <p class="mt-0.5 text-sm text-slate-400">${text}</p>
        </div>
        <button type="button" class="${n === 3 ? 'btn-primary' : 'btn-ghost'} shrink-0" data-action="${action}"><i data-lucide="${icon}" class="h-4 w-4"></i><span>${btn}</span></button>
      </li>`;
    return `
      <div class="empty-hero">
        <div class="empty-road" aria-hidden="true"><i data-lucide="truck"></i></div>
        <h2 class="empty-title">Почнімо з першого рейсу</h2>
        <p class="mx-auto mt-2 max-w-md text-sm text-slate-400">Вносите рейс — сайт сам рахує км, паливо, податок, добові, зарплати й ваш прибуток. Три кроки, і панель оживе.</p>
        <ol class="empty-steps">
          ${step(1, false, 'Перевірте ставки', 'Податок, добові, СТО, відсотки водія й логіста. Стандартні вже стоять — змініть, якщо у вас інакше.', 'settings', 'Ставки', 'settings-2')}
          ${step(2, refsDone, 'Додайте водіїв та авто', 'Щоб у рейсі вибирати зі списку, а не писати щоразу вручну. Можна й пізніше.', 'refs', refsDone ? 'Змінити' : 'Додати', 'users')}
          ${step(3, false, 'Внесіть перший рейс', 'Дати, одометр, паливо й оплату. Звіт логіста з Телеграму можна просто вставити — суми підтягнуться самі.', 'add', 'Новий рейс', 'plus')}
        </ol>
        <p class="mt-6 text-sm text-slate-500">Хочете спершу роздивитися?
          <button type="button" class="font-medium text-indigo-300 underline-offset-4 hover:underline" data-action="demo">Завантажте демо-рейси</button> — їх можна видалити в меню «Дані».</p>
      </div>`;
  }

  /** Рейси є, але під фільтр/пошук нічого не потрапило. */
  function noResultsHtml() {
    const period = escapeHtml($('#periodLabel').textContent.trim());
    const q = query.trim();
    const why = q ? `За запитом «${escapeHtml(q)}» нічого не знайдено` : `За період «${period}» рейсів немає`;
    return `
      <div class="empty-hero empty-compact">
        <div class="empty-icon" aria-hidden="true"><i data-lucide="${q ? 'search' : 'calendar-range'}"></i></div>
        <h2 class="empty-title">${why}</h2>
        <p class="mx-auto mt-2 max-w-md text-sm text-slate-400">Усього у вас ${trips.length} ${plural(trips.length, 'рейс', 'рейси', 'рейсів')}. Покажіть усі або додайте новий рейс.</p>
        <div class="mt-5 flex flex-wrap justify-center gap-2">
          <button type="button" class="btn-ghost" data-action="reset-filters"><i data-lucide="list" class="h-4 w-4"></i><span>Показати всі рейси</span></button>
          <button type="button" class="btn-primary" data-action="add"><i data-lucide="plus" class="h-4 w-4"></i><span>Додати рейс</span></button>
        </div>
      </div>`;
  }

  /** На панелі: замість нулів і порожніх графіків — підказка. */
  function renderDashEmpty(list) {
    const box = $('#dashEmpty');
    const isEmpty = list.length === 0;
    box.classList.toggle('hidden', !isEmpty);
    box.innerHTML = isEmpty ? `<div class="card">${trips.length ? noResultsHtml() : welcomeHtml()}</div>` : '';
    $$('#dashboardView > section').forEach((sec) => sec.classList.toggle('hidden', isEmpty));
  }

  function resetFilters() {
    filter = { year: 'all', month: 'all', driver: 'all', car: 'all', kind: 'all' };
    query = '';
    $('#search').value = '';
    renderAll();
  }

  function renderAll() {
    renderFilters();
    const list = filteredTrips();
    renderDashEmpty(list);
    const s = summarize(list, settings);
    renderKpis(s);
    renderStructure(s);
    renderChart(list);
    renderRecent(list);
    renderTrips(list, s);
    renderOwners();
    if (!$('#payoutModal').classList.contains('hidden')) renderPayoutBalance();
    if (!$('#viewModal').classList.contains('hidden')) renderTripView();
    if (!$('#kpiModal').classList.contains('hidden')) renderKpiInfo();
    refreshIcons();
  }

  // ---------- Власники авто під управлінням ----------
  /** Розрахунки з власниками; імʼя показуємо так, як його записано в довіднику авто. */
  function ledger() {
    const L = ownerLedger(trips, payouts, settings);
    for (const o of L) {
      const car = cars.find((c) => c.managed && ownerKey(c.ownerName) === o.key);
      if (car) o.name = cleanName(car.ownerName);
      const plates = new Set(cars.filter((c) => c.managed && ownerKey(c.ownerName) === o.key).map((c) => c.plate));
      for (const { t } of o.trips) { const pl = tripPlate(t).plate; if (pl) plates.add(pl); }
      o.plates = Array.from(plates);
      o.last = o.payouts[0] || null; // payouts відсортовані: найновіша перша
      // Нараховано за рейси після останнього розрахунку (за датою початку рейсу)
      o.sinceLast = o.trips.filter(({ t }) => !o.last || (t.startDate || '') > (o.last.date || '')).reduce((a, x) => a + x.c.carOwnerShare, 0);
      o.sinceCount = o.trips.filter(({ t }) => !o.last || (t.startDate || '') > (o.last.date || '')).length;
    }
    return L;
  }
  const findOwner = (key) => ledger().find((o) => o.key === key);

  function balanceText(b) {
    if (Math.abs(b) < 0.5) return { cls: 'text-profit', title: 'Розраховані', value: uah(0), hint: 'боргів немає' };
    return b > 0
      ? { cls: 'text-white', title: 'Ви винні власнику', value: uah(b), hint: 'нараховано більше, ніж виплачено' }
      : { cls: 'text-loss', title: 'Власник винен вам', value: uah(-b), hint: 'виплачено більше, ніж нараховано' };
  }

  function renderOwners() {
    const box = $('#ownersView');
    const L = ledger();
    if (!L.length) {
      box.innerHTML = `
        <div class="card"><div class="empty-hero empty-compact">
          <div class="empty-icon" aria-hidden="true"><i data-lucide="key-round"></i></div>
          <h2 class="empty-title">Тут будуть розрахунки за авто під управлінням</h2>
          <p class="mx-auto mt-2 max-w-lg text-sm text-slate-400">Відкрийте «Водії та авто», натисніть олівець біля авто, поставте галочку <b class="text-slate-200">«Під управлінням»</b> і вкажіть власника та вашу частку (напр. 30%). Сайт сам рахуватиме, скільки ви винні власнику, а виплати ви записуєте тут, коли розраховуєтесь.</p>
          <div class="mt-5 flex justify-center"><button type="button" class="btn-primary" data-action="refs"><i data-lucide="users" class="h-4 w-4"></i><span>Водії та авто</span></button></div>
        </div></div>`;
      return;
    }
    const total = L.reduce((a, o) => a + o.balance, 0);
    const head = `
      <div class="card flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div class="min-w-0">
          <h2 class="card-title">Скільки ви винні власникам авто</h2>
          <p class="text-xs text-slate-400">За весь час: нараховано за рейси мінус те, що ви вже виплатили. Розраховуєтесь, коли зручно — просто запишіть суму.</p>
        </div>
        <div class="shrink-0 text-left sm:text-right">
          <div class="num text-2xl font-extrabold ${total < -0.5 ? 'text-loss' : 'text-white'}">${total < -0.5 ? '− ' + uah(-total) : uah(total)}</div>
          <div class="text-xs text-slate-500">${L.length} ${plural(L.length, 'власник', 'власники', 'власників')}</div>
        </div>
      </div>`;

    const cards = L.map((o) => {
      const b = balanceText(o.balance);
      const k = escapeHtml(o.key);
      const months = o.months.map((r) => `<tr>
          <td class="py-2 pr-3 text-slate-300">${/^\d{4}-\d{2}$/.test(r.month) ? monthLabel(r.month, true) : '—'}</td>
          <td class="num py-2 pr-3 text-right">${r.count}</td>
          <td class="num py-2 pr-3 text-right">${uah(r.freight)}</td>
          <td class="num py-2 pr-3 text-right">${uah(r.pool)}</td>
          <td class="num py-2 pr-3 text-right text-lime-300">${uah(r.my)}</td>
          <td class="num py-2 pr-3 text-right font-semibold ${r.carOwnerShare < 0 ? 'text-loss' : 'text-white'}">${uah(r.carOwnerShare)}</td>
        </tr>`).join('');
      const pays = o.payouts.length ? o.payouts.map((p) => {
        const out = num(p.amount) >= 0;
        return `<li class="pay-row">
            <span class="pay-ic ${out ? 'is-out' : 'is-in'}"><i data-lucide="${out ? 'arrow-up-right' : 'arrow-down-left'}" class="h-4 w-4"></i></span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm text-white">${fmtDate(p.date)} · ${out ? 'виплачено власнику' : 'власник повернув'}</span>
              ${p.note ? `<span class="block truncate text-xs text-slate-500">${escapeHtml(p.note)}</span>` : ''}
            </span>
            <span class="num shrink-0 font-semibold ${out ? 'text-white' : 'text-profit'}">${out ? '' : '+ '}${uah(Math.abs(num(p.amount)))}</span>
            <button type="button" class="icon-btn danger" data-del-payout="${escapeHtml(p.id)}" title="Видалити запис" aria-label="Видалити запис"><i data-lucide="trash-2" class="h-4 w-4"></i></button>
          </li>`;
      }).join('') : '<li class="py-3 text-sm text-slate-500">Ще не розраховувались</li>';

      return `
      <article class="card owner-card">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-400/15 text-slate-200"><i data-lucide="key-round" class="h-5 w-5"></i></span>
              <h3 class="truncate text-lg font-bold text-white">${escapeHtml(o.name)}</h3>
            </div>
            <div class="mt-2 flex flex-wrap gap-1.5">${o.plates.map((pl) => plateHtml(pl)).join('') || '<span class="text-xs text-slate-500">авто не вказано</span>'}</div>
          </div>
          <div class="owner-balance">
            <div class="text-xs text-slate-400">${b.title}</div>
            <div class="num text-3xl font-extrabold ${b.cls}">${b.value}</div>
            <div class="text-xs text-slate-500">${b.hint}</div>
          </div>
        </div>

        <dl class="owner-stats">
          <div><dt>Нараховано за весь час</dt><dd class="num">${uah(o.accrued)}</dd><small>${o.trips.length} ${plural(o.trips.length, 'рейс', 'рейси', 'рейсів')}</small></div>
          <div><dt>Виплачено</dt><dd class="num">${uah(o.paid)}</dd><small>${o.payouts.length} ${plural(o.payouts.length, 'розрахунок', 'розрахунки', 'розрахунків')}</small></div>
          <div><dt>${o.last ? 'Після розрахунку ' + fmtDate(o.last.date) : 'Ще не розраховувались'}</dt><dd class="num">${uah(o.sinceLast)}</dd><small>нараховано за ${o.sinceCount} ${plural(o.sinceCount, 'рейс', 'рейси', 'рейсів')}</small></div>
        </dl>

        <div class="mt-4 flex flex-wrap gap-2">
          <button type="button" class="btn-primary" data-payout="${k}"><i data-lucide="hand-coins" class="h-4 w-4"></i><span>Записати розрахунок</span></button>
          <button type="button" class="btn-ghost" data-owner-xlsx="${k}" title="Звіт для власника: рейси, розподіл і виплати"><i data-lucide="file-spreadsheet" class="h-4 w-4"></i><span>Звіт в Excel</span></button>
        </div>

        <details class="owner-more mt-5">
          <summary><i data-lucide="calendar-days" class="h-4 w-4"></i>По місяцях<i data-lucide="chevron-down" class="ml-auto h-4 w-4 caret"></i></summary>
          <div class="mt-3 overflow-x-auto">
            <table class="w-full min-w-[640px] text-sm">
              <thead><tr class="text-left text-xs text-slate-400">
                <th class="py-2 pr-3 font-medium">Місяць</th><th class="py-2 pr-3 text-right font-medium">Рейсів</th>
                <th class="py-2 pr-3 text-right font-medium">Фрахт</th><th class="py-2 pr-3 text-right font-medium" title="Прибуток після палива, зарплат, податку, СТО і ремонту">До розподілу</th>
                <th class="py-2 pr-3 text-right font-medium">Ваша частка</th>
                <th class="py-2 pr-3 text-right font-medium">Власнику</th>
              </tr></thead>
              <tbody class="divide-y divide-white/5">${months || '<tr><td colspan="6" class="py-4 text-center text-slate-500">Рейсів ще немає</td></tr>'}</tbody>
            </table>
          </div>
        </details>
        <details class="owner-more mt-2" ${o.payouts.length ? 'open' : ''}>
          <summary><i data-lucide="history" class="h-4 w-4"></i>Історія розрахунків<i data-lucide="chevron-down" class="ml-auto h-4 w-4 caret"></i></summary>
          <ul class="mt-2 divide-y divide-white/5">${pays}</ul>
        </details>
      </article>`;
    }).join('');
    // Зберігаємо розкриті/згорнуті блоки між перемальовуваннями
    const openState = $$('details.owner-more', box).map((d) => d.open);
    box.innerHTML = head + cards;
    if (openState.length) $$('details.owner-more', box).forEach((d, i) => { if (i < openState.length) d.open = openState[i]; });
  }

  // ---------- Запис розрахунку з власником ----------
  const payoutForm = $('#payoutForm');
  let payoutOwnerKey = null;

  function renderPayoutBalance() {
    const o = findOwner(payoutOwnerKey);
    if (!o) { closeModal($('#payoutModal')); return; }
    const b = balanceText(o.balance);
    $('#payoutTitle').textContent = 'Розрахунок: ' + o.name;
    $('#payoutBalance').innerHTML = `
      <div class="rounded-xl border border-white/5 bg-white/[0.03] p-3">
        <div class="text-xs text-slate-400">${b.title} зараз</div>
        <div class="num text-2xl font-extrabold ${b.cls}">${b.value}</div>
        <div class="text-xs text-slate-500">нараховано ${uah(o.accrued)} · виплачено ${uah(o.paid)}</div>
      </div>`;
    const quick = [];
    if (o.balance > 0.5) quick.push({ dir: 'out', v: o.balance, label: `Увесь борг ${uah(o.balance)}` });
    if (o.balance < -0.5) quick.push({ dir: 'in', v: -o.balance, label: `Увесь борг власника ${uah(-o.balance)}` });
    if (o.sinceLast > 0.5 && Math.abs(o.sinceLast - o.balance) > 0.5) quick.push({ dir: 'out', v: o.sinceLast, label: `Лише нове ${uah(o.sinceLast)}` });
    $('#payoutQuick').innerHTML = quick.map((q) => `<button type="button" class="chip" data-quick-amount="${Math.round(q.v * 100) / 100}" data-quick-dir="${q.dir}">${q.label}</button>`).join('');
  }

  function openPayout(key) {
    const o = findOwner(key);
    if (!o) return;
    payoutOwnerKey = key;
    payoutForm.reset();
    $('#payoutError').classList.add('hidden');
    $$('.invalid', payoutForm).forEach((el) => el.classList.remove('invalid'));
    payoutForm.elements.date.value = today();
    if (o.balance < -0.5) payoutForm.querySelector('input[name="dir"][value="in"]').checked = true;
    renderPayoutBalance();
    openModal($('#payoutModal'));
    setTimeout(() => payoutForm.elements.amount.focus({ preventScroll: true }), 50);
  }

  $('#payoutQuick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-quick-amount]');
    if (!b) return;
    payoutForm.elements.amount.value = b.dataset.quickAmount;
    payoutForm.querySelector(`input[name="dir"][value="${b.dataset.quickDir}"]`).checked = true;
    payoutForm.elements.amount.classList.remove('invalid');
  });
  payoutForm.addEventListener('input', (e) => e.target.classList.remove('invalid'));

  payoutForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const o = findOwner(payoutOwnerKey);
    if (!o) return closeModal($('#payoutModal'));
    const el = payoutForm.elements;
    const amount = Math.round(num(el.amount.value) * 100) / 100;
    const date = el.date.value;
    const errors = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { errors.push('Вкажіть дату.'); el.date.classList.add('invalid'); }
    if (!(amount > 0) || amount > 1e9) { errors.push('Вкажіть суму більше нуля.'); el.amount.classList.add('invalid'); }
    if (errors.length) {
      $('#payoutError').textContent = errors.join(' ');
      $('#payoutError').classList.remove('hidden');
      return;
    }
    const dir = payoutForm.querySelector('input[name="dir"]:checked').value;
    payouts.push({ id: uid(), owner: o.name, date, amount: dir === 'in' ? -amount : amount, note: el.note.value.trim().slice(0, 200), createdAt: Date.now() });
    saveSettings();
    closeModal($('#payoutModal'));
    renderAll();
    toast(dir === 'in' ? 'Записано: власник повернув ' + uah(amount) : 'Записано: виплачено ' + uah(amount));
  });

  function deletePayout(id) {
    const p = payouts.find((x) => x.id === id);
    if (!p || !confirm(`Видалити запис розрахунку ${fmtDate(p.date)} на ${uah(Math.abs(num(p.amount)))}?`)) return;
    payouts = payouts.filter((x) => x.id !== id);
    saveSettings();
    renderAll();
    toast('Запис видалено', 'info');
  }

  // ---------- Вкладки (Панель / Рейси / Власники) ----------
  function currentView() { return location.hash === '#trips' ? 'trips' : location.hash === '#owners' ? 'owners' : 'dashboard'; }
  const VIEW_TITLES = { dashboard: 'Фінансова панель', trips: 'Рейси', owners: 'Розрахунки з власниками авто' };

  function applyView() {
    const v = currentView();
    $('#dashboardView').classList.toggle('hidden', v !== 'dashboard');
    $('#tripsView').classList.toggle('hidden', v !== 'trips');
    $('#ownersView').classList.toggle('hidden', v !== 'owners');
    // Розрахунки з власниками — за весь час, фільтри періоду тут не діють
    $('#filtersBox').style.display = v === 'owners' ? 'none' : '';
    $('#periodLabel').classList.toggle('invisible', v === 'owners');
    // Рейси — на всю ширину монітора
    $$('.app-container').forEach((el) => el.classList.toggle('max-w-7xl', v !== 'trips'));
    $$('[data-tab]').forEach((el) => el.classList.toggle('active', el.dataset.tab === v));
    $('#viewTitle').textContent = VIEW_TITLES[v];
    document.title = (v === 'trips' ? 'Рейси' : v === 'owners' ? 'Власники авто' : 'Облік рейсів') + ' — вантажні перевезення';
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

  /** Рядки розподілу прибутку для авто під управлінням (перегляд рейсу і форма). */
  function mgmtRows(c, row, sep) {
    const other = 100 - c.mgmtShare;
    return row('Прибуток авто (база ЗП)', uah2(c.carProfit), profitClass(c.carProfit)) +
      (c.fuelDiscount ? row('Знижка на паливо', (c.fuelDiscount > 0 ? '+ ' : '− ') + uah2(Math.abs(c.fuelDiscount)), profitClass(c.fuelDiscount)) : '') +
      row(`ЗП водія ${fmtL.format(c.rates.driverRate)}%`, '− ' + uah2(c.driverPay), 'text-amber-300') +
      row(`ЗП логіста ${fmtL.format(c.rates.logistRate)}%`, '− ' + uah2(c.logistPay), 'text-fuchsia-300') +
      row(`Податок ${fmtL.format(c.rates.taxRate)}%`, '− ' + uah2(c.tax), 'text-rose-300') +
      row(`СТО ${fmtInt.format(c.rates.stoRate)} × ${c.days}`, '− ' + uah2(c.sto), 'text-yellow-300') +
      (c.repair ? row('Ремонт', '− ' + uah2(c.repair), 'text-cyan-300') : '') +
      row('Прибуток до розподілу', uah2(c.pool), 'font-semibold ' + profitClass(c.pool)) +
      sep +
      `<div class="mgmt-split">
         <div><div class="text-xs text-slate-400">Власнику ${fmtL.format(other)}%</div><div class="num font-semibold ${c.carOwnerShare < 0 ? 'text-loss' : 'text-slate-200'}">${uah2(c.carOwnerShare)}</div></div>
         <div><div class="text-xs text-slate-400">Ваша частка ${fmtL.format(c.mgmtShare)}%</div><div class="num font-semibold ${profitClass(c.netProfit)}">${uah2(c.netProfit)}</div></div>
       </div>`;
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
          (t.managed ? row('Власник авто', escapeHtml(t.ownerName || '—') + ` · ваша частка ${fmtL.format(c.mgmtShare)}%`, 'text-slate-200') : '') +
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
        ${block('pie-chart', 'Прибуток', (c.managed ? mgmtRows(c, row, sep) :
          row('Прибуток авто (база ЗП)', uah2(c.carProfit), profitClass(c.carProfit)) +
          (c.fuelDiscount ? row('Знижка на паливо', (c.fuelDiscount > 0 ? '+ ' : '− ') + uah2(Math.abs(c.fuelDiscount)), profitClass(c.fuelDiscount)) : '') +
          row(`Податок ${fmtL.format(c.rates.taxRate)}%`, '− ' + uah2(c.tax), 'text-rose-300') +
          row(`СТО ${fmtInt.format(c.rates.stoRate)} × ${c.days}`, '− ' + uah2(c.sto), 'text-yellow-300') +
          (c.repair ? row('Ремонт', '− ' + uah2(c.repair), 'text-cyan-300') : '') +
          row(`ЗП водія ${fmtL.format(c.rates.driverRate)}%`, '− ' + uah2(c.driverPay), 'text-amber-300') +
          row(`ЗП логіста ${fmtL.format(c.rates.logistRate)}%`, '− ' + uah2(c.logistPay), 'text-fuchsia-300') +
          row('Чистий прибуток бізнесу', uah2(c.netProfit), 'font-semibold ' + profitClass(c.netProfit))) +
          row(`Компаньйону ${fmtL.format(c.rates.partnerRate)}%${c.managed ? ' з вашої' : ''}`, '− ' + uah2(c.partnerShare), 'text-pink-300') +
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
  $('#viewXlsx').addEventListener('click', () => exportTripXlsx(viewingId));
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
  const FIELDS = ['driverId', 'carId', 'startDate', 'endDate', 'route', 'odoStart', 'odoEnd', 'fuelLiters', 'fuelPrice', 'fuelPriceActual', 'cash', 'bank', 'card', 'dispatch', 'repairExpenses', 'otherExpenses', 'note', 'perDiem', 'stoRate', 'taxRate', 'driverRate', 'partnerRate', 'logistRate', 'mgmtShare'];
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

  /**
   * Чи авто рейсу під управлінням і чиє воно.
   * Редагування рейсу з тим самим авто — беремо те, що збережено в рейсі (історія не переписується).
   * Новий рейс або інше авто — беремо з довідника.
   */
  function formMgmt() {
    const carId = tripForm.elements.carId.value;
    const src = formSource || {};
    if (editingId && carId && carId === src.carId && src.managed !== undefined) {
      return { managed: !!src.managed, ownerName: src.ownerName || '', share: src.mgmtShare !== undefined && src.mgmtShare !== '' ? src.mgmtShare : settings.mgmtShare };
    }
    const car = carId && cars.find((x) => x.id === carId);
    if (car && car.managed) return { managed: true, ownerName: car.ownerName || '', share: car.mgmtShare !== undefined && car.mgmtShare !== '' ? car.mgmtShare : settings.mgmtShare };
    return { managed: false, ownerName: '', share: '' };
  }

  /** Показати/сховати поле «Моя частка» і підказку про власника. resetShare — підставити % з авто. */
  function syncMgmtUi(resetShare) {
    const m = formMgmt();
    $('#mgmtShareWrap').classList.toggle('hidden', !m.managed);
    $('#mgmtInfo').classList.toggle('hidden', !m.managed);
    $('#mgmtInfo').innerHTML = m.managed
      ? `<i data-lucide="key-round" class="h-3.5 w-3.5 shrink-0"></i><span>Авто під управлінням · власник <b>${escapeHtml(m.ownerName || '—')}</b>. Прибуток після всіх витрат (податок, СТО, ремонт) ділите за частками.</span>`
      : '';
    if (m.managed && (resetShare || tripForm.elements.mgmtShare.value === '')) tripForm.elements.mgmtShare.value = m.share;
    refreshIcons();
  }

  function readForm() {
    const data = {};
    for (const f of FIELDS) {
      const v = tripForm.elements[f].value.trim();
      data[f] = TEXT_FIELDS.includes(f) ? v : v === '' ? '' : num(v);
    }
    const m = formMgmt();
    data.managed = m.managed;
    data.ownerName = m.ownerName;
    if (!m.managed) data.mgmtShare = '';
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
    // Новий рейс / копія — частка з авто; редагування — збережена в рейсі
    syncMgmtUi(!editingId);
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
      c.other ? row('Інші витрати', '− ' + uah2(c.other), 'text-slate-300') : '',
      '<div class="preview-sep"></div>',
      ...(c.managed ? [mgmtRows(c, row, '<div class="preview-sep"></div>')] : [
        row('Прибуток авто (база ЗП)', uah2(c.carProfit), profitClass(c.carProfit)),
        row(`ЗП водія ${fmtL.format(c.rates.driverRate)}%`, '− ' + uah2(c.driverPay), 'text-amber-300'),
        row(`Податок ${fmtL.format(c.rates.taxRate)}% (безнал)`, '− ' + uah2(c.tax), 'text-rose-300'),
        row(`СТО ${fmtInt.format(c.rates.stoRate)} × ${c.days}`, '− ' + uah2(c.sto), 'text-yellow-300'),
        c.repair ? row('Ремонт', '− ' + uah2(c.repair), 'text-cyan-300') : '',
        c.fuelDiscount ? row(`Знижка на паливо (факт ${fmtDec.format(c.fuelPriceActual)})`, (c.fuelDiscount > 0 ? '+ ' : '− ') + uah2(Math.abs(c.fuelDiscount)), profitClass(c.fuelDiscount)) : '',
        row(`ЗП логіста ${fmtL.format(c.rates.logistRate)}% від фрахту`, '− ' + uah2(c.logistPay), 'text-fuchsia-300'),
        '<div class="preview-sep"></div>',
        row('Чистий прибуток бізнесу', uah2(c.netProfit), 'font-semibold ' + profitClass(c.netProfit)),
      ]),
      row(`Компаньйону ${fmtL.format(c.rates.partnerRate)}%${c.managed ? ' з вашої' : ''}`, '− ' + uah2(c.partnerShare), 'text-pink-300'),
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
    if (d.managed && d.mgmtShare !== '' && d.mgmtShare > 100) { errors.push('Ваша частка не може бути більшою за 100%.'); mark('mgmtShare'); }
    if (d.managed && !d.ownerName) errors.push('У цього авто не вказано власника — додайте його в «Водії та авто».');
    for (const f of ['fuelLiters', 'fuelPrice', 'fuelPriceActual', 'cash', 'bank', 'card', 'dispatch', 'repairExpenses', 'otherExpenses', 'perDiem', 'stoRate', 'taxRate', 'driverRate', 'partnerRate', 'logistRate', 'mgmtShare']) {
      if (d[f] !== '' && d[f] < 0) { errors.push('Значення не можуть бути відʼємними.'); mark(f); break; }
    }
    if (num(d.dispatch) > num(d.cash) + num(d.bank) + num(d.card)) { errors.push('Диспетчерські більші за отриману суму.'); mark('dispatch'); }
    return errors;
  }

  tripForm.addEventListener('input', (e) => {
    if (e.target.classList.contains('invalid')) e.target.classList.remove('invalid');
    if (e.target.name === 'carId') syncMgmtUi(true);
    updatePreview();
  });
  tripForm.elements.carId.addEventListener('change', () => { syncMgmtUi(true); updatePreview(); });

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
    if (d.managed && d.mgmtShare === '') d.mgmtShare = num(formMgmt().share);
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
    settingsForm.elements.mgmtShare.value = settings.mgmtShare;
    settingsForm.elements.monthlyExpenses.value = settings.monthlyExpenses || '';
    openModal($('#settingsModal'));
  });
  settingsForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const read = (n, def) => { const v = settingsForm.elements[n].value.trim(); return v === '' ? def : Math.max(0, num(v)); };
    // Object.assign — щоб не загубити інші дані в settings (виплати власникам)
    settings = Object.assign({}, settings, {
      perDiem: read('perDiem', DEFAULTS.perDiem),
      stoRate: read('stoRate', DEFAULTS.stoRate),
      taxRate: read('taxRate', DEFAULTS.taxRate),
      driverRate: read('driverRate', DEFAULTS.driverRate),
      partnerRate: read('partnerRate', DEFAULTS.partnerRate),
      logistRate: read('logistRate', DEFAULTS.logistRate),
      monthlyExpenses: read('monthlyExpenses', DEFAULTS.monthlyExpenses),
      mgmtShare: Math.min(100, read('mgmtShare', DEFAULTS.mgmtShare)),
    });
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
    const item = (id, kind, title, sub, icon, color, count, extra = '') => `
      <li class="flex items-center gap-3 rounded-xl border ${editingCarId === id ? 'border-amber-400/40 bg-amber-400/[0.06]' : 'border-white/5 bg-white/[0.02]'} px-3 py-2">
        <div class="grid h-8 w-8 shrink-0 place-items-center rounded-lg ${color}"><i data-lucide="${icon}" class="h-4 w-4"></i></div>
        <div class="min-w-0 flex-1">
          <div class="truncate font-medium text-white">${escapeHtml(title)}</div>
          <div class="truncate text-xs text-slate-500">${escapeHtml(sub)}${sub ? ' · ' : ''}${count} ${plural(count, 'рейс', 'рейси', 'рейсів')}</div>
          ${extra}
        </div>
        ${kind === 'car' ? `<button type="button" class="icon-btn" data-edit-car="${escapeHtml(id)}" title="Редагувати"><i data-lucide="pencil" class="h-4 w-4"></i></button>` : ''}
        <button type="button" class="icon-btn danger" data-del-${kind}="${escapeHtml(id)}" title="Видалити"><i data-lucide="trash-2" class="h-4 w-4"></i></button>
      </li>`;
    const empty = (txt) => `<li class="rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-sm text-slate-500">${txt}</li>`;

    $('#driversList').innerHTML = drivers.length
      ? drivers.slice().sort(sortByLabel(driverLabel)).map((d) => item(d.id, 'driver', driverLabel(d), '', 'user-round', 'bg-amber-500/15 text-amber-300', tripsWith('driverId', d.id))).join('')
      : empty('Водіїв ще немає');
    $('#carsList').innerHTML = cars.length
      ? cars.slice().sort(sortByLabel(carLabel)).map((c) => item(c.id, 'car', c.plate, c.brand, c.managed ? 'key-round' : 'truck', c.managed ? 'bg-slate-400/15 text-slate-200' : 'bg-sky-500/15 text-sky-300', tripsWith('carId', c.id),
        c.managed ? `<div class="truncate text-xs text-slate-300">Під управлінням · ${escapeHtml(c.ownerName || '—')} · ваша частка ${fmtL.format(num(c.mgmtShare))}%</div>` : '')).join('')
      : empty('Авто ще немає');
    // Підказки імен власників (щоб однаково писати імʼя для кількох авто)
    const names = new Map();
    for (const c of cars) if (c.ownerName) names.set(ownerKey(c.ownerName), c.ownerName);
    for (const p of payouts) if (!names.has(ownerKey(p.owner))) names.set(ownerKey(p.owner), p.owner);
    $('#ownersList').innerHTML = Array.from(names.values()).map((n) => `<option value="${escapeHtml(n)}"></option>`).join('');
    refreshIcons();
  }

  function openRefs() {
    resetCarForm();
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
      syncMgmtUi(false);
      updatePreview();
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

  let editingCarId = null;

  function syncCarMgmtFields() {
    const on = carForm.elements.managed.checked;
    $('#carMgmtFields').classList.toggle('hidden', !on);
    if (on && carForm.elements.mgmtShare.value === '') carForm.elements.mgmtShare.value = settings.mgmtShare;
  }
  carForm.elements.managed.addEventListener('change', syncCarMgmtFields);

  function resetCarForm() {
    editingCarId = null;
    carForm.reset();
    $$('.invalid', carForm).forEach((el) => el.classList.remove('invalid'));
    syncCarMgmtFields();
    $('#carSubmit').innerHTML = '<i data-lucide="plus" class="h-4 w-4"></i><span>Додати авто</span>';
    $('#carCancelEdit').classList.add('hidden');
    refreshIcons();
  }

  function editCar(id) {
    const c = cars.find((x) => x.id === id);
    if (!c) return;
    editingCarId = id;
    carForm.elements.plate.value = c.plate || '';
    carForm.elements.brand.value = c.brand || '';
    carForm.elements.managed.checked = !!c.managed;
    carForm.elements.ownerName.value = c.ownerName || '';
    carForm.elements.mgmtShare.value = c.managed ? num(c.mgmtShare) : '';
    syncCarMgmtFields();
    $('#carSubmit').innerHTML = '<i data-lucide="save" class="h-4 w-4"></i><span>Зберегти зміни</span>';
    $('#carCancelEdit').classList.remove('hidden');
    renderRefs();
    carForm.elements.plate.focus();
  }
  $('#carCancelEdit').addEventListener('click', () => { resetCarForm(); renderRefs(); });

  carForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const el = carForm.elements;
    const plate = normPlate(el.plate.value);
    const brand = el.brand.value.trim();
    const managed = el.managed.checked;
    const ownerName = managed ? cleanName(el.ownerName.value) : '';
    const shareRaw = el.mgmtShare.value.trim();
    const mgmtShare = managed ? (shareRaw === '' ? num(settings.mgmtShare) : num(shareRaw)) : '';
    el.plate.classList.toggle('invalid', !plate);
    el.brand.classList.toggle('invalid', !brand);
    el.ownerName.classList.toggle('invalid', managed && !ownerName);
    const badShare = managed && (mgmtShare < 0 || mgmtShare > 100);
    el.mgmtShare.classList.toggle('invalid', badShare);
    if (!plate || !brand) return toast('Вкажіть держ. номер та марку авто', 'err');
    if (managed && !ownerName) return toast('Вкажіть власника авто', 'err');
    if (badShare) return toast('Частка — від 0 до 100%', 'err');
    if (cars.some((c) => c.id !== editingCarId && normPlate(c.plate) === plate)) return toast('Авто з таким номером уже є', 'err');
    const mgmt = { managed, ownerName, mgmtShare };

    if (editingCarId) {
      const c = cars.find((x) => x.id === editingCarId);
      if (!c) { resetCarForm(); return; }
      const before = { managed: !!c.managed, ownerName: c.ownerName || '', mgmtShare: c.managed ? num(c.mgmtShare) : '' };
      Object.assign(c, { plate, brand }, mgmt);
      // Змінили імʼя власника, і старе імʼя більше ні в кого — переносимо записи розрахунків
      const oldKey = ownerKey(before.ownerName);
      if (before.managed && managed && oldKey && oldKey !== ownerKey(ownerName) && !cars.some((x) => x.managed && ownerKey(x.ownerName) === oldKey)) {
        const moved = payouts.filter((p) => ownerKey(p.owner) === oldKey);
        if (moved.length && confirm(`Перенести записи розрахунків (${moved.length}) з «${before.ownerName}» на «${ownerName}»?`)) {
          for (const p of moved) p.owner = ownerName;
          saveSettings();
        }
      }
      // Умови управління змінились — питаємо, чи переписати вже внесені рейси цього авто
      const changed = before.managed !== managed || ownerKey(before.ownerName) !== ownerKey(ownerName) || before.mgmtShare !== mgmtShare || before.ownerName !== ownerName;
      const list = trips.filter((t) => t.carId === c.id);
      const differ = list.filter((t) => !!t.managed !== managed || (managed && (t.ownerName !== ownerName || num(t.mgmtShare) !== mgmtShare)));
      if (changed && differ.length) {
        const what = managed ? `під управлінням (власник ${ownerName}, ваша частка ${fmtL.format(mgmtShare)}%)` : 'своє авто (без власника)';
        if (confirm(`Застосувати до вже внесених рейсів цього авто (${differ.length})?\n\nУсі вони стануть: ${what}.\n\nОК — так, переписати. Скасувати — лише для нових рейсів.`)) {
          for (const t of differ) Object.assign(t, mgmt);
          saveTrips();
        }
      }
      for (const t of list) t.carName = carLabel(c);
      if (list.length) saveTrips();
      resetCarForm();
      afterRefsChange();
      toast('Авто оновлено');
      return;
    }

    const c = Object.assign({ id: uid(), plate, brand }, mgmt);
    cars.push(c);
    resetCarForm();
    afterRefsChange();
    if (!$('#tripModal').classList.contains('hidden') && !tripForm.elements.carId.value) {
      tripForm.elements.carId.value = c.id;
      syncMgmtUi(true);
      updatePreview();
    }
    el.plate.focus();
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
    if (editingCarId === id) resetCarForm();
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

  // Колонки експорту рейсів (спільні для Excel і CSV).
  // fmt: date | text | int | dec (2 знаки) | money (гроші, 2 знаки); sum — підсумовувати в рядку «Разом».
  const EXPORT_COLS = [
    { h: 'Дата початку', v: (t) => t.startDate, fmt: 'date', w: 12 },
    { h: 'Дата кінця', v: (t) => t.endDate, fmt: 'date', w: 12 },
    { h: 'Водій', v: (t) => tripDriver(t), fmt: 'text', w: 18 },
    { h: 'Авто', v: (t) => tripCar(t), fmt: 'text', w: 20 },
    { h: 'Тип авто', v: (t) => (t.managed ? 'Під управлінням' : 'Моє'), fmt: 'text', w: 16 },
    { h: 'Власник авто', v: (t) => (t.managed ? t.ownerName || '' : ''), fmt: 'text', w: 18 },
    { h: 'Маршрут', v: (t) => t.route, fmt: 'text', w: 28 },
    { h: 'Одометр поч.', v: (t) => num(t.odoStart), fmt: 'int', w: 12 },
    { h: 'Одометр кін.', v: (t) => num(t.odoEnd), fmt: 'int', w: 12 },
    { h: 'Км', v: (t, c) => c.km, fmt: 'int', sum: true, w: 9 },
    { h: 'Діб', v: (t, c) => c.days, fmt: 'int', sum: true, w: 6 },
    { h: 'Паливо, л', v: (t, c) => c.fuelLiters, fmt: 'dec', sum: true, w: 10 },
    { h: 'Ціна палива для водія', v: (t, c) => c.fuelPrice, fmt: 'money', w: 12 },
    { h: 'Фактична ціна палива', v: (t, c) => c.fuelPriceActual, fmt: 'money', w: 12 },
    { h: 'Паливо для водія, грн', v: (t, c) => c.fuelCostDriver, fmt: 'money', sum: true, w: 13 },
    { h: 'Паливо фактично, грн', v: (t, c) => c.fuelCost, fmt: 'money', sum: true, w: 13 },
    { h: 'Знижка на паливо', v: (t, c) => c.fuelDiscount, fmt: 'money', sum: true, w: 12 },
    { h: 'Готівка', v: (t, c) => c.cash, fmt: 'money', sum: true, w: 12 },
    { h: 'Безнал', v: (t, c) => c.bank, fmt: 'money', sum: true, w: 12 },
    { h: 'Карта', v: (t, c) => c.card, fmt: 'money', sum: true, w: 12 },
    { h: 'Диспетчерські', v: (t, c) => c.dispatch, fmt: 'money', sum: true, w: 12 },
    { h: 'Фрахт (без диспетчерських)', v: (t, c) => c.freight, fmt: 'money', sum: true, w: 14 },
    { h: 'Грн/км', v: (t, c) => c.pricePerKm, fmt: 'dec', w: 8 },
    { h: 'Податок', v: (t, c) => c.tax, fmt: 'money', sum: true, w: 11 },
    { h: 'Добові', v: (t, c) => c.perDiem, fmt: 'money', sum: true, w: 11 },
    { h: 'СТО', v: (t, c) => c.sto, fmt: 'money', sum: true, w: 11 },
    { h: 'Ремонт', v: (t, c) => c.repair, fmt: 'money', sum: true, w: 11 },
    { h: 'Інші витрати', v: (t, c) => c.other, fmt: 'money', sum: true, w: 11 },
    { h: 'Прибуток авто', v: (t, c) => c.carProfit, fmt: 'money', sum: true, w: 13 },
    { h: 'ЗП водія', v: (t, c) => c.driverPay, fmt: 'money', sum: true, w: 12 },
    { h: 'ЗП логіста', v: (t, c) => c.logistPay, fmt: 'money', sum: true, w: 12 },
    { h: 'Прибуток до розподілу (авто в управлінні)', v: (t, c) => c.pool, fmt: 'money', sum: true, w: 16 },
    { h: 'Ваша частка, %', v: (t, c) => (c.managed ? c.mgmtShare : 100), fmt: 'dec', w: 9 },
    { h: 'Власнику авто', v: (t, c) => c.carOwnerShare, fmt: 'money', sum: true, w: 13 },
    { h: 'Чистий прибуток бізнесу', v: (t, c) => c.netProfit, fmt: 'money', sum: true, w: 14 },
    { h: 'Компаньйону', v: (t, c) => c.partnerShare, fmt: 'money', sum: true, w: 12 },
    { h: 'Ваш прибуток', v: (t, c) => c.ownerProfit, fmt: 'money', sum: true, w: 13 },
    { h: 'Нотатка', v: (t) => t.note, fmt: 'text', w: 30 },
  ];
  const XLSX_FMT = { int: '#,##0', dec: '#,##0.00', money: '#,##0.00', date: 'dd.mm.yyyy' };
  const today = () => new Date().toISOString().slice(0, 10);
  // Безпечна частина назви файлу: літери, цифри, дефіс
  const fileSafe = (s) => String(s || '').replace(/[^\p{L}\p{N}-]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  // «2026-03-15» → порядковий номер дати Excel (рахуємо в UTC, щоб часовий пояс не зсував день)
  const isoToSerial = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? (Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000 : null;
  };

  // Бібліотека SheetJS вантажиться лише при першому експорті (≈280 КБ), з перевіркою цілісності (SRI)
  const XLSX_SRC = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.mini.min.js';
  const XLSX_SRI = 'sha384-NG/W3xvO3ynQEcDQYIOcZTXRtwUs83cLv1FIl9PuqWPDuNhsMRF6wutlNLFwlb71';
  let xlsxLoading = null;
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!xlsxLoading) {
      xlsxLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = XLSX_SRC;
        s.integrity = XLSX_SRI;
        s.crossOrigin = 'anonymous';
        s.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error('XLSX')));
        s.onerror = () => { xlsxLoading = null; s.remove(); reject(new Error('XLSX')); };
        document.head.appendChild(s);
      });
    }
    return xlsxLoading;
  }

  /** Клітинка для SheetJS з правильним типом і форматом. */
  function xCell(value, fmt) {
    if (fmt === 'date') {
      const d = isoToSerial(value);
      return d !== null ? { t: 'n', v: d, z: XLSX_FMT.date } : { t: 's', v: '' };
    }
    if (fmt === 'text' || typeof value === 'string') return { t: 's', v: String(value ?? '') };
    const n = Number(value) || 0;
    return { t: 'n', v: n, z: XLSX_FMT[fmt] || XLSX_FMT.dec };
  }

  /** Аркуш «Рейси»: рядок на кожен рейс + «Разом» з формулами SUM. */
  function tripsSheet(XLSX, list) {
    const rows = list.map((t) => ({ t, c: calcTrip(t, settings) }));
    const aoa = [EXPORT_COLS.map((col) => ({ t: 's', v: col.h }))];
    for (const { t, c } of rows) aoa.push(EXPORT_COLS.map((col) => xCell(col.v(t, c), col.fmt)));
    const last = rows.length + 1; // номер останнього рядка з даними (1-й — заголовок)
    aoa.push(EXPORT_COLS.map((col, i) => {
      if (i === 0) return { t: 's', v: 'Разом' };
      if (!col.sum) return { t: 's', v: '' };
      const L = XLSX.utils.encode_col(i);
      const total = Math.round(rows.reduce((a, { t, c }) => a + (Number(col.v(t, c)) || 0), 0) * 100) / 100;
      return { t: 'n', v: total, f: `SUM(${L}2:${L}${last})`, z: XLSX_FMT[col.fmt] };
    }));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = EXPORT_COLS.map((col) => ({ wch: col.w }));
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: last - 1, c: EXPORT_COLS.length - 1 } }) };
    return ws;
  }

  /** Аркуш «Підсумок» — ті самі цифри, що на панелі (з урахуванням щомісячних витрат). */
  function summarySheet(XLSX, list) {
    const s = summarize(list, settings);
    const m = (label, v) => [{ t: 's', v: label }, xCell(v, 'money')];
    const aoa = [
      [{ t: 's', v: 'Облік рейсів — підсумок' }],
      [{ t: 's', v: 'Період' }, { t: 's', v: $('#periodLabel').textContent.trim() }],
      [{ t: 's', v: 'Вивантажено' }, xCell(today(), 'date')],
      [],
      [{ t: 's', v: 'Рейсів' }, xCell(s.count, 'int')],
      [{ t: 's', v: 'Кілометрів' }, xCell(s.km, 'int')],
      [{ t: 's', v: 'Діб у рейсах' }, xCell(s.days, 'int')],
      [],
      m('Сума фрахту', s.freight),
      m('Диспетчерські', s.dispatch),
      m('Паливо (фактично)', s.fuelCost),
      m('Податок', s.tax),
      m('Добові', s.perDiem),
      m('СТО', s.sto),
      m('Ремонт', s.repair),
      m('Інші витрати', s.other),
      m('ЗП водія', s.driverPay),
      m('ЗП логіста', s.logistPay),
      m(`Щомісячні витрати (${s.months} міс.)`, s.monthlyExpenses),
      [],
      ...(s.mgmtCount ? [m('Власникам авто (нараховано)', s.carOwnerShare)] : []),
      m('Чистий прибуток бізнесу', s.netProfit),
      ...(s.mgmtCount ? [m('  з них свої авто', s.ownNet), m('  з них авто в управлінні (ваша частка)', s.mgmtNet)] : []),
      m('Компаньйону', s.partnerShare),
      m('Ваш прибуток', s.ownerProfit),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 30 }, { wch: 22 }];
    return ws;
  }

  /** Аркуш одного рейсу: «Показник — Значення», як у вікні перегляду. */
  function singleTripSheet(XLSX, t) {
    const c = calcTrip(t, settings);
    const r = c.rates;
    const pct = (x) => fmtL.format(x) + '%';
    const T = (label, v) => [{ t: 's', v: label }, { t: 's', v: String(v ?? '') }];
    const N = (label, v, fmt = 'money') => [{ t: 's', v: label }, xCell(v, fmt)];
    const H = (title) => [{ t: 's', v: title.toUpperCase() }];
    const aoa = [
      T('Рейс', [tripPlate(t).plate, tripDates(t)].filter(Boolean).join(' · ')),
      [],
      H('Водій та авто'),
      T('Водій', tripDriver(t) || '—'),
      T('Авто', tripCar(t) || '—'),
      T('Маршрут', t.route || '—'),
      [{ t: 's', v: 'Дата початку' }, xCell(t.startDate, 'date')],
      [{ t: 's', v: 'Дата кінця' }, xCell(t.endDate, 'date')],
      T('Нотатка', t.note || '—'),
      [],
      H('Пробіг'),
      N('Діб у рейсі', c.days, 'int'),
      N('Одометр початок, км', num(t.odoStart), 'int'),
      N('Одометр кінець, км', num(t.odoEnd), 'int'),
      N('Км за рейс', c.km, 'int'),
      [],
      H('Паливо'),
      N('Витрата, л', c.fuelLiters, 'dec'),
      N('Л на 100 км', c.fuelPer100, 'dec'),
      N('Ціна для водія, грн/л', c.fuelPrice),
      N('Фактична ціна, грн/л', c.fuelPriceActual),
      N('Сума для водія', c.fuelCostDriver),
      N('Сума фактична', c.fuelCost),
      N('Знижка (економія)', c.fuelDiscount),
      [],
      H('Фрахт'),
      N('Готівка', c.cash),
      N('Безнал', c.bank),
      N('Карта', c.card),
      N('Отримано всього', c.received),
      N('Диспетчерські', c.dispatch),
      N('Сума фрахту', c.freight),
      N('Ціна за 1 км', c.pricePerKm),
      [],
      H('Витрати'),
      N('Паливо (фактично)', c.fuelCost),
      N(`Податок ${pct(r.taxRate)}`, c.tax),
      N(`Добові ${fmtInt.format(r.perDiem)} × ${c.days}`, c.perDiem),
      N(`СТО ${fmtInt.format(r.stoRate)} × ${c.days}`, c.sto),
      N('Ремонт', c.repair),
      N('Інші витрати', c.other),
      N(`ЗП водія ${pct(r.driverRate)}`, c.driverPay),
      N(`ЗП логіста ${pct(r.logistRate)}`, c.logistPay),
      N('Усього витрат', c.totalExpenses),
      [],
      H('Прибуток'),
      N('Прибуток авто (база ЗП)', c.carProfit),
      ...(c.managed ? [
        T('Авто під управлінням', `власник ${t.ownerName || '—'}, ваша частка ${pct(c.mgmtShare)}`),
        N('Прибуток до розподілу', c.pool),
        N(`Власнику авто ${pct(100 - c.mgmtShare)}`, c.carOwnerShare),
      ] : []),
      N(c.managed ? `Ваша частка ${pct(c.mgmtShare)} (чистий бізнесу)` : 'Чистий прибуток бізнесу', c.netProfit),
      N(`Компаньйону ${pct(r.partnerRate)}`, c.partnerShare),
      N('Ваш прибуток', c.ownerProfit),
      N('Чистий прибуток з 1 км', c.profitPerKm),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 28 }, { wch: 34 }];
    return ws;
  }

  function saveWorkbook(XLSX, sheets, filename) {
    const wb = XLSX.utils.book_new();
    for (const [name, ws] of sheets) XLSX.utils.book_append_sheet(wb, ws, name);
    XLSX.writeFile(wb, filename, { compression: true });
  }

  /** Усі рейси за вибраний період / пошук → .xlsx (якщо бібліотека не завантажилась — CSV). */
  async function exportXlsx() {
    const list = filteredTrips();
    if (!list.length) return toast('Немає рейсів для експорту', 'info');
    const period = fileSafe($('#periodLabel').textContent);
    const name = `reisy_${period || 'usi'}_${today()}`;
    try {
      const XLSX = await loadXlsx();
      saveWorkbook(XLSX, [['Рейси', tripsSheet(XLSX, list)], ['Підсумок', summarySheet(XLSX, list)]], name + '.xlsx');
      toast(`Excel збережено: ${list.length} ${plural(list.length, 'рейс', 'рейси', 'рейсів')}`);
    } catch (e) {
      console.error(e);
      exportCSV(list, name + '.csv');
      toast('Не вдалося підключити Excel-бібліотеку — збережено CSV (теж відкривається в Excel)', 'info');
    }
  }

  /** Один рейс → .xlsx */
  async function exportTripXlsx(id) {
    const t = trips.find((x) => x.id === id);
    if (!t) return;
    const name = `reis_${fileSafe(tripPlate(t).plate) || 'bez-nomera'}_${t.startDate || today()}`;
    try {
      const XLSX = await loadXlsx();
      saveWorkbook(XLSX, [['Рейс', singleTripSheet(XLSX, t)], ['Рядком', tripsSheet(XLSX, [t])]], name + '.xlsx');
      toast('Рейс збережено в Excel');
    } catch (e) {
      console.error(e);
      exportCSV([t], name + '.csv');
      toast('Не вдалося підключити Excel-бібліотеку — збережено CSV', 'info');
    }
  }

  /** Звіт для власника авто: підсумок, рейси з розподілом, історія розрахунків. */
  async function exportOwnerXlsx(key) {
    const o = findOwner(key);
    if (!o) return;
    const name = `vlasnyk_${fileSafe(o.name) || 'bez-imeni'}_${today()}`;
    let XLSX;
    try { XLSX = await loadXlsx(); } catch (e) { console.error(e); return toast('Не вдалося підключити Excel-бібліотеку. Перевірте інтернет.', 'err'); }
    const M = (v) => xCell(v, 'money');
    const S = (v) => ({ t: 's', v: String(v ?? '') });
    const sum = [
      [S('Розрахунки з власником авто')],
      [S('Власник'), S(o.name)],
      [S('Авто'), S(o.plates.join(', '))],
      [S('Сформовано'), xCell(today(), 'date')],
      [],
      [S('Нараховано власнику за весь час'), M(o.accrued)],
      [S('Виплачено'), M(o.paid)],
      [S(o.balance >= 0 ? 'Залишок до виплати власнику' : 'Власник винен'), M(Math.abs(o.balance))],
      [],
      [S('Як рахується: прибуток до розподілу = фрахт − паливо − добові − інші витрати − ЗП водія − ЗП логіста − податок − СТО − ремонт.')],
      [S('Власнику — його відсоток від прибутку до розподілу. Збиток ділиться так само.')],
    ];
    const wsSum = XLSX.utils.aoa_to_sheet(sum);
    wsSum['!cols'] = [{ wch: 36 }, { wch: 26 }];

    const cols = [
      ['Дата початку', (t) => xCell(t.startDate, 'date'), 12], ['Дата кінця', (t) => xCell(t.endDate, 'date'), 12],
      ['Авто', (t) => S(tripCar(t)), 20], ['Маршрут', (t) => S(t.route), 28], ['Км', (t, c) => xCell(c.km, 'int'), 8],
      ['Фрахт', (t, c) => M(c.freight), 12], ['Паливо фактично', (t, c) => M(c.fuelCost), 12], ['Добові', (t, c) => M(c.perDiem), 10],
      ['Інші витрати', (t, c) => M(c.other), 10], ['ЗП водія', (t, c) => M(c.driverPay), 11], ['ЗП логіста', (t, c) => M(c.logistPay), 11],
      ['Податок', (t, c) => M(c.tax), 10], ['СТО', (t, c) => M(c.sto), 10], ['Ремонт', (t, c) => M(c.repair), 10],
      ['Прибуток до розподілу', (t, c) => M(c.pool), 14], ['Ваша частка, %', (t, c) => xCell(c.mgmtShare, 'dec'), 9],
      ['Власнику нараховано', (t, c) => M(c.carOwnerShare), 14],
    ];
    const rows = o.trips.slice().reverse();
    const aoa = [cols.map(([h]) => S(h)), ...rows.map(({ t, c }) => cols.map(([, f]) => f(t, c)))];
    const moneyIdx = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16];
    aoa.push(cols.map((col, i) => {
      if (i === 0) return S('Разом');
      if (!moneyIdx.includes(i)) return S('');
      const L = XLSX.utils.encode_col(i);
      const total = Math.round(rows.reduce((a, r) => a + (Number(col[1](r.t, r.c).v) || 0), 0) * 100) / 100;
      return { t: 'n', v: total, f: `SUM(${L}2:${L}${rows.length + 1})`, z: XLSX_FMT.money };
    }));
    const wsTrips = XLSX.utils.aoa_to_sheet(aoa);
    wsTrips['!cols'] = cols.map(([, , w]) => ({ wch: w }));

    const pay = [[S('Дата'), S('Що'), S('Сума'), S('Коментар')],
      ...o.payouts.slice().reverse().map((p) => [xCell(p.date, 'date'), S(num(p.amount) >= 0 ? 'Виплачено власнику' : 'Власник повернув'), M(Math.abs(num(p.amount))), S(p.note)])];
    const wsPay = XLSX.utils.aoa_to_sheet(pay);
    wsPay['!cols'] = [{ wch: 12 }, { wch: 20 }, { wch: 14 }, { wch: 40 }];

    saveWorkbook(XLSX, [['Підсумок', wsSum], ['Рейси', wsTrips], ['Розрахунки', wsPay]], name + '.xlsx');
    toast('Звіт для власника збережено');
  }

  function exportCSV(list = filteredTrips(), filename = `reisy_${today()}.csv`) {
    if (!list.length) return toast('Немає рейсів для експорту', 'info');
    const cell = (v) => {
      let s = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? '');
      // Захист від «формул» у тексті (=, +, -, @ на початку Excel сприйняв би як формулу)
      if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [EXPORT_COLS.map((col) => col.h).join(';')];
    for (const t of list) {
      const c = calcTrip(t, settings);
      lines.push(EXPORT_COLS.map((col) => cell(col.fmt === 'date' ? fmtDate(col.v(t, c)) : col.v(t, c))).join(';'));
    }
    download(filename, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
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
      if (data.settings) {
        const keepPayouts = payouts;
        settings = Object.assign({}, DEFAULTS, data.settings);
        // Записи розрахунків з власниками: з копії, а якщо копія старіша і їх там немає — лишаємо поточні
        payouts = Array.isArray(data.settings.payouts) ? data.settings.payouts.filter((p) => p && typeof p === 'object' && p.id && p.owner) : keepPayouts;
      }
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
          { label: 'Прибуток авто', hint: 'фрахт мінус паливо (ціна для водія), добові, інші', value: s.carProfit, kpi: 'carProfit' },
          { op: '+', label: 'Знижка на паливо', hint: 'різниця між ціною для водія і фактичною', value: s.fuelDiscount, kpi: 'fuel' },
          { op: '−', label: 'Податок', hint: 'від безналу', value: s.tax, kpi: 'tax' },
          { op: '−', label: 'СТО', hint: 'за кожну добу в рейсі', value: s.sto, kpi: 'sto' },
          { op: '−', label: 'Ремонт', value: s.repair, kpi: 'repair' },
          { op: '−', label: 'ЗП водія', value: s.driverPay, kpi: 'driverPay' },
          { op: '−', label: 'ЗП логіста', value: s.logistPay, kpi: 'logistPay' },
          ...(s.mgmtCount ? [{ op: '−', label: 'Власникам авто', hint: 'їхня частка з авто під управлінням', value: s.carOwnerShare, kpi: 'carOwner' }] : []),
          monthlyRow,
        ],
        notes: [
          s.mgmtCount ? `З авто під управлінням у чистий прибуток іде лише ваша частка: ${uah(s.mgmtNet)}. Свої авто дали ${uah(s.ownNet)}.` : null,
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
        notes: [s.mgmtCount ? 'З авто під управлінням компаньйон бере свій відсоток від вашої частки, а не від усього прибутку.' : null, 'Якщо рейс збитковий, компаньйону з нього 0 ₴.', 'Щомісячні витрати на частку компаньйона не впливають — їх покриває ваш прибуток.'],
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
        notes: [`Добові (${uah(s.perDiem)}) платяться окремо і в цю суму не входять.`, 'Паливо для ЗП рахується за ціною для водія, а не фактичною.', 'СТО, податок і ремонт на ЗП водія не впливають.'],
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
        notes: [s.km > 0 ? `Це ${fmtDec.format(s.repair / s.km)} ₴ на кожен кілометр.` : null, 'Віднімається з чистого прибутку бізнесу (на авто під управлінням — до розподілу з власником). На ЗП водія не впливає.'],
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
        what: 'Скільки заробило авто до зарплат, податку, СТО і ремонту. З цієї суми рахується ЗП водія.',
        rows: [
          { label: 'Фрахт', value: s.freight, kpi: 'freight' },
          { op: '−', label: 'Паливо за ціною для водія', hint: 'літри × ціна для водія', value: s.fuelCostDriver, kpi: 'fuel' },
          { op: '−', label: 'Добові', value: s.perDiem, kpi: 'perDiem' },
          { op: '−', label: 'Інші витрати', value: s.other, kpi: 'other' },
        ],
        notes: ['СТО, податок і ремонт тут не віднімаються — щоб не зменшувати ЗП водія.'],
        perTrip: (c) => c.carProfit,
      },
      carOwner: {
        title: 'Власникам авто', icon: 'key-round', total: s.carOwnerShare,
        what: 'Скільки нараховано власникам авто під управлінням за період: їхня частка прибутку після всіх витрат.',
        rows: [
          { label: 'Прибуток до розподілу', hint: 'після палива, зарплат, податку, СТО і ремонту', value: s.mgmtPool },
          { op: '−', label: 'Ваша частка', hint: (() => { const r = sameRate(cs.filter((x) => x.c.managed), 'mgmtShare'); return r === null ? 'різна в рейсах' : pctF(r); })(), value: s.mgmtNet },
        ],
        notes: [
          'Податок, СТО і ремонт віднімаються до розподілу — тобто ви з власником ділите їх за частками. Збиток рейсу — теж.',
          'Це нараховано, а не виплачено. Скільки ви вже віддали і скільки ще винні — у вкладці «Власники».',
        ],
        perTrip: (c) => (c.managed ? c.carOwnerShare : null),
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
        notes: ['Частка компаньйона і власників авто сюди не входять — це розподіл прибутку, а не витрата.'],
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
      const items = cs.filter((x) => info.perTrip(x.c) !== null).sort((a, b) => sortVal(b.c) - sortVal(a.c)).slice(0, 50);
      const shown = cs.filter((x) => info.perTrip(x.c) !== null).length;
      tripsHtml = `
        <section class="mt-7">
          <h4 class="kx-h">З яких рейсів складається <span class="font-normal text-slate-500">${shown}</span></h4>
          <div class="kx-trips">${items.map(({ t, c }) => {
            const v = info.perTrip(c);
            return `<button type="button" class="kx-trip" data-open="${escapeHtml(t.id)}">
                <span class="min-w-0">${tripHeading(t)}<span class="mt-1 block truncate text-xs text-slate-500">${escapeHtml(tripDates(t))} · ${escapeHtml(t.route || 'Без маршруту')}</span></span>
                <span class="num shrink-0 font-semibold ${isNeg(v) ? 'text-loss' : 'text-white'}">${money(v)}</span>
              </button>`;
          }).join('')}</div>
          ${shown > 50 ? '<p class="mt-2 text-xs text-slate-500">Показано 50 найбільших.</p>' : ''}
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
        case 'export-xlsx': exportXlsx(); break;
        case 'export-csv': exportCSV(); break;
        case 'export-json': exportJSON(); break;
        case 'import-json': $('#importFile').click(); break;
        case 'demo': addDemo(); break;
        case 'reset-filters': resetFilters(); break;
        case 'refs': openRefs(); break;
        case 'settings': $('#settingsBtn').click(); break;
        case 'clear':
          if ((trips.length || payouts.length) && confirm('Видалити ВСІ рейси та записи розрахунків з власниками авто? Рекомендуємо спершу зробити резервну копію.')) {
            trips = []; payouts = []; saveTrips(); saveSettings(); renderAll(); toast('Усі дані видалено', 'info');
          }
          break;
      }
      return;
    }

    const delDriver = e.target.closest('[data-del-driver]');
    if (delDriver) return deleteDriver(delDriver.dataset.delDriver);
    const delCar = e.target.closest('[data-del-car]');
    if (delCar) return deleteCar(delCar.dataset.delCar);
    const editCarBtn = e.target.closest('[data-edit-car]');
    if (editCarBtn) return editCar(editCarBtn.dataset.editCar);
    const payBtn = e.target.closest('[data-payout]');
    if (payBtn) return openPayout(payBtn.dataset.payout);
    const delPay = e.target.closest('[data-del-payout]');
    if (delPay) return deletePayout(delPay.dataset.delPayout);
    const ownXl = e.target.closest('[data-owner-xlsx]');
    if (ownXl) return exportOwnerXlsx(ownXl.dataset.ownerXlsx);

    const edit = e.target.closest('[data-edit]');
    if (edit) return openTripForm(edit.dataset.edit);
    const xl = e.target.closest('[data-xlsx]');
    if (xl) return exportTripXlsx(xl.dataset.xlsx);
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
  $('#kindFilter').addEventListener('change', (e) => { filter.kind = e.target.value; renderAll(); });
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
