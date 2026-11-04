/*
 * Хмарне сховище (Supabase). Дані користувача — рядки таблиці app_data:
 * один рядок на ключ (trips, drivers, cars, settings), значення — JSON.
 *
 * Читання синхронне — з кешу, завантаженого під час входу.
 * Запис асинхронний: зміни збираються і відправляються пакетом, з повтором при помилці.
 */
(function () {
  'use strict';

  const TABLE = 'app_data';
  const KEYS = ['trips', 'drivers', 'cars', 'settings'];
  const DEBOUNCE_MS = 400;
  const RETRY_MS = 5000;

  let db = null;
  let userId = null;
  const cache = {};      // key -> value
  const stamps = {};     // key -> updated_at (з сервера)
  const dirty = new Set();
  let timer = null;
  let inflight = null;
  let failed = false;
  const listeners = { remote: [], status: [], error: [] };

  const emit = (type, arg) => listeners[type].forEach((fn) => { try { fn(arg); } catch (e) { console.error(e); } });
  const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

  function status() {
    if (failed) return 'error';
    if (inflight || dirty.size) return 'saving';
    return 'saved';
  }
  const notifyStatus = () => emit('status', status());

  async function fetchAll() {
    const { data, error } = await db.from(TABLE).select('key, value, updated_at');
    if (error) throw error;
    return data || [];
  }

  async function init(client, uid) {
    db = client;
    userId = uid;
    for (const row of await fetchAll()) {
      cache[row.key] = row.value;
      stamps[row.key] = row.updated_at;
    }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
    window.addEventListener('online', () => { if (dirty.size) schedule(0); else refresh(); });
    window.addEventListener('beforeunload', (e) => {
      if (dirty.size || inflight) { flush(); e.preventDefault(); e.returnValue = ''; }
    });
  }

  function has(key) { return Object.prototype.hasOwnProperty.call(cache, key); }
  function get(key, fallback) { return has(key) ? clone(cache[key]) : fallback; }

  function set(key, value) {
    if (!KEYS.includes(key)) throw new Error('Unknown key: ' + key);
    cache[key] = clone(value);
    dirty.add(key);
    schedule(DEBOUNCE_MS);
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(flush, ms);
    notifyStatus();
  }

  /** Відправити всі незбережені зміни. Повертає Promise, що завершується після запису. */
  async function flush() {
    clearTimeout(timer);
    if (inflight) { await inflight; return dirty.size ? flush() : undefined; }
    if (!dirty.size) return;
    const keys = Array.from(dirty);
    dirty.clear();
    const rows = keys.map((key) => ({ user_id: userId, key, value: cache[key] }));
    inflight = (async () => {
      const { data, error } = await db.from(TABLE).upsert(rows, { onConflict: 'user_id,key' }).select('key, updated_at');
      if (error) throw error;
      for (const r of data || []) stamps[r.key] = r.updated_at;
    })();
    notifyStatus();
    try {
      await inflight;
      failed = false;
    } catch (err) {
      console.error('Cloud save failed', err);
      keys.forEach((k) => dirty.add(k));
      if (!failed) emit('error', err);
      failed = true;
      timer = setTimeout(flush, RETRY_MS);
    } finally {
      inflight = null;
      notifyStatus();
    }
  }

  /** Підтягнути зміни, зроблені на інших пристроях (якщо локально нічого не чекає відправки). */
  async function refresh() {
    if (!db || dirty.size || inflight) return;
    try {
      const rows = await fetchAll();
      if (dirty.size || inflight) return; // поки чекали — з'явились локальні зміни
      const changed = [];
      for (const row of rows) {
        if (stamps[row.key] !== row.updated_at) {
          cache[row.key] = row.value;
          stamps[row.key] = row.updated_at;
          changed.push(row.key);
        }
      }
      if (changed.length) emit('remote', changed);
    } catch (e) {
      console.warn('Cloud refresh failed', e);
    }
  }

  window.Cloud = {
    init, get, set, has, flush, refresh, status,
    on(type, fn) { listeners[type].push(fn); },
  };
})();
