/* Візуальні ефекти: підсвітка під курсором, 3D-нахил блоків, поява сторінки,
   «докручування» цифр, плавне перемикання вкладок. Лише оформлення — дані не змінює. */
(function () {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  // ---------- Підсвітка під курсором + легкий 3D-нахил ----------
  // Підсвічуються: показники, картки, рядки рейсів, мобільні картки рейсів, блоки перегляду.
  const GLOW = '.kpi, .card, .row-hover, #tripsCards > article, .view-block';
  const TILT = '.kpi';          // нахиляємо лише невеликі блоки (графік нахиляти не варто)
  const MAX_TILT = 5;           // градусів

  let active = null;
  let frame = 0;
  let lastEvt = null;

  function reset(el) {
    if (!el) return;
    el.classList.remove('fx-hover');
    el.style.removeProperty('--rx');
    el.style.removeProperty('--ry');
  }

  function paint() {
    frame = 0;
    const e = lastEvt;
    if (!e) return;
    const el = e.target.closest && e.target.closest(GLOW);
    if (el !== active) { reset(active); active = el; }
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    el.style.setProperty('--mx', x + 'px');
    el.style.setProperty('--my', y + 'px');
    el.classList.add('fx-hover');
    if (!reduceMotion && el.matches(TILT)) {
      const px = x / r.width - 0.5;
      const py = y / r.height - 0.5;
      el.style.setProperty('--rx', (-py * MAX_TILT).toFixed(2) + 'deg');
      el.style.setProperty('--ry', (px * MAX_TILT).toFixed(2) + 'deg');
    }
  }

  if (finePointer) {
    document.addEventListener('pointermove', (e) => {
      lastEvt = e;
      if (!frame) frame = requestAnimationFrame(paint);
    }, { passive: true });
    document.addEventListener('pointerleave', () => { reset(active); active = null; });
    window.addEventListener('blur', () => { reset(active); active = null; });
  }

  // ---------- «Докручування» цифр у показниках ----------
  // Розбираємо текст типу «24 482 ₴», «25,76 ₴», «-1 360 ₴», «23».
  // (\s у JS уже включає нерозривні пробіли, якими Intl розділяє тисячі)
  const NUM_RE = /^(\D*?)([-−]?)(\d(?:[\d\s]*\d)?(?:,\d+)?)(.*)$/;
  const memory = new Map(); // підпис показника -> останнє значення

  function parse(text) {
    const m = NUM_RE.exec(text.trim());
    if (!m) return null;
    const [, pre, sign, digits, post] = m;
    const clean = digits.replace(/\s/g, '');
    const dec = clean.includes(',') ? clean.split(',')[1].length : 0;
    const value = parseFloat(clean.replace(',', '.')) * (sign ? -1 : 1);
    return Number.isFinite(value) ? { pre, post, dec, value, sign } : null;
  }

  function countUp(el, key) {
    const p = parse(el.textContent);
    if (!p) return;
    const from = memory.has(key) ? memory.get(key) : 0;
    memory.set(key, p.value);
    if (reduceMotion || from === p.value) return;
    const fmt = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: p.dec, maximumFractionDigits: p.dec });
    const final = el.textContent;
    const dur = 900;
    const t0 = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 4);
    function step(now) {
      if (!el.isConnected) return;
      // rAF може дати час трохи раніше за t0 — не пускаємо t у мінус
      const t = Math.min(1, Math.max(0, (now - t0) / dur));
      const v = from + (p.value - from) * ease(t);
      el.textContent = t < 1 ? p.pre + fmt.format(v) + p.post : final;
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function animateKpis() {
    $$('#kpiMain .kpi, #kpis .kpi').forEach((card) => {
      const label = card.firstElementChild?.textContent.trim() || '';
      const val = card.querySelector('.kpi-value');
      if (val) countUp(val, label);
    });
  }

  // ---------- Смужки «Куди йдуть гроші» ростуть з нуля ----------
  function growBars() {
    if (reduceMotion) return;
    const bars = $$('#structBar > .seg, #structure .bar > i');
    const widths = bars.map((b) => b.style.width);
    bars.forEach((b) => { b.style.transition = 'none'; b.style.width = '0%'; });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      bars.forEach((b, i) => {
        b.style.transition = `width .9s cubic-bezier(.2,.8,.2,1) ${i * 45}ms`;
        b.style.width = widths[i];
      });
    }));
  }

  // ---------- Поява блоків (каскадом) ----------
  function stagger(root) {
    if (reduceMotion || !root) return;
    const items = $$('#kpiMain > .kpi, #kpis > .kpi, :scope > section > .card, :scope > section.card, #tripsCards > article, #tripsTable > tr', root);
    const list = items.length ? items : [root];
    list.forEach((el, i) => {
      el.classList.remove('fx-enter');
      el.style.setProperty('--i', Math.min(i, 18));
      void el.offsetWidth; // перезапуск анімації
      el.classList.add('fx-enter');
    });
  }

  // ---------- Плавне перемикання вкладок ----------
  function currentRoot() {
    return location.hash === '#trips' ? $('#tripsView') : $('#dashboardView');
  }
  window.addEventListener('hashchange', () => {
    const root = currentRoot();
    if (!root || reduceMotion) return;
    root.classList.remove('fx-view');
    void root.offsetWidth;
    root.classList.add('fx-view');
    if (root.id === 'dashboardView') { memory.clear(); animateKpis(); growBars(); stagger(root); }
    else stagger(root);
  });

  // ---------- Слідкуємо за перемальовуванням панелі ----------
  // app.js перемальовує блоки через innerHTML — ловимо це і запускаємо анімації.
  let pending = false;
  const mo = new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; animateKpis(); growBars(); });
  });
  ['#kpiMain', '#structure'].forEach((s) => { const el = $(s); if (el) mo.observe(el, { childList: true }); });

  // Перший показ після входу
  animateKpis();
  growBars();
  stagger(currentRoot());
  document.body.classList.add('fx-ready');
})();
