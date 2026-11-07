/*
 * Навчалка: довідка (кнопка «?» у шапці) + покрокові тури, що підсвічують елементи сайту.
 * Три розділи: власник бізнесу, компаньйон, водій / логіст.
 * Працює окремо від app.js: лише натискає наявні кнопки й перемикає вкладки через адресу (#trips тощо).
 * Увесь текст — наш власний (жодних даних користувача в innerHTML).
 */
(function () {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const SEEN_KEY = 'oblik.guide.v1';
  const isMobile = () => window.matchMedia('(max-width: 767px)').matches;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const store = {
    get() { try { return localStorage.getItem(SEEN_KEY); } catch (e) { return 'seen'; } },
    set() { try { localStorage.setItem(SEEN_KEY, 'seen'); } catch (e) { /* приватний режим — не страшно */ } },
  };
  const refreshIcons = () => { if (window.lucide) window.lucide.createIcons(); };

  /** Перший видимий елемент зі списку селекторів (на телефоні й компі кнопки різні). */
  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  }
  function pick(sel) {
    for (const s of [].concat(sel || [])) {
      const el = typeof s === 'function' ? s() : $(s);
      if (visible(el)) return el;
    }
    return null;
  }
  const fieldset = (name) => () => { const f = $(`#tripForm [name="${name}"]`); return f && f.closest('fieldset'); };

  // ---------- Навігація для турів ----------
  function go(view) {
    const cur = location.hash;
    if (view === 'dashboard') { if (cur && cur !== '#') location.hash = ''; }
    else if (cur !== '#' + view) location.hash = '#' + view;
  }
  const tripOpen = () => !$('#tripModal').classList.contains('hidden');
  function openTrip() { if (!tripOpen()) $('#addTripBtn').click(); }
  function closeTrip() { if (tripOpen()) $('#tripModal .modal-backdrop').click(); }
  function settleTab(key) { const b = $(`#settleView [data-settle-tab="${key}"]`); if (b && b.getAttribute('aria-selected') !== 'true') b.click(); }

  // ---------- Тексти турів ----------
  const M = (desk, mob) => () => (isMobile() ? mob : desk);

  const TOURS = {
    owner: {
      title: 'Власник бізнесу',
      steps: [
        { title: 'Привіт! 👋', text: M('Покажу, де що на сайті — це займе десь хвилину.<br>Гортай кнопками <b>«Далі» / «Назад»</b> або стрілками на клавіатурі.', 'Покажу, де що на сайті — це займе десь хвилину.<br>Гортай кнопками <b>«Далі» / «Назад»</b>.') },
        { view: 'dashboard', sel: ['.tabs', '.bottom-nav'], title: '4 розділи сайту', text: '<b>Панель</b> — головні цифри.<br><b>Рейси</b> — усі рейси.<br><b>Розрахунки</b> — хто кому винен.<br><b>Витрати</b> — витрати бізнесу (бухгалтер, штрафи…).' },
        { sel: ['#addTripBtn', '.bn-add'], title: 'Новий рейс', text: 'Найшвидше — вставити заявку чи звіт логіста з Телеграму: сайт сам візьме суми, маршрут і дату. Тобі лишиться дописати одометр і паливо.' },
        { sel: ['#refsBtn', '#menuBtn'], title: 'Водії та авто', text: M('Почни звідси: додай водіїв і авто. Там же — ТО, страховка, техогляд, ліцензія: сайт нагадає заздалегідь.', 'Почни звідси: меню <b>«Дані» → «Водії та авто»</b>. Додай водіїв і авто, а також ТО, страховку, техогляд — сайт нагадає заздалегідь.') },
        { sel: ['#settingsBtn', '#menuBtn'], title: 'Ставки', text: M('Добові, СТО, податок, % водія, компаньйона й логіста. Тут же — Telegram-нагадування і резервна копія.', 'Меню <b>«Дані» → «Ставки»</b>: добові, СТО, податок, % водія, компаньйона й логіста. Там же — Telegram-нагадування і резервна копія.') },
        { view: 'dashboard', sel: ['#filtersBox', '#filtersToggle'], title: 'Фільтри', text: M('Обери рік, місяць, водія чи авто — усі цифри на сторінці перерахуються під вибране.', 'Натисни <b>«Фільтри»</b> і обери рік, місяць, водія чи авто — усі цифри перерахуються під вибране.') },
        { sel: ['#kpiMain'], title: 'Головні цифри', text: '<b>Чистий прибуток бізнесу</b>, <b>частка компаньйона</b> і <b>твій прибуток</b>.<br>Натисни на будь-який блок — сайт розпише, як саме порахована сума.' },
        { sel: ['#reminders:not(.hidden)'], optional: true, title: 'Нагадування по авто', text: 'Скоро ТО, закінчується страховка чи ліцензія — побачиш тут. Кнопка «ТО зроблено» скидає лічильник.' },
        { sel: ['#dashExtra:not(:empty)'], optional: true, title: 'Борги й прогноз', text: 'Скільки замовники ще винні (і що прострочено) та прогноз на поточний місяць.' },
        { sel: [() => { const c = $('#chartBox'); return c && c.closest('.card'); }], title: 'Графік по місяцях', text: 'Висота стовпчика — фрахт, кольори — куди пішли гроші. Натисни на місяць, щоб відфільтрувати його. Кнопка «Таблиця» — ті самі цифри числами.' },
        { sel: ['#calendarSection:not(.hidden)'], optional: true, title: 'Календар авто', text: 'Де яке авто кожного дня. Натисни на вільний день, щоб позначити ремонт.' },
        { view: 'trips', sel: [() => { const v = $('#tripsView'); return v && v.firstElementChild; }], title: 'Рейси', text: 'Усі рейси за вибраний період + пошук і вивантаження в Excel.<br>Натисни на рейс — побачиш деталі, а також <b>PDF</b>, <b>Дублювати</b> і <b>Редагувати</b>.' },
        { view: 'settle', sel: ['#settleView .settle-tabs', '#settleView'], title: 'Розрахунки', text: 'Хто кому винен: <b>власники авто</b>, <b>компаньйон</b>, <b>водії</b>, <b>замовники</b>. Нараховане сайт рахує сам, а виплати ти записуєш кнопкою «Я виплатив».' },
        { view: 'expenses', sel: ['#expenseForm'], title: 'Витрати бізнесу', text: 'Те, що не прив’язане до рейсу: бухгалтер, телефон, штрафи. Вони зменшують твій прибуток, але не частку компаньйона.' },
        { view: 'dashboard', sel: ['#menuBtn'], title: 'Меню «Дані»', text: 'Звіт PDF за період, Excel, резервна копія, вихід з акаунта.' },
        { sel: ['#helpBtn'], title: 'Довідка завжди тут', text: 'Натисни <b>«?»</b>, щоб пройти тур ще раз або знайти відповідь на питання. Успіхів! 🚛' },
      ],
    },
    partner: {
      title: 'Компаньйон',
      steps: [
        { title: 'Режим компаньйона 🤝', text: 'Покажу, де дивитись частку компаньйона і скільки вже виплачено. Це 5 кроків.' },
        { view: 'dashboard', sel: ['#filtersBox', '#filtersToggle'], title: 'Обери період', text: M('Наприклад, рік і місяць — цифри нижче покажуть саме цей період.', 'Натисни <b>«Фільтри»</b> і обери, наприклад, рік і місяць — цифри нижче покажуть саме цей період.') },
        { sel: ['#kpiMain [data-kpi="partner"]', '#kpiMain'], title: 'Частка компаньйона', text: 'Скільки нараховано компаньйону за період — відсоток від чистого прибутку кожного рейсу. Натисни на блок — сайт розпише розрахунок по кроках.' },
        { view: 'settle', before: () => settleTab('partner'), sel: ['#settleView [data-settle-tab="partner"]'], title: 'Розрахунки → Компаньйон', text: 'Тут видно: скільки нараховано по місяцях, скільки вже виплачено і хто кому зараз винен.' },
        { view: 'dashboard', sel: ['#dashboardView [data-action="report-pdf"]'], title: 'Звіт PDF', text: 'Звіт за вибраний період — можна зберегти або переслати.' },
        { sel: ['#helpBtn'], title: 'Питання? Сюди', text: 'У довідці — як рахується частка і що на неї впливає.' },
      ],
    },
    driver: {
      title: 'Водій / логіст',
      steps: [
        { title: 'Як внести рейс 🚛', text: 'Покажу форму рейсу по кроках. Нічого не збережеться, поки ти сам не натиснеш «Зберегти».' },
        { view: 'dashboard', sel: ['#addTripBtn', '.bn-add'], title: 'Новий рейс', text: 'Рейс додається цією кнопкою. Відкриваю форму…' },
        { trip: true, sel: [() => { const r = $('#reportInput'); return r && r.closest('fieldset'); }], title: 'Заявка або звіт з Телеграму', text: 'Скопіюй повідомлення з Телеграму і встав сюди як є. Сайт сам знайде суми з «грн», маршрут і дату, а кожну оплату покаже окремим рядком.' },
        { trip: true, sel: [fieldset('driverId')], title: 'Водій та авто', text: 'Обери зі списку. Якщо список порожній — водіїв і авто спершу додають у «Водії та авто».' },
        { trip: true, sel: [fieldset('startDate')], title: 'Дати та маршрут', text: 'Дата виїзду і повернення. Рейс зараховується в той місяць, коли <b>закінчився</b>.' },
        { trip: true, sel: [fieldset('odoStart')], title: 'Одометр', text: 'Пробіг на початку і в кінці рейсу. З цього рахуються кілометри й нагадування про ТО.' },
        { trip: true, sel: [fieldset('fuelLiters')], title: 'Паливо', text: '<b>Ціна для водія</b> — як на стелі АЗС, з неї рахується ЗП водія.<br><b>Фактична</b> — зі знижкою (якщо є). Не знаєш — лиши порожнім.' },
        { trip: true, sel: [fieldset('cash')], title: 'Сума фрахту', text: 'Готівка, безнал, карта — скільки отримали. Диспетчерські — що віддали посереднику. Нижче — <b>оплати по рядках</b>: галочка «отримано» на тих, що вже прийшли.' },
        { trip: true, sel: ['#preview'], title: 'Розрахунок наживо', text: 'Тут одразу видно ЗП водія, логіста і прибуток — оновлюється, поки заповнюєш.' },
        { trip: true, sel: ['#tripForm button[type="submit"]'], title: 'Зберегти', text: 'Перевір і натисни «Зберегти рейс». Помилився — відкрий рейс і натисни «Редагувати».' },
        { view: 'settle', before: () => settleTab('drivers'), sel: ['#settleView [data-settle-tab="drivers"]'], title: 'Розрахунки → Водії', text: 'Скільки водію нараховано (ЗП + добові), скільки вже виплачено і скільки лишилось.' },
        { view: 'dashboard', sel: ['#helpBtn'], title: 'Питання? Сюди', text: 'У довідці — як рахується ЗП водія і логіста, що таке диспетчерські тощо.' },
      ],
    },
  };

  // ---------- Довідка: питання-відповіді ----------
  const FAQ = {
    owner: [
      ['З чого почати', '<ol><li><b>Водії та авто</b> — додай водіїв і авто (на телефоні: меню «Дані» → «Водії та авто»).</li><li><b>Ставки</b> — перевір добові, СТО, податок, % водія, компаньйона й логіста.</li><li><b>Новий рейс</b> — кнопка «+». Найшвидше — вставити звіт з Телеграму.</li></ol>'],
      ['Як рахується прибуток', '<ol><li><b>Фрахт</b> = готівка + безнал + карта − диспетчерські.</li><li><b>Прибуток авто</b> = фрахт − паливо (за ціною для водія) − добові − інші витрати.</li><li><b>ЗП водія</b> = % від прибутку авто. <b>ЗП логіста</b> = % від фрахту.</li><li><b>Чистий прибуток бізнесу</b> = прибуток авто + знижка на паливо − податок (% від безналу) − СТО − ремонт − ЗП водія − ЗП логіста.</li><li><b>Компаньйону</b> = % від чистого прибутку.</li><li><b>Твій прибуток</b> = чистий − компаньйону − витрати бізнесу.</li></ol>Натисни на будь-який блок на панелі — сайт покаже розрахунок на твоїх цифрах.'],
      ['Замовник ще не заплатив', 'У рейсі є блок <b>«Оплати по рядках»</b>. Постав галочку «отримано» на оплачених — решта піде в борги: <b>«Розрахунки → Замовники»</b> і блок «Не оплачено» на панелі. Можна вказати «Чекаємо оплату до»; без дати сайт нагадає через 14 днів після рейсу.'],
      ['Як записати виплату компаньйону чи водію', '<b>Розрахунки</b> → потрібна вкладка (Компаньйон / Водії / Власники авто) → кнопка виплати → «Я виплатив» або «Мені повернули», сума і дата. Аванси й добові наперед водію — теж записуй як виплату. Сайт сам покаже, хто кому винен.'],
      ['Авто під управлінням (не моє)', '«Водії та авто» → олівець біля авто → галочка <b>«Під управлінням»</b> → власник і твоя частка. Прибуток після всіх витрат ділиться: твоя частка — тобі, решта — власнику. Компаньйон бере свій % від <b>твоєї</b> частки.'],
      ['Нагадування про ТО і документи', '«Водії та авто» → авто → <b>«ТО і документи»</b>. ТО сайт нагадає за 2 500 км, документи — за 30 днів. Нагадування видно на панелі, а якщо налаштовано Telegram — бот напише вранці.'],
      ['Telegram-бот', '«Ставки» → <b>Telegram chat ID</b>. Свій ID дізнаєшся в боті <b>@userinfobot</b>. Потім напиши будь-що <b>своєму</b> боту і натисни «Зберегти і надіслати тест».'],
      ['Резервна копія', '«Ставки» або меню «Дані» → <b>«Скачати копію»</b>. Збережи файл на Google Диск чи комп. «Відновити з копії» <b>замінює</b> поточні дані даними з файлу. Якщо налаштовано Telegram — 1-го числа бот нагадає зробити нову копію.'],
      ['Звіти PDF і Excel', 'Панель → <b>«Звіт PDF»</b> — за період, вибраний у фільтрах. Вкладка «Рейси» → <b>Excel</b>. Кожен рейс окремо — кнопки PDF / Excel у картці рейсу.'],
      ['Витрати бізнесу', 'Вкладка <b>«Витрати»</b>: бухгалтер, телефон, штрафи тощо. Постійну суму щомісяця можна задати в «Ставках». Вони зменшують чистий прибуток і твій прибуток, але <b>не</b> частку компаньйона. Дороги, стоянки й ремонт у рейсі внось у самому рейсі.'],
    ],
    partner: [
      ['Як рахується частка компаньйона', 'Відсоток (задається в «Ставках») від <b>чистого прибутку кожного рейсу</b> — тобто після палива, добових, податку, СТО, ремонту і всіх зарплат.<ul><li>Рейс у мінусі — частка 0, збиток компаньйону не віднімається.</li><li>Авто під управлінням — % від частки власника бізнесу, а не від усього прибутку.</li><li>Витрати бізнесу (бухгалтер, штрафи…) частку <b>не</b> зменшують.</li></ul>'],
      ['Де видно, скільки нараховано і виплачено', '<b>Розрахунки → Компаньйон</b>: нараховано по місяцях, усі виплати і поточний баланс («Ви винні компаньйону» або «Компаньйон винен вам»).'],
      ['Як перевірити суму за місяць', 'Панель → обери місяць у фільтрах → натисни блок <b>«2. Компаньйону»</b>. Сайт розпише розрахунок по кроках на реальних цифрах.'],
      ['Звіт за місяць', 'Панель → <b>«Звіт PDF»</b> — за вибраний у фільтрах період. Його можна зберегти або переслати.'],
    ],
    driver: [
      ['Як додати рейс', '<ol><li>Кнопка <b>«Новий рейс»</b> (на телефоні — жовтий «+» внизу).</li><li>Встав звіт з Телеграму в перше поле — сайт заповнить суми, маршрут і дату.</li><li>Обери водія й авто, впиши одометр і паливо.</li><li>Перевір розрахунок справа (на телефоні — внизу) → <b>«Зберегти рейс»</b>.</li></ol>'],
      ['Як рахується ЗП водія', '<b>% від прибутку авто</b>:<br>фрахт − паливо (за ціною для водія) − добові − інші витрати (дороги, стоянки).<ul><li>СТО, податок і ремонт на ЗП водія <b>не</b> впливають.</li><li>Якщо рейс у мінусі — ЗП 0.</li><li>Окремо нараховуються <b>добові</b> за кожну добу рейсу.</li></ul>'],
      ['Як рахується ЗП логіста', '<b>% від суми фрахту</b> (фрахт = готівка + безнал + карта − диспетчерські).'],
      ['Скільки діб у рейсі', 'Різниця між датою повернення і датою виїзду: з 01.05 по 03.05 — 2 доби. Рейс в один день — 1 доба.'],
      ['Паливо: чому дві ціни', '<b>Ціна для водія</b> — як на стелі АЗС, з неї рахується ЗП водія.<br><b>Фактична</b> — реальна ціна зі знижкою; з неї рахується прибуток бізнесу. Не знаєш — лиши порожнім, тоді береться ціна для водія.'],
      ['Готівка, безнал, карта, диспетчерські', 'Готівка / безнал / карта — скільки отримали за рейс. <b>Диспетчерські</b> — що віддали посереднику, який дав замовлення; у фрахт вони не входять. Податок рахується лише з безналу.'],
      ['Схожий рейс — швидше', 'Відкрий попередній рейс → <b>«Дублювати»</b>. Форма заповниться, лишиться змінити дати, одометр і суми.'],
      ['Помилився в рейсі', 'Відкрий рейс (натисни на нього в списку) → <b>«Редагувати»</b>. Видалити — там же, кнопка «Видалити».'],
    ],
  };

  // ---------- Тур ----------
  let tour = null; // { key, i, root, spot, card, openedTrip }

  function startTour(key) {
    endTour(false);
    closeHelp();
    const def = TOURS[key];
    if (!def) return;
    const root = document.createElement('div');
    root.className = 'tour-root';
    root.innerHTML = '<div class="tour-spot hidden"></div><div class="tour-card" role="dialog" aria-modal="true" aria-live="polite"></div>';
    document.body.appendChild(root);
    tour = { key, i: 0, root, spot: root.firstChild, card: root.lastChild, steps: def.steps, title: def.title, token: 0 };
    root.addEventListener('click', onTourClick);
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    document.addEventListener('keydown', onTourKey, true);
    store.set();
    show(0);
  }

  function endTour(done) {
    if (!tour) return;
    const t = tour;
    tour = null;
    window.removeEventListener('resize', place);
    document.removeEventListener('scroll', place, true);
    document.removeEventListener('keydown', onTourKey, true);
    t.root.remove();
    closeTrip();
    if (done !== false) {
      go('dashboard');
      window.scrollTo(0, 0);
    }
  }

  async function show(i, dir = 1) {
    if (!tour) return;
    const t = tour;
    const token = ++t.token;
    // Пропускаємо необовʼязкові кроки, яких зараз немає на екрані (напр. нема нагадувань)
    while (i >= 0 && i < t.steps.length) {
      const s = t.steps[i];
      await prepare(s);
      if (token !== t.token || tour !== t) return;
      if (!s.optional || pick(s.sel)) break;
      i += dir;
    }
    if (i < 0) i = 0;
    if (i >= t.steps.length) return endTour(true);
    t.i = i;
    const s = t.steps[i];
    t.target = s.sel ? pick(s.sel) : null;
    if (t.target) {
      const r = t.target.getBoundingClientRect();
      const tall = r.height > window.innerHeight * 0.6;
      t.target.scrollIntoView({ block: tall ? 'start' : 'center', behavior: 'auto' });
    }
    renderCard();
    place();
  }

  /** Підготувати екран під крок: потрібна вкладка, відкрита/закрита форма рейсу. */
  async function prepare(s) {
    if (s.trip) {
      if (!tripOpen()) { openTrip(); await sleep(80); }
    } else if (tripOpen()) {
      closeTrip();
      await sleep(40);
    }
    if (s.view) { go(s.view); await sleep(60); }
    if (s.before) { s.before(); await sleep(60); }
  }

  function renderCard() {
    const t = tour;
    const s = t.steps[t.i];
    const n = t.steps.length;
    const last = t.i === n - 1;
    const text = typeof s.text === 'function' ? s.text() : s.text;
    t.card.innerHTML = `
      <div class="tour-head">
        <span class="tour-count">${t.title} · ${t.i + 1} / ${n}</span>
        <button type="button" class="icon-btn tour-x" data-tour="close" aria-label="Закрити тур"><i data-lucide="x" class="h-4 w-4"></i></button>
      </div>
      <h3 class="tour-title">${s.title}</h3>
      <div class="tour-text">${text}</div>
      <div class="tour-bar"><span style="width:${((t.i + 1) / n) * 100}%"></span></div>
      <div class="tour-actions">
        ${t.i > 0 ? '<button type="button" class="btn-ghost" data-tour="prev"><i data-lucide="chevron-left" class="h-4 w-4"></i><span>Назад</span></button>' : '<button type="button" class="btn-ghost" data-tour="close">Пропустити</button>'}
        <button type="button" class="btn-primary" data-tour="next"><span>${last ? 'Готово' : 'Далі'}</span>${last ? '<i data-lucide="check" class="h-4 w-4"></i>' : '<i data-lucide="chevron-right" class="h-4 w-4"></i>'}</button>
      </div>`;
    refreshIcons();
    const next = t.card.querySelector('[data-tour="next"]');
    if (next) next.focus({ preventScroll: true });
  }

  /** Розставити підсвітку і картку з підказкою біля елемента. */
  function place() {
    if (!tour) return;
    const { spot, card, target } = tour;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 12;
    card.style.left = card.style.top = card.style.bottom = '';
    card.classList.remove('is-center', 'is-sheet', 'is-sheet-top');

    if (!target || !visible(target)) {
      spot.classList.add('hidden');
      card.classList.add('is-center');
      return;
    }
    const r = target.getBoundingClientRect();
    const pad = 6;
    const top = Math.max(r.top - pad, 4);
    const bottom = Math.min(r.bottom + pad, vh - 4);
    const left = Math.max(r.left - pad, 4);
    const right = Math.min(r.right + pad, vw - 4);
    spot.classList.remove('hidden');
    Object.assign(spot.style, { top: top + 'px', left: left + 'px', width: Math.max(0, right - left) + 'px', height: Math.max(0, bottom - top) + 'px' });

    if (vw < 640) {
      // Телефон: картка — смуга знизу, або згори, якщо елемент у нижній половині
      const mid = (top + bottom) / 2;
      card.classList.add(mid > vh * 0.55 ? 'is-sheet-top' : 'is-sheet');
      return;
    }
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    let y;
    if (bottom + gap + ch <= vh - 8) y = bottom + gap;
    else if (top - gap - ch >= 8) y = top - gap - ch;
    else y = Math.min(Math.max(8, vh - ch - 8), Math.max(8, (vh - ch) / 2));
    let x = r.left + r.width / 2 - cw / 2;
    x = Math.min(Math.max(8, x), vw - cw - 8);
    card.style.left = x + 'px';
    card.style.top = y + 'px';
  }

  function onTourClick(e) {
    const b = e.target.closest('[data-tour]');
    if (!b) return;
    const a = b.dataset.tour;
    if (a === 'close') endTour(true);
    else if (a === 'prev') show(tour.i - 1, -1);
    else if (a === 'next') { if (tour.i >= tour.steps.length - 1) endTour(true); else show(tour.i + 1, 1); }
  }
  function onTourKey(e) {
    if (!tour) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endTour(true); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); if (tour.i >= tour.steps.length - 1) endTour(true); else show(tour.i + 1, 1); }
    else if (e.key === 'ArrowLeft' && tour.i > 0) { e.preventDefault(); e.stopPropagation(); show(tour.i - 1, -1); }
    else if (e.key === 'Tab') {
      // Фокус не виходить за межі картки
      const f = [...tour.card.querySelectorAll('button')];
      if (!f.length) return;
      const idx = f.indexOf(document.activeElement);
      e.preventDefault();
      f[(idx + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    }
  }

  // ---------- Модалка довідки ----------
  let helpRole = 'owner';
  // Відео-огляди (файли в media/, вантажаться лише після натискання «Play»)
  const VIDEOS = {
    owner: { src: 'media/owner-guide.mp4', poster: 'media/owner-guide.jpg', title: 'Відео-огляд для власника', length: '2 хв 40 с' },
  };
  const stopVideo = () => { const v = $('#helpModal video'); if (v && !v.paused) v.pause(); };
  const ROLES = [
    ['owner', 'Власник', 'key-round', 'Повний огляд сайту: рейси, цифри, розрахунки, налаштування.'],
    ['partner', 'Компаньйон', 'handshake', 'Де дивитись частку компаньйона і виплати.'],
    ['driver', 'Водій / логіст', 'truck', 'Як внести рейс і як рахується ЗП.'],
  ];

  function buildHelp() {
    const el = document.createElement('div');
    el.id = 'helpModal';
    el.className = 'modal hidden';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'helpTitle');
    el.innerHTML = `
      <div class="modal-backdrop" data-close></div>
      <div class="modal-panel max-w-2xl">
        <div class="flex max-h-[100dvh] flex-col sm:max-h-[92vh]">
          <div class="flex items-center justify-between border-b border-white/5 px-5 py-4">
            <div class="flex items-center gap-3">
              <div class="grid h-9 w-9 place-items-center rounded-lg bg-amber-500/15 text-amber-300"><i data-lucide="help-circle" class="h-5 w-5"></i></div>
              <div>
                <h3 id="helpTitle" class="text-lg font-bold text-white">Довідка та навчання</h3>
                <p class="text-xs text-slate-400">Обери, хто ти — покажу потрібне</p>
              </div>
            </div>
            <button type="button" class="icon-btn" data-close aria-label="Закрити"><i data-lucide="x" class="h-5 w-5"></i></button>
          </div>
          <div class="flex-1 overflow-y-auto p-5">
            <div class="help-roles" role="tablist" aria-label="Для кого">
              ${ROLES.map(([k, label, icon]) => `<button type="button" role="tab" class="help-role" data-help-role="${k}" aria-selected="false"><i data-lucide="${icon}" class="h-5 w-5"></i><span>${label}</span></button>`).join('')}
            </div>
            <div id="helpBody" class="mt-5"></div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(el);
    // Довідку закривають різними шляхами (хрестик, фон, Esc, кнопка туру) — відео зупиняємо в будь-якому разі
    new MutationObserver(() => { if (el.classList.contains('hidden')) stopVideo(); })
      .observe(el, { attributes: true, attributeFilter: ['class'] });
    el.addEventListener('click', (e) => {
      const r = e.target.closest('[data-help-role]');
      if (r) { helpRole = r.dataset.helpRole; renderHelp(); return; }
      const s = e.target.closest('[data-start-tour]');
      if (s) startTour(s.dataset.startTour);
    });
    return el;
  }

  function renderHelp() {
    const m = $('#helpModal');
    m.querySelectorAll('[data-help-role]').forEach((b) => {
      const on = b.dataset.helpRole === helpRole;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
    });
    const role = ROLES.find((r) => r[0] === helpRole);
    const video = VIDEOS[helpRole];
    $('#helpBody').innerHTML = `${video ? `
      <figure class="help-video">
        <video controls playsinline preload="none" poster="${video.poster}" src="${video.src}" aria-label="${video.title}"></video>
        <figcaption><i data-lucide="clapperboard" class="h-4 w-4"></i><span>${video.title}</span><span class="text-slate-500">· ${video.length}</span></figcaption>
      </figure>` : ''}
      <div class="help-tour">
        <div class="min-w-0">
          <div class="font-semibold text-white">Інтерактивний тур</div>
          <p class="text-sm text-slate-400">${role[3]}</p>
        </div>
        <button type="button" class="btn-primary shrink-0" data-start-tour="${helpRole}"><i data-lucide="play" class="h-4 w-4"></i><span>Почати</span></button>
      </div>
      <div class="section-label mt-6">Часті питання</div>
      <div class="help-faq">
        ${FAQ[helpRole].map(([q, a]) => `<details class="help-q"><summary><span>${q}</span><i data-lucide="chevron-down" class="h-4 w-4"></i></summary><div class="help-a">${a}</div></details>`).join('')}
      </div>`;
    refreshIcons();
  }

  function openHelp(role) {
    if (role) helpRole = role;
    const m = $('#helpModal') || buildHelp();
    renderHelp();
    m.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    const btn = m.querySelector('[data-help-role].is-active');
    if (btn) btn.focus({ preventScroll: true });
  }
  function closeHelp() {
    const m = $('#helpModal');
    if (!m || m.classList.contains('hidden')) return;
    stopVideo();
    m.classList.add('hidden');
    if (!document.querySelector('.modal:not(.hidden)')) document.body.style.overflow = '';
  }

  // ---------- Привітання при першому вході ----------
  function welcome() {
    if (store.get() || document.querySelector('.modal:not(.hidden)') || tour) return;
    const el = document.createElement('div');
    el.className = 'tour-welcome';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Знайомство з сайтом');
    el.innerHTML = `
      <button type="button" class="icon-btn tour-x" data-w="later" aria-label="Закрити"><i data-lucide="x" class="h-4 w-4"></i></button>
      <div class="tour-title">👋 Вперше тут?</div>
      <p class="tour-text">Покажу сайт за хвилину. Хто ти?</p>
      <div class="grid gap-2">
        ${ROLES.map(([k, label, icon]) => `<button type="button" class="btn-ghost justify-start" data-w="${k}"><i data-lucide="${icon}" class="h-4 w-4"></i><span>${label}</span></button>`).join('')}
      </div>
      <button type="button" class="tour-later" data-w="later">Не зараз — довідка буде під «?» вгорі</button>`;
    document.body.appendChild(el);
    refreshIcons();
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-w]');
      if (!b) return;
      store.set();
      el.remove();
      if (b.dataset.w !== 'later') startTour(b.dataset.w);
    });
  }

  // ---------- Старт ----------
  $('#helpBtn')?.addEventListener('click', () => openHelp());
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="help"]')) openHelp();
  });
  setTimeout(welcome, 1200);

  // Для автотестів і консолі
  window.Guide = {
    open: openHelp, start: startTour, end: () => endTour(true), welcome,
    get active() { return tour ? { key: tour.key, i: tour.i, n: tour.steps.length, need: !!tour.steps[tour.i].sel, target: !!tour.target, title: tour.steps[tour.i].title } : null; },
  };
})();
