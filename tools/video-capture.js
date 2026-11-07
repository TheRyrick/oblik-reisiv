#!/usr/bin/env node
/*
 * Кадри для відео-навчалки власника: node tools/video-capture.js
 * Запускає сайт локально з ТЕСТОВИМИ даними (tests/e2e/mock.js), відкриває Chrome без вікна
 * з екраном як у ноутбука, проходить тур «owner» і зберігає скрін кожного кроку
 * у video/public/owner/ + steps.json (заголовок кроку і де підсвічено).
 * Справжня база не використовується.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TOUR = 'owner';
const OUT = path.join(ROOT, 'video', 'public', TOUR);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'oblik-video-'));
const PORT = 8890 + Math.floor(Math.random() * 100);
const DEBUG_PORT = 9490 + Math.floor(Math.random() * 100);
const W = 1440, H = 900, DPR = 2; // екран ноутбука, кадри 2880×1800 — чіткі у Full HD навіть із наближенням
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  const c = [process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'];
  return c.find((p) => p && fs.existsSync(p));
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
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

(async () => {
  const chromePath = findChrome();
  if (!chromePath) { console.error('Не знайдено Chrome / Edge (CHROME_PATH).'); process.exit(2); }
  fs.mkdirSync(OUT, { recursive: true });
  // старі кадри прибираємо, озвучку (папка voice/) не чіпаємо
  for (const f of fs.readdirSync(OUT)) if (/\.png$|^steps\.json$/.test(f)) fs.rmSync(path.join(OUT, f));
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const chrome = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', `--user-data-dir=${path.join(TMP, 'profile')}`, 'about:blank'], { stdio: 'ignore' });
  let targets = [];
  for (let i = 0; i < 60 && !targets.some((t) => t.type === 'page'); i++) { try { targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json(); } catch (e) { /* стартує */ } await sleep(200); }
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval error');
    return r.result.result.value;
  };
  const shot = async (name) => { await sleep(350); const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name), Buffer.from(r.result.data, 'base64')); };
  const spotRect = () => ev(`const s = document.querySelector('.tour-spot'); if (!s || s.classList.contains('hidden')) return null;
    const r = s.getBoundingClientRect(); return { x: r.left / ${W}, y: r.top / ${H}, w: r.width / ${W}, h: r.height / ${H} };`);
  const rectOf = (sel) => ev(`const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();
    return { x: r.left / ${W}, y: r.top / ${H}, w: r.width / ${W}, h: r.height / ${H} };`);

  let code = 0;
  try {
    await send('Runtime.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: false });
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
    for (let i = 0; i < 80; i++) { try { if (await ev('return !!window.__ready')) break; } catch (e) { /* вантажиться */ } await sleep(150); }
    await sleep(1800);
    // Картку туру ховаємо — текст покаже саме відео; підсвітка лишається
    await ev(`const st = document.createElement('style'); st.textContent = '.tour-card{opacity:0!important}'; document.head.appendChild(st);`);
    await shot('00-home.png');

    await ev(`Guide.start(${JSON.stringify(TOUR)})`); await sleep(600);
    const steps = [];
    for (let k = 0; k < 40; k++) {
      const a = await ev(`const a = Guide.active; return a ? { title: a.title } : null;`);
      if (!a) break;
      await sleep(500);
      const file = `step-${String(k + 1).padStart(2, '0')}.png`;
      await shot(file);
      steps.push({ file, title: a.title, rect: await spotRect() });
      await ev(`document.querySelector('.tour-card [data-tour="next"]').click()`); await sleep(650);
    }

    // Бонус: натиснули на «Чистий прибуток» — сайт розписує розрахунок
    await ev(`location.hash = ''`); await sleep(500);
    await ev(`window.scrollTo(0, document.querySelector('#kpiMain').getBoundingClientRect().top + scrollY - 160)`); await sleep(500);
    await shot('kpi-before.png');
    const netRect = await rectOf('#kpiMain [data-kpi="net"]');
    await ev(`document.querySelector('#kpiMain [data-kpi="net"]').click()`); await sleep(900);
    await shot('kpi-explain.png');

    fs.writeFileSync(path.join(OUT, 'steps.json'), JSON.stringify({ size: { w: W * DPR, h: H * DPR }, steps, kpi: { file: 'kpi-before.png', rect: netRect } }, null, 2));
    console.log(`Готово: ${steps.length} кроків → ${OUT}`);
    console.log(steps.map((s) => `${s.file}  ${s.title}  ${s.rect ? 'підсвічено' : '—'}`).join('\n'));
  } catch (e) {
    console.error(e); code = 1;
  } finally {
    ws.close(); chrome.kill(); server.close();
    setTimeout(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* Chrome ще тримає файли */ } process.exit(code); }, 500);
  }
})();
