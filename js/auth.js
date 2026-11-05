/* Авторизація через Supabase (пошта + пароль) і запуск застосунку після входу */
(function () {
  'use strict';

  const ENV = window.ENV || {};
  const APP_SCRIPTS = ['js/calc.js', 'js/report.js', 'js/app.js', 'js/fx.js'];
  // Ключі старої локальної версії — для одноразового перенесення в хмару
  const LEGACY = {
    trips: 'truck-ledger.trips.v1',
    drivers: 'truck-ledger.drivers.v1',
    cars: 'truck-ledger.cars.v1',
    settings: 'truck-ledger.settings.v1',
  };
  const MIGRATED_KEY = 'truck-ledger.migrated-to-cloud';

  let db = null;

  // ---------- Допоміжне ----------
  function fatal(html) {
    document.getElementById('authScreen')?.remove();
    const box = document.createElement('div');
    box.id = 'authScreen';
    box.className = 'fixed inset-0 z-[100] grid place-items-center bg-ink-950 px-4';
    box.innerHTML = `<div class="w-full max-w-md rounded-2xl border border-rose-500/20 bg-ink-900 p-6 text-sm text-slate-300">${html}</div>`;
    document.body.appendChild(box);
  }
  /** Силуети панелі, що пульсують, поки тягнуться дані з хмари (замість голого «Завантаження…»). */
  function showSkeleton() {
    document.getElementById('authScreen')?.remove();
    const box = document.createElement('div');
    box.id = 'authScreen';
    box.className = 'skel-screen fixed inset-0 z-[100] overflow-hidden';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-busy', 'true');
    const b = (cls) => `<div class="skel ${cls}"></div>`;
    box.innerHTML = `
      <span class="sr-only">Завантаження даних…</span>
      <div class="skel-header" aria-hidden="true">
        <div class="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          ${b('h-10 w-10 rounded-xl')}${b('hidden h-5 w-32 md:block')}
          <div class="ml-auto flex gap-2">${b('h-10 w-10 rounded-xl')}${b('hidden h-10 w-36 rounded-xl md:block')}</div>
        </div>
      </div>
      <div class="mx-auto max-w-7xl space-y-6 px-4 pt-6 sm:px-6 sm:pt-8" aria-hidden="true">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div class="space-y-2">${b('h-8 w-64 max-w-full')}${b('h-4 w-28')}</div>
          <div class="grid grid-cols-2 gap-2 sm:flex">${b('h-11 sm:w-32')}${b('h-11 sm:w-36')}</div>
        </div>
        <div class="grid gap-3 sm:gap-4 md:grid-cols-3">${b('h-32')}${b('h-32')}${b('h-32')}</div>
        <div class="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">${b('h-24')}${b('h-24')}${b('h-24')}${b('h-24')}</div>
        <div class="grid gap-4 lg:grid-cols-3">${b('h-80 lg:col-span-2')}${b('h-80')}</div>
      </div>`;
    document.body.appendChild(box);
  }
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Не вдалося завантажити ' + src));
      document.body.appendChild(s);
    });
  }
  function translateError(err) {
    const m = (err && (err.message || err.error_description)) || String(err);
    if (/invalid login credentials/i.test(m)) return 'Невірна пошта або пароль.';
    if (/email not confirmed/i.test(m)) return 'Пошту не підтверджено. Перевірте лист від Supabase.';
    if (/rate limit|too many/i.test(m)) return 'Забагато спроб. Спробуйте трохи пізніше.';
    if (/failed to fetch|network/i.test(m)) return 'Немає зʼєднання з сервером. Перевірте інтернет.';
    return m;
  }

  // ---------- Перенесення старих локальних даних ----------
  function readLegacy() {
    const out = {};
    for (const [key, ls] of Object.entries(LEGACY)) {
      try {
        const raw = localStorage.getItem(ls);
        if (raw) out[key] = JSON.parse(raw);
      } catch (e) { /* ignore */ }
    }
    return out;
  }
  async function migrateLegacy() {
    if (localStorage.getItem(MIGRATED_KEY)) return;
    const local = readLegacy();
    const n = Array.isArray(local.trips) ? local.trips.length : 0;
    if (!n && !(local.drivers || []).length && !(local.cars || []).length) return;
    const cloudTrips = Cloud.get('trips', []);
    const msg = cloudTrips.length
      ? `На цьому пристрої є старі локальні дані (рейсів: ${n}), а в хмарі вже є ${cloudTrips.length}.\n\nЗАМІНИТИ хмарні дані локальними? (Скасувати — залишити хмарні)`
      : `На цьому пристрої знайдено локальні дані (рейсів: ${n}).\n\nПеренести їх у ваш хмарний акаунт?`;
    if (confirm(msg)) {
      for (const [key, value] of Object.entries(local)) Cloud.set(key, value);
      await Cloud.flush();
      if (Cloud.status() === 'error') throw new Error('Не вдалося завантажити локальні дані в хмару');
    }
    localStorage.setItem(MIGRATED_KEY, new Date().toISOString());
  }

  // ---------- Запуск застосунку ----------
  async function startApp(user) {
    showSkeleton();
    try {
      await Cloud.init(db, user.id);
      await migrateLegacy();
    } catch (e) {
      console.error(e);
      fatal(`<p class="mb-3 font-semibold text-rose-300">Не вдалося завантажити дані з хмари</p>
        <p class="mb-4 text-slate-400">${translateError(e).replace(/</g, '&lt;')}</p>
        <div class="flex gap-2">
          <button id="retryBtn" class="btn-primary">Спробувати ще раз</button>
          <button id="reloginBtn" class="btn-ghost">Увійти заново</button>
        </div>`);
      document.getElementById('retryBtn').onclick = () => location.reload();
      document.getElementById('reloginBtn').onclick = async () => { await db.auth.signOut().catch(() => {}); location.reload(); };
      return;
    }
    localStorage.removeItem('truck-ledger.auth.v1');
    localStorage.removeItem('truck-ledger.auth.attempts');
    document.getElementById('authScreen')?.remove();
    document.documentElement.classList.remove('auth-locked');
    setupHeader(user);
    for (const src of APP_SCRIPTS) await loadScript(src);
  }

  function setupHeader(user) {
    const who = document.getElementById('userEmail');
    if (who) who.textContent = user.email || '';
    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
      await Cloud.flush();
      if (Cloud.status() === 'error' && !confirm('Деякі зміни ще не збережено в хмару. Все одно вийти?')) return;
      await db.auth.signOut();
      location.reload();
    });

    const sync = document.getElementById('syncStatus');
    if (sync) {
      const view = {
        saved: ['cloud', 'text-emerald-400', 'Усі зміни збережено в хмарі'],
        saving: ['cloud-upload', 'text-sky-400 animate-pulse', 'Збереження…'],
        error: ['cloud-off', 'text-rose-400', 'Немає звʼязку з хмарою — повторимо автоматично'],
      };
      const paint = (st) => {
        const [icon, cls, title] = view[st];
        sync.title = title;
        sync.innerHTML = `<i data-lucide="${icon}" class="h-4 w-4 ${cls}"></i>`;
        if (window.lucide) window.lucide.createIcons();
      };
      Cloud.on('status', paint);
      paint(Cloud.status());
    }

    // Сесію завершено (напр. вихід на іншій вкладці) — повертаємось на екран входу
    db.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') location.reload(); });
  }

  // ---------- Екран входу ----------
  function renderLogin() {
    document.getElementById('authScreen')?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'authScreen';
    wrap.className = 'fixed inset-0 z-[100] grid place-items-center bg-ink-950/40 px-4';
    wrap.innerHTML = `
      <div class="auth-road" aria-hidden="true"></div>
      <form id="authForm" class="auth-card relative w-full max-w-sm p-6 sm:p-8" novalidate>
        <div class="mb-7 flex items-center gap-3">
          <span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4.5 21 9.5 3" /><path d="M19.5 21 14.5 3" /><path class="brand-lane" d="M12 21V3" stroke-dasharray="3.2 3.2" /></svg></span>
          <div class="leading-tight">
            <div class="brand-name">Облік рейсів</div>
            <div class="mt-1 text-xs text-slate-400">Увійдіть, щоб побачити свої рейси</div>
          </div>
        </div>
        <label class="mb-1 block text-xs font-medium text-slate-400" for="authEmail">Пошта</label>
        <input id="authEmail" name="email" type="email" class="input mb-4 w-full" autocomplete="username" autocapitalize="off" spellcheck="false" required />
        <label class="mb-1 block text-xs font-medium text-slate-400" for="authPass">Пароль</label>
        <div class="relative mb-5">
          <input id="authPass" name="password" type="password" class="input w-full pr-10" autocomplete="current-password" required />
          <button type="button" id="authToggle" class="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white" aria-label="Показати пароль">
            <i data-lucide="eye" class="h-4 w-4"></i>
          </button>
        </div>
        <p id="authError" class="mb-4 hidden rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300"></p>
        <button id="authSubmit" type="submit" class="btn-primary w-full justify-center">
          <i data-lucide="log-in" class="h-4 w-4"></i><span>Увійти</span>
        </button>
      </form>`;
    document.body.appendChild(wrap);
    if (window.lucide) window.lucide.createIcons();

    const form = wrap.querySelector('#authForm');
    const err = wrap.querySelector('#authError');
    const submit = wrap.querySelector('#authSubmit');
    const pass = wrap.querySelector('#authPass');
    const label = (t) => { const s = submit.querySelector('span'); if (s) s.textContent = t; };
    const showError = (msg) => { err.textContent = msg; err.classList.remove('hidden'); };

    wrap.querySelector('#authToggle').addEventListener('click', () => {
      pass.type = pass.type === 'password' ? 'text' : 'password';
    });
    wrap.querySelector('#authEmail').focus();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.classList.add('hidden');
      const email = form.email.value.trim();
      const password = form.password.value;
      if (!email || !password) return showError('Введіть пошту і пароль.');

      submit.disabled = true;
      label('Вхід…');
      try {
        const { data, error } = await db.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await startApp(data.user);
      } catch (ex) {
        pass.value = '';
        showError(translateError(ex));
        submit.disabled = false;
        label('Увійти');
      }
    });
  }

  // ---------- Старт ----------
  async function init() {
    if (!ENV.SUPABASE_URL || !ENV.SUPABASE_ANON_KEY || /YOUR-/.test(ENV.SUPABASE_URL)) {
      return fatal(`<p class="mb-2 font-semibold text-rose-300">Хмарну базу не налаштовано</p>
        <p class="text-slate-400">Не задано <code>SUPABASE_URL</code> / <code>SUPABASE_ANON_KEY</code>.
        Для деплою додайте їх у змінні оточення Netlify/Vercel, для локального запуску —
        скопіюйте <code>js/env.example.js</code> у <code>js/env.js</code>. Див. README.</p>`);
    }
    if (!window.supabase || !window.Cloud) {
      return fatal('<p class="text-rose-300">Не вдалося завантажити бібліотеку Supabase. Перевірте інтернет і оновіть сторінку.</p>');
    }
    db = window.supabase.createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'truck-ledger.supabase.auth' },
    });
    showSkeleton();
    const { data } = await db.auth.getSession();
    if (data.session) return startApp(data.session.user);
    renderLogin();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
