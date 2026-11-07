/* Іконки Phosphor (duotone) замість Lucide.
   Розмітка лишається з data-lucide="назва" — тут вона перетворюється на іконку Phosphor.
   Працює і для елементів, які додаються пізніше (MutationObserver). */
(function () {
  'use strict';

  const MAP = {
    'arrow-right': 'arrow-right', 'banknote': 'money', 'bar-chart-3': 'chart-bar', 'calculator': 'calculator',
    'calendar': 'calendar-blank', 'calendar-check': 'calendar-check', 'calendar-clock': 'clock-countdown',
    'calendar-days': 'calendar-dots', 'calendar-range': 'calendar', 'check': 'check', 'chevron-right': 'caret-right',
    'cloud': 'cloud-check', 'cloud-off': 'cloud-slash', 'cloud-upload': 'cloud-arrow-up', 'copy': 'copy',
    'credit-card': 'credit-card', 'database': 'database', 'download': 'download-simple', 'eye': 'eye',
    'file-plus-2': 'file-plus', 'file-spreadsheet': 'file-xls', 'fuel': 'gas-pump', 'gauge': 'gauge',
    'hammer': 'hammer', 'hand-coins': 'hand-coins', 'handshake': 'handshake', 'headset': 'headset',
    'landmark': 'bank', 'layout-dashboard': 'squares-four', 'list': 'list-bullets', 'log-in': 'sign-in',
    'log-out': 'sign-out', 'pencil': 'pencil-simple', 'pie-chart': 'chart-pie-slice', 'piggy-bank': 'piggy-bank',
    'plus': 'plus', 'receipt': 'receipt', 'route': 'path', 'save': 'floppy-disk', 'search': 'magnifying-glass',
    'send': 'telegram-logo', 'settings-2': 'sliders-horizontal', 'sparkles': 'sparkle', 'trash-2': 'trash',
    'trending-up': 'trend-up', 'truck': 'truck', 'upload': 'upload-simple', 'user-plus': 'user-plus',
    'user-round': 'user', 'users': 'users-three', 'wallet': 'wallet', 'wrench': 'wrench', 'x': 'x',
    'check-circle-2': 'check-circle', 'alert-circle': 'warning-circle', 'info': 'info',
    'key-round': 'key', 'arrow-up-right': 'arrow-up-right', 'arrow-down-left': 'arrow-down-left', 'scale': 'scales',
    'history': 'clock-counter-clockwise', 'chevron-down': 'caret-down', 'file-text': 'file-pdf',
    'building-2': 'buildings', 'chevron-left': 'caret-left', 'clock': 'clock', 'target': 'target',
    'calendar-x': 'calendar-x', 'bell': 'bell-ringing',
    'help-circle': 'question', 'play': 'play',
  };
  // Іконки, які краще виглядають «повними» (не duotone)
  const BOLD = new Set(['plus', 'x', 'check', 'chevron-right', 'chevron-left', 'arrow-right']);

  function convert(root) {
    const list = root.querySelectorAll ? root.querySelectorAll('i[data-lucide]') : [];
    const nodes = root.matches && root.matches('i[data-lucide]') ? [root, ...list] : list;
    nodes.forEach((el) => {
      const name = el.getAttribute('data-lucide');
      const ph = MAP[name] || 'circle';
      el.removeAttribute('data-lucide');
      el.classList.add(BOLD.has(name) ? 'ph-bold' : 'ph-duotone', 'ph-' + ph, 'ic', 'ic-' + name);
      el.setAttribute('aria-hidden', 'true');
    });
  }

  // Сумісність зі старим кодом: lucide.createIcons()
  window.lucide = { createIcons: () => convert(document) };

  function start() {
    convert(document);
    new MutationObserver((muts) => {
      for (const m of muts) m.addedNodes.forEach((n) => { if (n.nodeType === 1) convert(n); });
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
