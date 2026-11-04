/* Авторизація: екран входу, перевірка пароля, завантаження застосунку після входу */
(function () {
  'use strict';

  const cfg = window.AUTH_CONFIG;
  const SESSION_KEY = 'truck-ledger.auth.v1';
  const ATTEMPTS_KEY = 'truck-ledger.auth.attempts';
  const APP_SCRIPTS = ['js/calc.js', 'js/app.js'];

  // ---------- Криптографія ----------
  async function derive(password, salt, iterations) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations },
      key, 256
    );
    return Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  function safeEqual(a, b) {
    if (a.length !== b.length) return false;
    let r = 0;
    for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
  }
  // Токен сесії прив'язаний до поточного хешу: зміна пароля скидає всі входи
  async function sessionToken() {
    const data = new TextEncoder().encode(cfg.username + ':' + cfg.hash);
    const d = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // ---------- Сесія ----------
  function readSession() {
    for (const store of [sessionStorage, localStorage]) {
      try {
        const s = JSON.parse(store.getItem(SESSION_KEY) || 'null');
        if (s && s.token && (!s.exp || s.exp > Date.now())) return s;
        if (s) store.removeItem(SESSION_KEY);
      } catch (e) { /* ignore */ }
    }
    return null;
  }
  async function writeSession(remember) {
    const token = await sessionToken();
    const store = remember ? localStorage : sessionStorage;
    const exp = remember ? Date.now() + (cfg.rememberDays || 30) * 864e5 : 0;
    store.setItem(SESSION_KEY, JSON.stringify({ token, exp }));
  }
  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
  }

  // ---------- Захист від підбору ----------
  function getAttempts() {
    try { return JSON.parse(localStorage.getItem(ATTEMPTS_KEY)) || { n: 0, until: 0 }; }
    catch (e) { return { n: 0, until: 0 }; }
  }
  function failAttempt() {
    const a = getAttempts();
    a.n += 1;
    if (a.n >= 5) a.until = Date.now() + Math.min(15 * 60, 30 * 2 ** (a.n - 5)) * 1000; // 30с, 60с, 2хв… до 15хв
    localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(a));
    return a;
  }
  function resetAttempts() { localStorage.removeItem(ATTEMPTS_KEY); }

  // ---------- Запуск застосунку ----------
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Не вдалося завантажити ' + src));
      document.body.appendChild(s);
    });
  }
  async function startApp() {
    document.getElementById('authScreen')?.remove();
    document.documentElement.classList.remove('auth-locked');
    addLogoutButton();
    for (const src of APP_SCRIPTS) await loadScript(src);
  }
  function addLogoutButton() {
    const btn = document.getElementById('logoutBtn');
    if (!btn) return;
    btn.addEventListener('click', () => { clearSession(); location.reload(); });
  }

  // ---------- Екран входу ----------
  function renderLogin() {
    const wrap = document.createElement('div');
    wrap.id = 'authScreen';
    wrap.className = 'fixed inset-0 z-[100] grid place-items-center bg-ink-950 px-4';
    wrap.innerHTML = `
      <div class="pointer-events-none absolute inset-0 overflow-hidden">
        <div class="absolute -top-40 -left-40 h-[28rem] w-[28rem] rounded-full bg-indigo-600/20 blur-3xl"></div>
        <div class="absolute bottom-0 -right-40 h-[26rem] w-[26rem] rounded-full bg-emerald-500/10 blur-3xl"></div>
      </div>
      <form id="authForm" class="relative w-full max-w-sm rounded-2xl border border-white/10 bg-ink-900/80 p-6 shadow-2xl backdrop-blur-xl sm:p-8" novalidate>
        <div class="mb-6 flex items-center gap-3">
          <div class="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-emerald-500 shadow-lg shadow-indigo-500/30">
            <i data-lucide="lock-keyhole" class="h-5 w-5 text-white"></i>
          </div>
          <div class="leading-tight">
            <div class="text-lg font-bold text-white">Облік рейсів</div>
            <div class="text-xs text-slate-400">Вхід лише для власника</div>
          </div>
        </div>
        <label class="mb-1 block text-xs font-medium text-slate-400" for="authUser">Логін</label>
        <input id="authUser" name="username" type="text" class="input mb-4 w-full" autocomplete="username" autocapitalize="off" spellcheck="false" required />
        <label class="mb-1 block text-xs font-medium text-slate-400" for="authPass">Пароль</label>
        <div class="relative mb-4">
          <input id="authPass" name="password" type="password" class="input w-full pr-10" autocomplete="current-password" required />
          <button type="button" id="authToggle" class="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white" aria-label="Показати пароль">
            <i data-lucide="eye" class="h-4 w-4"></i>
          </button>
        </div>
        <label class="mb-5 flex cursor-pointer items-center gap-2 text-sm text-slate-300">
          <input id="authRemember" type="checkbox" class="h-4 w-4 accent-indigo-500" /> Запам'ятати мене на ${cfg.rememberDays || 30} днів
        </label>
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
    const showError = (msg) => { err.textContent = msg; err.classList.remove('hidden'); };

    wrap.querySelector('#authToggle').addEventListener('click', () => {
      pass.type = pass.type === 'password' ? 'text' : 'password';
    });
    wrap.querySelector('#authUser').focus();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.classList.add('hidden');
      const a = getAttempts();
      if (a.until > Date.now()) {
        return showError(`Забагато спроб. Спробуйте через ${Math.ceil((a.until - Date.now()) / 1000)} с.`);
      }
      const user = form.username.value.trim();
      const pwd = form.password.value;
      if (!user || !pwd) return showError('Введіть логін і пароль.');

      submit.disabled = true;
      submit.querySelector('span').textContent = 'Перевірка…';
      try {
        const h = await derive(pwd, cfg.salt, cfg.iterations);
        const okUser = safeEqual(user, cfg.username);
        const ok = safeEqual(h, cfg.hash) && okUser;
        if (ok) {
          resetAttempts();
          await writeSession(wrap.querySelector('#authRemember').checked);
          await startApp();
          return;
        }
        const f = failAttempt();
        pass.value = '';
        showError(f.until > Date.now() ? 'Невірний логін або пароль. Вхід тимчасово заблоковано.' : 'Невірний логін або пароль.');
      } catch (ex) {
        showError('Помилка: ' + ex.message);
      } finally {
        submit.disabled = false;
        const span = submit.querySelector('span');
        if (span) span.textContent = 'Увійти';
      }
    });
  }

  // ---------- Старт ----------
  async function init() {
    if (!cfg || !window.crypto || !crypto.subtle) {
      document.body.innerHTML = '<p style="padding:2rem;color:#fca5a5;font-family:sans-serif">Авторизація недоступна: відкрийте сайт через HTTPS або localhost.</p>';
      document.documentElement.classList.remove('auth-locked');
      return;
    }
    const s = readSession();
    if (s && safeEqual(s.token, await sessionToken())) return startApp();
    clearSession();
    renderLogin();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
