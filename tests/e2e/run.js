#!/usr/bin/env node
/*
 * Браузерні автотести: npm run e2e
 * Запускає сайт локально з тестовими даними (tests/e2e/mock.js замість входу в Supabase),
 * відкриває Chrome без вікна і проходить основні сценарії. Скріни — у папці з тимчасовими файлами.
 * Потрібен встановлений Google Chrome або Microsoft Edge (шлях можна задати змінною CHROME_PATH).
 */
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'oblik-e2e-'));
const PORT = 8790 + Math.floor(Math.random() * 100);
const DEBUG_PORT = 9390 + Math.floor(Math.random() * 100);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  const c = [process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return c.find((p) => p && fs.existsSync(p));
}

// ---------- Локальний сервер: index.html з тестовим входом ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/' || url === '/index.html') {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace('<script src="js/auth.js"></script>', '<script src="tests/e2e/mock.js"></script>');
    res.writeHead(200, { 'Content-Type': TYPES['.html'] }); return res.end(html);
  }
  const file = path.normalize(path.join(ROOT, url));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (e, d) => {
    if (e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }); res.end(d);
  });
});

// ---------- Перевірки ----------
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${!ok && detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`);
}
const near = (a, b) => Math.abs(a - b) < 0.02;

(async () => {
  const chromePath = findChrome();
  if (!chromePath) { console.error('Не знайдено Chrome / Edge. Задайте шлях у змінній CHROME_PATH.'); process.exit(2); }
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const chrome = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', `--user-data-dir=${path.join(OUT, 'profile')}`, 'about:blank'], { stdio: 'ignore' });
  let targets = [];
  for (let i = 0; i < 60 && !targets.some((t) => t.type === 'page'); i++) { try { targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json(); } catch (e) { /* ще стартує */ } await sleep(200); }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map(); const pageErrors = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') pageErrors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') pageErrors.push('console.error: ' + d.params.args.map((a) => a.value ?? a.description).join(' '));
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error((r.result.exceptionDetails.exception?.description || 'eval error') + '\n  у: ' + expr.slice(0, 200));
    return r.result.result.value;
  };
  const viewport = (w, h, mobile = false) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  const shot = async (name) => { await sleep(300); const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64')); };
  const open = async (hash = '') => {
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/${hash}` });
    for (let i = 0; i < 80; i++) { try { if (await ev('return !!window.__ready')) break; } catch (e) { /* сторінка вантажиться */ } await sleep(150); }
    await sleep(700);
  };
  const go = async (hash) => { await ev(`location.hash = ${JSON.stringify(hash)}`); await sleep(350); };
  await send('Runtime.enable'); await send('Page.enable');
  await viewport(1400, 1000);

  try {
    // ===== Панель =====
    await open('');
    await sleep(1200); // числа на панелі «докручуються» анімацією
    const dash = await ev(`
      const s = Calc.summarize(Cloud._cache.trips, Object.assign({}, Calc.DEFAULTS, Cloud._cache.settings), { expenses: Cloud._cache.settings.expenses });
      const groups = s.fuelCost + s.tax + s.sto + s.repair + s.other + s.monthlyExpenses + s.driverPay + s.logistPay + s.perDiem + s.partnerShare + s.carOwnerShare + s.ownerProfit;
      return { freight: s.freight, groups, net: s.netProfit, biz: s.monthlyExpenses,
        netShown: document.querySelector('[data-kpi="net"] .kpi-value').innerText,
        bizShown: document.querySelector('[data-kpi="monthly"] .kpi-value').innerText,
        reminders: document.querySelector('#reminders').innerText,
        carStatsVisible: !document.querySelector('#carStatsSection').classList.contains('hidden'),
        carRows: [...document.querySelectorAll('#carStats tbody tr')].map((r) => r.querySelector('.plate-num')?.innerText) };`);
    check('панель: частини фрахту разом = фрахт', near(dash.groups, dash.freight), dash);
    check('панель: витрати бізнесу 3 400 ₴ у блоці', dash.biz === 3400 && dash.bizShown.replace(/\s/g, '').startsWith('3400'), dash.bizShown);
    check('нагадування: прострочена страховка і ТО', /Страховка: прострочено/.test(dash.reminders) && /ТО (через|прострочено)/.test(dash.reminders), dash.reminders);
    check('порівняння авто: 2 авто, таблиця видима', dash.carStatsVisible && dash.carRows.length === 2, dash.carRows);
    await shot('01-dashboard');

    // ТО зроблено → нагадування про ТО зникає
    await ev(`document.querySelector('[data-service-done="c1"]').click()`); await sleep(300);
    const svc = await ev(`return { last: Cloud._cache.cars.find((c) => c.id === 'c1').serviceLastOdo, text: document.querySelector('#reminders').innerText }`);
    check('«ТО зроблено» записує поточний пробіг', svc.last === 101000 && !/ТО (через|прострочено)/.test(svc.text), svc);

    // Пояснення «Витрати бізнесу»
    await ev(`document.querySelector('[data-kpi="monthly"]').click()`); await sleep(400);
    const kx = await ev(`return document.querySelector('#kpiBody .kx-calc').innerText`);
    check('пояснення витрат: категорії видно', /Бухгалтер/.test(kx) && /Телефон/.test(kx), kx);
    await ev(`document.querySelector('#kpiModal [data-close]').click()`);

    // ===== Витрати =====
    await go('#expenses');
    const ex0 = await ev(`return { rows: document.querySelectorAll('#expenseList li').length, filtersHidden: getComputedStyle(document.querySelector('#driverFilter').closest('.select-wrap')).display === 'none', yearVisible: getComputedStyle(document.querySelector('#yearFilter').closest('.select-wrap')).display !== 'none' }`);
    check('витрати: 2 записи, видно лише фільтр періоду', ex0.rows === 2 && ex0.filtersHidden && ex0.yearVisible, ex0);
    await ev(`const f = document.querySelector('#expenseForm'); f.amount.value = '-5'; f.requestSubmit()`); await sleep(200);
    check('витрати: відʼємна сума не приймається', await ev(`return Cloud._cache.settings.expenses.length === 2`));
    await ev(`const f = document.querySelector('#expenseForm'); f.date.value = '2026-11-04'; f.category.value = 'Штрафи'; f.amount.value = '1700'; f.note.value = '<b>xss</b>'; f.requestSubmit()`); await sleep(300);
    const ex1 = await ev(`return { n: Cloud._cache.settings.expenses.length, list: document.querySelector('#expenseList').innerText, html: document.querySelector('#expenseList').innerHTML.includes('<b>xss</b>') }`);
    check('витрати: додавання працює, коментар показано як текст', ex1.n === 3 && /Штрафи/.test(ex1.list) && !ex1.html, ex1);
    await shot('02-expenses');
    // Редагування
    const lastId = await ev(`return Cloud._cache.settings.expenses[2].id`);
    await ev(`document.querySelector('[data-edit-expense="${lastId}"]').click()`); await sleep(150);
    await ev(`const f = document.querySelector('#expenseForm'); f.amount.value = '1800'; f.requestSubmit()`); await sleep(250);
    check('витрати: редагування', await ev(`return Cloud._cache.settings.expenses.length === 3 && Cloud._cache.settings.expenses[2].amount === 1800`));
    // Фільтр місяця
    await ev(`const m = document.querySelector('#monthFilter'); m.value = '10'; m.dispatchEvent(new Event('change'))`); await sleep(250);
    check('витрати: фільтр «жовтень» показує 1 запис', await ev(`return document.querySelectorAll('#expenseList li').length === 1`));
    await ev(`const m = document.querySelector('#monthFilter'); m.value = 'all'; m.dispatchEvent(new Event('change'))`); await sleep(200);
    await ev(`document.querySelector('[data-del-expense="${lastId}"]').click()`); await sleep(250);
    check('витрати: видалення', await ev(`return Cloud._cache.settings.expenses.length === 2`));

    // ===== Розрахунки =====
    await go('#settle');
    const st = await ev(`
      const tr = Cloud._cache.trips, set = Object.assign({}, Calc.DEFAULTS, Cloud._cache.settings);
      const partnerAccrued = tr.reduce((a, t) => a + Calc.calcTrip(t, set).partnerShare, 0);
      const ownerAccrued = tr.filter((t) => t.managed).reduce((a, t) => a + Calc.calcTrip(t, set).carOwnerShare, 0);
      const tabs = [...document.querySelectorAll('[data-settle-tab]')].map((b) => b.innerText.replace(/\\s+/g, ' '));
      return { partnerAccrued, ownerAccrued, tabs, filtersHidden: document.querySelector('#filtersBox').style.display === 'none', ownerCard: document.querySelector('.owner-card .owner-balance').innerText };`);
    check('розрахунки: чотири розділи (з замовниками) і без фільтрів', st.tabs.length === 4 && st.filtersHidden, st.tabs);
    check('розрахунки: борг власнику = нараховано − 10 000', st.ownerCard.replace(/\s/g, '').includes(String(Math.round(st.ownerAccrued - 10000))), st);
    await shot('03-settle-owners');
    await ev(`document.querySelector('[data-settle-tab="partner"]').click()`); await sleep(250);
    const pt = await ev(`return document.querySelector('.owner-card').innerText`);
    check('компаньйон: нараховано і виплата 3 000', pt.replace(/\s/g, '').includes(String(Math.round(st.partnerAccrued)).replace(/\B(?=(\d{3})+(?!\d))/g, '')) && /3\s?000/.test(pt), pt.slice(0, 300));
    await ev(`document.querySelector('[data-settle-tab="drivers"]').click()`); await sleep(250);
    const dr = await ev(`return [...document.querySelectorAll('.owner-card h3')].map((h) => h.innerText)`);
    check('водії: окрема картка на кожного', dr.length === 2 && dr.includes('Коваленко Олег') && dr.includes('Шевчук Андрій'), dr);
    await shot('04-settle-drivers');
    // Виплата водію (аванс), напрям «я виплатив»
    await ev(`document.querySelector('[data-payout="drivers|d1"]').click()`); await sleep(250);
    const pm = await ev(`return { title: document.querySelector('#payoutTitle').innerText, out: document.querySelector('#payoutDirOut').innerText }`);
    check('виплата: вікно для водія', pm.title.includes('Коваленко Олег') && /водію/.test(pm.out), pm);
    await ev(`const f = document.querySelector('#payoutForm'); f.amount.value = '5000'; f.note.value = 'аванс'; f.requestSubmit()`); await sleep(300);
    const dp = await ev(`const p = Cloud._cache.settings.payouts.find((x) => x.kind === 'driver'); return p && { party: p.party, amount: p.amount, name: p.name }`);
    check('виплата водію збережена', dp && dp.party === 'd1' && dp.amount === 5000, dp);
    const drCard = await ev(`return [...document.querySelectorAll('.owner-card')].find((c) => c.querySelector('h3').innerText === 'Коваленко Олег').innerText`);
    check('водій: «Виплачено 5 000» у картці', /Виплачено\s*5\s?000/.test(drCard), drCard.slice(0, 300));
    await shot('05-driver-paid');

    // ===== Ставки не гублять виплати й витрати =====
    await ev(`document.querySelector('#settingsBtn').click()`); await sleep(150);
    await ev(`document.querySelector('#settingsForm').requestSubmit()`); await sleep(200);
    check('ставки: виплати і витрати на місці', await ev(`return Cloud._cache.settings.payouts.length === 3 && Cloud._cache.settings.expenses.length === 2`));

    // ===== Авто: ТО і документи =====
    await ev(`document.querySelector('#refsBtn').click()`); await sleep(200);
    await ev(`document.querySelector('[data-edit-car="c2"]').click()`); await sleep(150);
    const hint = await ev(`return document.querySelector('#carOdoHint').textContent`);
    check('авто: підказка поточного пробігу', /52\s?000/.test(hint), hint);
    await ev(`const f = document.querySelector('#carForm'); f.serviceEveryKm.value = '-1'; f.requestSubmit()`); await sleep(150);
    check('авто: відʼємний пробіг ТО не приймається', await ev(`return Cloud._cache.cars.find((c) => c.id === 'c2').serviceEveryKm === undefined`));
    await ev(`const f = document.querySelector('#carForm'); f.serviceEveryKm.value = '10000'; f.serviceLastOdo.value = '42500'; f.tachoUntil.value = '2026-11-20'; f.requestSubmit()`); await sleep(300);
    const c2 = await ev(`return Cloud._cache.cars.find((c) => c.id === 'c2')`);
    check('авто: ТО і тахограф збережено, управління не злетіло', c2.serviceEveryKm === 10000 && c2.tachoUntil === '2026-11-20' && c2.managed === true && c2.ownerName === 'Петренко Іван', c2);
    await shot('06-car-service');
    await ev(`document.querySelector('#refsModal [data-close]').click()`);
    await go('');
    const rem = await ev(`return document.querySelector('#reminders').innerText`);
    check('нагадування: нове ТО (500 км) і тахограф для BC7777AK', /ТО через 500 км/.test(rem) && /Тахограф/.test(rem), rem);

    // ===== PDF-звіт =====
    const pdf = await ev(`
      let html = ''; const real = window.open;
      window.open = () => ({ document: { open() {}, write(h) { html += h; }, close() {} } });
      document.querySelector('[data-action="report-pdf"]').click();
      window.open = real;
      return html;`);
    check('PDF: звіт сформовано з усіма розділами', ['Куди пішов фрахт', 'Авто', 'Водії', 'Авто під управлінням', 'Витрати бізнесу', 'Борги станом на', 'Рейси'].every((x) => pdf.includes(x)), pdf.length);
    check('PDF: небезпечний текст екрановано', !pdf.includes('<img src=x') , '');

    // ===== PDF одного рейсу =====
    const grab = (click) => ev(`
      let html = ''; const real = window.open;
      window.open = () => ({ document: { open() {}, write(h) { html += h; }, close() {} } });
      ${click}
      window.open = real;
      return html;`);
    await go('#trips');
    const tp = await grab(`document.querySelector('[data-trip-pdf="t3"]').click();`);
    check('PDF рейсу: кнопка в списку, усі розділи', ['BC7777AK', 'Розрахунок прибутку', 'Прибуток до розподілу', 'Власнику авто 70%', 'Ваша частка 30%', 'Ваш прибуток з рейсу', 'Усі витрати рейсу'].every((x) => tp.includes(x)), tp.length);
    check('PDF рейсу: нотатка з кодом екранована', !tp.includes('<img src=x') && tp.includes('&lt;img'), '');
    check('PDF рейсу: назва файлу з номером і датою', /<title>Рейс BC7777AK 2026-11-02<\/title>/.test(tp), tp.slice(0, 300));
    await ev(`document.querySelector('[data-open="t1"]').click()`); await sleep(300);
    const tv = await grab(`document.querySelector('#viewPdf').click();`);
    const t1 = await ev(`const c = Calc.calcTrip(Cloud._cache.trips.find((t) => t.id === 't1'), Object.assign({}, Calc.DEFAULTS, Cloud._cache.settings)); return { owner: c.ownerProfit, net: c.netProfit }`);
    const fmt2 = (v) => new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
    check('PDF рейсу: з картки рейсу, своє авто, цифри збігаються', tv.includes('AA1234BB') && tv.includes('Чистий прибуток бізнесу') && !tv.includes('Власнику авто') && tv.includes(fmt2(t1.owner)) && tv.includes(fmt2(t1.net)), t1);
    await ev(`document.querySelector('#viewModal [data-close]').click()`);
    await go('');

    // ===== Рейс на авто під управлінням =====
    await ev(`document.querySelector('#addTripBtn').click()`); await sleep(250);
    await ev(`const f = document.querySelector('#tripForm'); f.carId.value = 'c2'; f.carId.dispatchEvent(new Event('change', { bubbles: true })); f.odoStart.value = 52000; f.odoEnd.value = 52500; f.bank.value = 30000; f.dispatchEvent(new Event('input', { bubbles: true }))`); await sleep(200);
    check('форма рейсу: частка 30% підставилась', await ev(`return document.querySelector('#tripForm').mgmtShare.value === '30' && !document.querySelector('#mgmtShareWrap').classList.contains('hidden')`));
    await ev(`document.querySelector('#tripForm').requestSubmit()`); await sleep(300);
    check('рейс збережено як «під управлінням»', await ev(`const t = Cloud._cache.trips.at(-1); return t.managed === true && t.ownerName === 'Петренко Іван' && t.mgmtShare === 30`));


    // ===== Заявка з Телеграму → рядки оплат → борги =====
    const ORDER = `Днепр - Хмельницкий
400кг (1.23/1.66/2.27м - 1шт )
7000грн / на карту
6000грн / в день выгрузки
1000грн / по оригиналам
0962492673 Леся
груз для <img src=x onerror=window.__xss=11> груп`;
    const BIG = ['27.10–06.11.2026', '', 'Днепр - Винница - Шептицький - Львов - Одесса - Херсон - Одесса-Бердичев-Кривой-Рог ', '',
      '1) 13000грн / безнал ', '2) 4300грн / карта ', '3) 8000грн / безнал ', '4) 8000грн / наличка ', '5) 3000грн / карта ', '6) 25000грн / наличка ',
      '7) 9000грн / безнал ', '8) 8000грн / наличка ', '9) 3000грн / наличка ', '10) 5250грн/ безнал', '11) 3000грн/ на карту ', '12) 7000/наличка',
      '13) 3200грн/наличка', '14) 4000грн/карта ', '15) 7000грн/наличка', '16) 4500грн/карта', '17) 4500грн/карта', '18) 4000грн/ наличка ',
      '-300гр/диспетчерских ', '3700грн/касса', '', '18) 5000грн/безнал'].join('\n');
    await go('#trips');
    await ev(`document.querySelector('[data-edit="t1"]').click()`); await sleep(300);
    const paste = (txt) => ev(`const r = document.querySelector('#reportInput'); r.value = ${JSON.stringify('X')}.replace('X', ${JSON.stringify(txt)}); r.dispatchEvent(new Event('input', { bubbles: true }));`);
    await paste(BIG); await sleep(150);
    const big = await ev(`const f = document.querySelector('#tripForm'); return { n: document.querySelectorAll('#payLines .pay-line').length, wait: document.querySelectorAll('#payLines .pay-line.is-wait').length, s: f.startDate.value, e: f.endDate.value, bank: f.bank.value, cash: f.cash.value, disp: f.dispatch.value, ro: f.cash.readOnly }`);
    check('звіт за рейс: 19 замовлень окремими рядками, дати, безнал «чекаємо», суми в полях', big.n === 19 && big.wait === 5 && big.s === '2026-10-27' && big.e === '2026-11-06' && big.bank === '40250' && big.cash === '65200' && big.disp === '300' && big.ro, big);
    await ev(`document.querySelector('#payLines').scrollIntoView({ block: 'start' })`); await shot('07a-big-report');
    await paste(ORDER); await sleep(150);
    const ord = await ev(`const f = document.querySelector('#tripForm'); return { n: document.querySelectorAll('#payLines .pay-line').length, wait: document.querySelectorAll('#payLines .pay-line.is-wait').length, guessed: document.querySelectorAll('#payLines .is-guessed').length, card: f.card.value, bank: f.bank.value, cash: f.cash.value, cust: f.customer.value, route: f.route.value, start: f.startDate.value, due: !document.querySelector('#payDueWrap').classList.contains('hidden') }`);
    check('заявка: 3 рядки (карта отримано, 2 чекаємо), розміри не дата, дата зі звіту не стерлась', ord.n === 3 && ord.wait === 2 && ord.guessed === 2 && ord.card === '7000' && ord.bank === '7000' && ord.cash === '' && ord.route === 'Днепр → Хмельницкий' && ord.start === '2026-10-27' && ord.due, ord);
    await ev(`document.querySelector('#payLines').scrollIntoView({ block: 'center' })`); await shot('07b-form-pays');
    await viewport(390, 844, true); await sleep(200); await ev(`document.querySelector('#payLines').scrollIntoView({ block: 'center' })`); await shot('07c-form-pays-mobile');
    check('телефон: рядки оплат влазять у форму', await ev(`return [...document.querySelectorAll('#payLines .pay-line')].every((r) => r.scrollWidth <= r.clientWidth + 1)`));
    await viewport(1400, 1000); await sleep(200);
    // Повертаємо дати рейсу t1 (у заявці дати немає — лишилась зі звіту)
    await ev(`const f = document.querySelector('#tripForm'); f.startDate.value = '2026-10-01'; f.endDate.value = '2026-10-03';`);
    // Заявку вставили в «Замовник» — вона розбирається так само
    await ev(`const f = document.querySelector('#tripForm'); const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify('X')}.replace('X', ${JSON.stringify(BIG)})); f.customer.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));`); await sleep(200);
    const viaCust = await ev(`const f = document.querySelector('#tripForm'); return { n: document.querySelectorAll('#payLines .pay-line').length, cust: f.customer.value, rep: f.querySelector('#reportInput').value.length > 100 }`);
    check('заявка, вставлена в «Замовник», теж розбирається на 19 замовлень', viaCust.n === 19 && viaCust.rep && !/грн/.test(viaCust.cust), viaCust);
    await paste(ORDER); await sleep(150);
    await ev(`document.querySelector('#tripForm').customer.value = ''`);
    await paste(ORDER); await sleep(150);
    await ev(`const f = document.querySelector('#tripForm'); f.startDate.value = '2026-10-01'; f.endDate.value = '2026-10-03';`);
    // Порожній рядок не дає зберегти, потім видаляємо його
    await ev(`document.querySelector('#payLineAdd').click()`); await sleep(100);
    await ev(`document.querySelector('#tripForm').requestSubmit()`); await sleep(200);
    check('рейс: порожній рядок оплати не зберігається', await ev(`return !document.querySelector('#formError').classList.contains('hidden') && !Cloud._cache.trips.find((t) => t.id === 't1').payments`));
    await ev(`const b = document.querySelectorAll('[data-pay-del]'); b[b.length - 1].click()`); await sleep(100);
    await ev(`document.querySelector('#tripForm').requestSubmit()`); await sleep(400);
    const t1s = await ev(`const t = Cloud._cache.trips.find((x) => x.id === 't1'); return { st: t.payStatus, n: t.payments.length, wait: t.payments.filter((p) => !p.received).length, card: t.card, bank: t.bank, cash: t.cash, c: t.customer, txt: (t.orderText || '').slice(0, 20) }`);
    check('рейс збережено: рядки, суми, замовник, текст заявки', t1s.st === 'waiting' && t1s.n === 3 && t1s.wait === 2 && t1s.card === 7000 && t1s.bank === 7000 && t1s.cash === 0 && /груп/.test(t1s.c) && t1s.txt.startsWith('Днепр'), t1s);
    const badge = await ev(`return document.querySelector('#tripsTable [data-open="t1"] .wait-badge')?.innerText || ''`);
    check('список рейсів: значок «чекаємо 7 000»', /7\s?000/.test(badge), badge);
    await go('');
    const dx = await ev(`return document.querySelector('#dashExtra').innerText`);
    check('панель: «Не оплачено» 7 000 і прогноз', /Не оплачено/.test(dx) && /7\s?000/.test(dx) && /Прогноз/.test(dx), dx.slice(0, 300));
    await shot('08-dash-debts-forecast');
    await go('#settle');
    await ev(`document.querySelector('[data-settle-tab="customers"]').click()`); await sleep(250);
    const cu = await ev(`const b = document.querySelector('#settleView'); return { text: b.innerText, img: !!b.querySelector('.owner-card img'), rows: b.querySelectorAll('[data-mark-paid]').length }`);
    check('замовники: 2 рядки, прострочено (понад 14 днів), імʼя як текст', cu.rows === 2 && /по оригиналам/.test(cu.text) && /прострочено/.test(cu.text) && !cu.img, cu.text.slice(0, 300));
    await shot('09-settle-customers');
    await ev(`document.querySelector('[data-mark-paid]').click()`); await sleep(300);
    const one = await ev(`const t = Cloud._cache.trips.find((x) => x.id === 't1'); return { wait: t.payments.filter((p) => !p.received).length, st: t.payStatus, date: t.payments.find((p) => p.received && p.method === 'bank')?.receivedDate }`);
    check('замовники: «Отримано» закриває лише один рядок', one.wait === 1 && one.st === 'waiting' && /^\d{4}-\d{2}-\d{2}$/.test(one.date || ''), one);
    // Картка рейсу: відмітка натисканням
    await ev(`document.querySelector('#settleView [data-open="t1"]').click()`); await sleep(300);
    const vb = await ev(`return { chips: document.querySelectorAll('#viewBody .pay-chip').length, wait: document.querySelectorAll('#viewBody .pay-chip.is-wait').length, txt: !!document.querySelector('#viewBody .order-text'), img: !!document.querySelector('#viewBody .order-text img') }`);
    check('картка рейсу: оплати і текст заявки (екранований)', vb.chips === 3 && vb.wait === 1 && vb.txt && !vb.img, vb);
    await shot('11-trip-payments');
    await ev(`document.querySelector('#viewBody .pay-chip.is-wait').click()`); await sleep(250);
    const all = await ev(`const t = Cloud._cache.trips.find((x) => x.id === 't1'); return { st: t.payStatus, wait: t.payments.filter((p) => !p.received).length, chipsWait: document.querySelectorAll('#viewBody .pay-chip.is-wait').length }`);
    check('картка рейсу: натиснув — отримано, рейс оплачено', all.st === 'paid' && all.wait === 0 && all.chipsWait === 0, all);
    await ev(`document.querySelector('#viewBody .pay-chip').click()`); await sleep(250);
    check('картка рейсу: повторне натискання повертає в «чекаємо»', await ev(`return Cloud._cache.trips.find((x) => x.id === 't1').payStatus === 'waiting'`));
    await ev(`document.querySelector('#viewModal [data-close]').click()`); await sleep(150);
    await ev(`document.querySelector('[data-settle-tab="customers"]').click()`); await sleep(200);
    await ev(`document.querySelector('[data-mark-paid]').click()`); await sleep(300);
    check('замовники: усе отримано — порожньо', await ev(`return /Усе оплачено/.test(document.querySelector('#settleView').innerText)`));

    // ===== Календар авто =====
    await go('');
    await ev(`const b = document.querySelector('[data-cal-shift="-1"]'); b.click()`); await sleep(200);
    const cal = await ev(`return { visible: !document.querySelector('#calendarSection').classList.contains('hidden'), label: document.querySelector('#calMonthLabel').innerText, rows: document.querySelectorAll('#calGrid tbody tr').length, trip: document.querySelectorAll('#calGrid .cal-c.is-trip').length }`);
    check('календар: 2 авто, жовтень, дні в рейсах', cal.visible && /Жовтень 2026/.test(cal.label) && cal.rows === 2 && cal.trip === 6, cal);
    await ev(`document.querySelector('[data-cal-free="c1|2026-10-10"]').click()`); await sleep(150);
    await ev(`const f = document.querySelector('#blockForm'); f.to.value = '2026-10-08'; f.requestSubmit()`); await sleep(200);
    check('календар: «по» раніше «з» — не приймається', await ev(`return !(Cloud._cache.settings.carBlocks || []).length`));
    await ev(`const f = document.querySelector('#blockForm'); f.to.value = '2026-10-12'; f.note.value = '<img src=x onerror=window.__xss=12>'; f.requestSubmit()`); await sleep(300);
    const blk = await ev(`return { n: (Cloud._cache.settings.carBlocks || []).length, rep: document.querySelectorAll('#calGrid .cal-c.is-repair').length, list: document.querySelector('#calBlocks').innerText }`);
    check('календар: ремонт 3 дні позначено', blk.n === 1 && blk.rep === 3 && /10\.10\.2026/.test(blk.list), blk);
    await shot('10-calendar');

    // ===== Резервна копія: кнопка в «Ставках», у файлі все, включно з календарем =====
    await ev(`document.querySelector('#settingsBtn').click()`); await sleep(200);
    const bi0 = await ev(`return document.querySelector('#backupInfo').innerText`);
    const bk = await ev(`
      let blob = null; const real = URL.createObjectURL; URL.createObjectURL = (b) => { blob = b; return 'blob:x'; };
      document.querySelector('#settingsModal [data-action="export-json"]').click(); URL.createObjectURL = real;
      const d = JSON.parse(await blob.text());
      return { trips: d.trips.length, cars: d.cars.length, drivers: d.drivers.length, payouts: d.settings.payouts.length, expenses: d.settings.expenses.length,
        blocks: d.settings.carBlocks.length, saved: Cloud._cache.settings.lastBackupAt, info: document.querySelector('#backupInfo').innerText, file: JSON.stringify(d) };`);
    check('бекап: «ще не робили», потім «сьогодні» і дата збережена', /ще не робили/.test(bi0) && /сьогодні/.test(bk.info) && /^\d{4}-\d{2}-\d{2}$/.test(bk.saved || ''), { bi0, info: bk.info, saved: bk.saved });
    check('бекап: у файлі рейси, водії, авто, розрахунки, витрати, календар', bk.trips > 0 && bk.cars === 2 && bk.drivers === 2 && bk.payouts > 0 && bk.expenses > 0 && bk.blocks === 1, { ...bk, file: undefined });
    await ev(`document.querySelector('#backupInfo').scrollIntoView({ block: 'center' })`);
    await shot('11-backup');
    await ev(`document.querySelector('#settingsModal [data-close]').click()`); await sleep(150);

    await ev(`document.querySelector('#calGrid .cal-c.is-repair button').click()`); await sleep(250);
    check('календар: клік по ремонту прибирає позначку', await ev(`return Cloud._cache.settings.carBlocks.length === 0`));

    // Відновлення з копії повертає ремонт у календар (раніше губився)
    await ev(`document.querySelector('#settingsBtn').click()`); await sleep(150);
    await ev(`
      const file = new File([${JSON.stringify(bk.file)}], 'b.json', { type: 'application/json' }); const dt = new DataTransfer(); dt.items.add(file);
      const inp = document.querySelector('#importFile'); inp.files = dt.files; inp.dispatchEvent(new Event('change'));`);
    await sleep(600);
    const rs = await ev(`return { trips: Cloud._cache.trips.length, blocks: (Cloud._cache.settings.carBlocks || []).length, rep: document.querySelectorAll('#calGrid .cal-c.is-repair').length, closed: document.querySelector('#settingsModal').classList.contains('hidden') }`);
    check('бекап: відновлення повертає рейси і календар ремонтів, «Ставки» закрито', rs.trips === bk.trips && rs.blocks === 1 && rs.rep === 3 && rs.closed, rs);
    await ev(`document.querySelector('#calGrid .cal-c.is-repair button').click()`); await sleep(250);

    // ===== Документи: ліцензія =====
    await ev(`document.querySelector('#refsBtn').click()`); await sleep(200);
    await ev(`document.querySelector('[data-edit-car="c1"]').click()`); await sleep(150);
    await ev(`const f = document.querySelector('#carForm'); f.licenseUntil.value = '2026-11-15'; f.permitUntil.value = 'xx'; f.requestSubmit()`); await sleep(300);
    const lic = await ev(`const c = Cloud._cache.cars.find((x) => x.id === 'c1'); return { l: c.licenseUntil, p: c.permitUntil }`);
    await ev(`document.querySelector('#refsModal [data-close]').click()`); await sleep(150);
    const rem2 = await ev(`return document.querySelector('#reminders').innerText`);
    check('документи: ліцензія збережена і в нагадуваннях', lic.l === '2026-11-15' && lic.p === '' && /Ліцензія/.test(rem2), { lic, rem2 });

    // ===== Telegram chat ID =====
    await ev(`document.querySelector('#settingsBtn').click()`); await sleep(150);
    await ev(`const f = document.querySelector('#settingsForm'); f.telegramChatId.value = 'abc<script>'; f.requestSubmit()`); await sleep(200);
    const tg0 = await ev(`return Cloud._cache.settings.telegramChatId`);
    await ev(`document.querySelector('#settingsBtn').click()`); await sleep(150);
    await ev(`const f = document.querySelector('#settingsForm'); f.telegramChatId.value = ' 123456789 '; f.requestSubmit()`); await sleep(200);
    const tg1 = await ev(`return Cloud._cache.settings.telegramChatId`);
    check('telegram: невірний chat ID не зберігається, правильний — так', tg0 === '' && tg1 === '123456789', { tg0, tg1 });

    // ===== Шапка не зсувається між вкладками =====
    await viewport(1900, 1000);
    const pos = [];
    for (const h of ['', '#trips', '#settle', '#expenses', '']) { await go(h); pos.push(await ev(`return ['#addTripBtn', '#settingsBtn', '#menuBtn', '.brand'].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().left)).join(',')`)); }
    check('шапка: кнопки на місці на всіх вкладках', new Set(pos).size === 1, pos);

    // ===== Навчалка: довідка і тури =====
    const runTour = async (key, label) => {
      await ev(`Guide.start(${JSON.stringify(key)})`); await sleep(450);
      const seen = []; const missing = [];
      for (let k = 0; k < 40; k++) {
        const a = await ev(`return Guide.active`);
        if (!a) break;
        seen.push(a.i);
        if (a.need && !a.target) missing.push(a.title);
        if (k === 3 || (key === 'driver' && k === 4)) await shot(`12-tour-${key}-${label}-${k}`);
        await ev(`document.querySelector('.tour-card [data-tour="next"]').click()`); await sleep(450);
      }
      const after = await ev(`return { active: !!Guide.active, root: !!document.querySelector('.tour-root'), trip: !document.querySelector('#tripModal').classList.contains('hidden'), hash: location.hash, overflow: document.body.style.overflow }`);
      check(`тур «${key}» (${label}): пройдено до кінця, усе підсвічено, екран повернуто`, seen.length > 3 && !missing.length && !after.active && !after.root && !after.trip && (after.hash === '' || after.hash === '#') && after.overflow === '', { seen, missing, after });
    };
    await go('');
    await ev(`document.querySelector('#helpBtn').click()`); await sleep(250);
    const help = await ev(`
      const out = { open: !document.querySelector('#helpModal').classList.contains('hidden'), faq: {} };
      for (const r of ['owner', 'partner', 'driver']) { document.querySelector('[data-help-role="' + r + '"]').click(); out.faq[r] = document.querySelectorAll('#helpBody .help-q').length; }
      document.querySelector('[data-help-role="owner"]').click();
      return out;`);
    check('довідка: відкривається, у кожного розділу є питання', help.open && help.faq.owner >= 5 && help.faq.partner >= 3 && help.faq.driver >= 5, help);
    await shot('12-help');
    await ev(`document.querySelector('#helpBody [data-start-tour="owner"]').click()`); await sleep(400);
    check('довідка: кнопка «Почати» закриває довідку і запускає тур', await ev(`return document.querySelector('#helpModal').classList.contains('hidden') && Guide.active && Guide.active.key === 'owner'`));
    await ev(`Guide.end()`); await sleep(200);
    for (const key of ['owner', 'partner', 'driver']) await runTour(key, 'пк');
    await viewport(390, 844, true);
    for (const key of ['owner', 'partner', 'driver']) await runTour(key, 'телефон');
    await ev(`try { localStorage.removeItem('oblik.guide.v1'); } catch (e) {} Guide.welcome()`); await sleep(250);
    await shot('12-welcome-phone');
    await ev(`document.querySelector('.tour-welcome [data-w="later"]').click()`); await sleep(150);
    check('привітання: зʼявляється один раз і закривається', await ev(`return !document.querySelector('.tour-welcome') && localStorage.getItem('oblik.guide.v1') === 'seen'`));
    await viewport(1400, 1000);

    // ===== Телефон: нічого не вилазить за екран =====
    await viewport(390, 844, true);
    for (const h of ['', '#trips', '#settle', '#expenses']) {
      await go(h);
      const over = await ev(`return document.documentElement.scrollWidth - window.innerWidth`);
      check(`телефон ${h || '#dashboard'}: без горизонтальної прокрутки`, over <= 1, over);
      await shot('07-mobile-' + (h.slice(1) || 'dashboard'));
    }
    await viewport(1400, 1000);

    // ===== Безпека: зловмисна «резервна копія» =====
    await open('#settle');
    await ev(`
      const data = { trips: [{ id: '"><img src=x onerror=window.__xss=2>', startDate: '<img src=x onerror=window.__xss=3>', customer: '<img src=x onerror=window.__xss=9>', payStatus: 'waiting', payDue: '<img src=x onerror=window.__xss=10>', managed: true, ownerName: '<img src=x onerror=window.__xss=4>', driverName: '<img src=x onerror=window.__xss=5>' }],
        settings: { payouts: [{ id: 'z', kind: 'driver', party: '"><img src=x onerror=window.__xss=6>', name: '<b>x</b>', date: '<img src=x onerror=window.__xss=7>', amount: 'abc' }],
                    carBlocks: [{ id: 'q', carId: 'c1', from: '2026-11-01', to: '2026-11-02', note: '<img src=x onerror=window.__xss=13>' }, { id: '"><img src=x onerror=window.__xss=14>', carId: 'c1', from: 'x', to: 'y' }],
                    expenses: [{ id: 'y', date: '2026-10-01', category: '<img src=x onerror=window.__xss=8>', amount: 5 }, { id: 'bad', date: 'zzz', amount: 9 }] } };
      const file = new File([JSON.stringify(data)], 'b.json', { type: 'application/json' }); const dt = new DataTransfer(); dt.items.add(file);
      const inp = document.querySelector('#importFile'); inp.files = dt.files; inp.dispatchEvent(new Event('change'));`);
    await sleep(600);
    for (const h of ['', '#trips', '#settle', '#expenses']) { await go(h); for (const t of ['owners', 'partner', 'drivers', 'customers']) { if (h === '#settle') { await ev(`document.querySelector('[data-settle-tab="${t}"]').click()`); await sleep(150); } } }
    await ev(`let html = ''; const real = window.open; window.open = () => ({ document: { open() {}, write(h) { html += h; }, close() {} } }); document.querySelector('[data-action="report-pdf"]').click(); window.open = real;`);
    check('безпека: код з підсунутого файлу не виконався', await ev(`return window.__xss === undefined`), await ev(`return String(window.__xss)`));
    check('безпека: зіпсований запис витрат відкинуто', await ev(`return Cloud._cache.settings.expenses.length === 1`));
  } catch (e) {
    check('сценарій пройшов без збоїв', false, e.message);
  }

  check('у браузері немає помилок JavaScript', pageErrors.length === 0, pageErrors);
  ws.close(); chrome.kill(); server.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} з ${results.length} перевірок пройшли. Скріни: ${OUT}`);
  process.exit(failed ? 1 : 0);
})();
