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
    check('розрахунки: три розділи і без фільтрів', st.tabs.length === 3 && st.filtersHidden, st.tabs);
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

    // ===== Рейс на авто під управлінням =====
    await ev(`document.querySelector('#addTripBtn').click()`); await sleep(250);
    await ev(`const f = document.querySelector('#tripForm'); f.carId.value = 'c2'; f.carId.dispatchEvent(new Event('change', { bubbles: true })); f.odoStart.value = 52000; f.odoEnd.value = 52500; f.bank.value = 30000; f.dispatchEvent(new Event('input', { bubbles: true }))`); await sleep(200);
    check('форма рейсу: частка 30% підставилась', await ev(`return document.querySelector('#tripForm').mgmtShare.value === '30' && !document.querySelector('#mgmtShareWrap').classList.contains('hidden')`));
    await ev(`document.querySelector('#tripForm').requestSubmit()`); await sleep(300);
    check('рейс збережено як «під управлінням»', await ev(`const t = Cloud._cache.trips.at(-1); return t.managed === true && t.ownerName === 'Петренко Іван' && t.mgmtShare === 30`));

    // ===== Шапка не зсувається між вкладками =====
    await viewport(1900, 1000);
    const pos = [];
    for (const h of ['', '#trips', '#settle', '#expenses', '']) { await go(h); pos.push(await ev(`return ['#addTripBtn', '#settingsBtn', '#menuBtn', '.brand'].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().left)).join(',')`)); }
    check('шапка: кнопки на місці на всіх вкладках', new Set(pos).size === 1, pos);

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
      const data = { trips: [{ id: '"><img src=x onerror=window.__xss=2>', startDate: '<img src=x onerror=window.__xss=3>', managed: true, ownerName: '<img src=x onerror=window.__xss=4>', driverName: '<img src=x onerror=window.__xss=5>' }],
        settings: { payouts: [{ id: 'z', kind: 'driver', party: '"><img src=x onerror=window.__xss=6>', name: '<b>x</b>', date: '<img src=x onerror=window.__xss=7>', amount: 'abc' }],
                    expenses: [{ id: 'y', date: '2026-10-01', category: '<img src=x onerror=window.__xss=8>', amount: 5 }, { id: 'bad', date: 'zzz', amount: 9 }] } };
      const file = new File([JSON.stringify(data)], 'b.json', { type: 'application/json' }); const dt = new DataTransfer(); dt.items.add(file);
      const inp = document.querySelector('#importFile'); inp.files = dt.files; inp.dispatchEvent(new Event('change'));`);
    await sleep(600);
    for (const h of ['', '#trips', '#settle', '#expenses']) { await go(h); for (const t of ['owners', 'partner', 'drivers']) { if (h === '#settle') { await ev(`document.querySelector('[data-settle-tab="${t}"]').click()`); await sleep(150); } } }
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
